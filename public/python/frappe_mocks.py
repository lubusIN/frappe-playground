import sys
from types import ModuleType

sys.path.insert(0, "/home/pyodide/frappe_env")

# ── Mock Module Infrastructure ──────────────────────────────────────

class DummyModule(ModuleType):
    """A mock module that registers itself in sys.modules with a package path."""
    def __init__(self, name):
        super().__init__(name)
        self.__path__ = []

def create_mock(name, **kwargs):
    """Create and register a dummy module with optional attributes."""
    m = DummyModule(name)
    for k, v in kwargs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m

class DummyClass:
    pass

class DummyRedisConnection:
    def __init__(self, *a, **k):
        pass

    def register_connect_callback(self, callback):
        self._connect_callback = callback

    def send_command(self, *a, **k):
        pass

    def read_response(self, *a, **k):
        return None

class _OmniMock:
    """Returns 0 for any attribute access — used for MySQLdb constant tables."""
    def __getattr__(self, name):
        return 0
    def __call__(self, *a, **k):
        return self

OmniMock = _OmniMock()

# ── Redis Mocks ─────────────────────────────────────────────────────

_dummy_redis_store = {}

class DummyRedisClass:
    @classmethod
    def from_url(cls, *a, **k):
        return cls()

    def ping(self, *a, **k):
        return True

    def publish(self, channel, message, *a, **k):
        return 0

    def get(self, key, *a, **k):
        return _dummy_redis_store.get(key)
        
    def set(self, key, value, *a, **k):
        _dummy_redis_store[key] = value
        
    def delete(self, *keys):
        for k in keys:
            _dummy_redis_store.pop(k, None)
            
    def hget(self, name, key, *a, **k):
        return _dummy_redis_store.get(name, {}).get(key)
        
    def hset(self, name, key, value, *a, **k):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = {}
        _dummy_redis_store[name][key] = value
        
    def hdel(self, name, *keys):
        if name in _dummy_redis_store:
            for k in keys:
                _dummy_redis_store[name].pop(k, None)
                
    def hgetall(self, name, *a, **k):
        return _dummy_redis_store.get(name, {})
        
    def sismember(self, name, value, *a, **k):
        return value in _dummy_redis_store.get(name, set())
        
    def sadd(self, name, *values):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = set()
        _dummy_redis_store[name].update(values)
        return len(values)
        
    def srem(self, name, *values):
        if name in _dummy_redis_store:
            for v in values:
                _dummy_redis_store[name].discard(v)
        return len(values)
        
    def smembers(self, name, *a, **k):
        return _dummy_redis_store.get(name, set())
        
    def lpush(self, name, *values):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = []
        for v in values:
            _dummy_redis_store[name].insert(0, v)
            
    def rpush(self, name, *values):
        if name not in _dummy_redis_store:
            _dummy_redis_store[name] = []
        _dummy_redis_store[name].extend(values)
        
    def lrange(self, name, start, end, *a, **k):
        lst = _dummy_redis_store.get(name, [])
        if end == -1 or end is None:
            return lst[start:]
        return lst[start:end+1]
        
    def pipeline(self, *a, **k):
        class Pipeline:
            def __init__(self, redis):
                self.redis = redis
                self.calls = []
            def execute(self):
                res = []
                for fn, args, kwargs in self.calls:
                    res.append(fn(*args, **kwargs))
                return res
            def __getattr__(self, name):
                def wrapper(*a, **k):
                    self.calls.append((getattr(self.redis, name), a, k))
                    return self
                return wrapper
        return Pipeline(self)

create_mock(
    "redis",
    Connection=DummyRedisConnection,
    UnixDomainSocketConnection=DummyRedisConnection,
    from_url=lambda *a, **k: DummyRedisClass(),
)
exc_mod = create_mock("redis.exceptions", BusyLoadingError=Exception, ConnectionError=Exception, ResponseError=Exception)
sys.modules["redis"].Redis = DummyRedisClass
sys.modules["redis"].exceptions = exc_mod
create_mock("redis.commands.search", Search=DummyClass)
create_mock("redis.commands", search=sys.modules["redis.commands.search"])

db_exc = dict(
    Error=Exception, Warning=Exception, InterfaceError=Exception,
    DatabaseError=Exception, DataError=Exception, OperationalError=Exception,
    IntegrityError=Exception, InternalError=Exception, ProgrammingError=Exception,
    NotSupportedError=Exception,
)

# ── MySQL Mocks ─────────────────────────────────────────────────────
# (Even though we use sqlite, Frappe unconditionally imports MySQLdb in some places)

create_mock("MySQLdb", **db_exc)
create_mock("MySQLdb._mysql", escape_string=lambda *a, **k: b"")
create_mock("MySQLdb.constants", ER=OmniMock, FIELD_TYPE=OmniMock)
create_mock("MySQLdb.converters", conversions={})
create_mock("MySQLdb.cursors", SSCursor=DummyClass)

# ── OS / Process Mocks ──────────────────────────────────────────────

create_mock("psutil")
class DummyProcess:
    def __init__(self, *a, **k): pass
    def terminate(self): pass
    def kill(self): pass
sys.modules["psutil"].Process = DummyProcess
sys.modules["psutil"].AccessDenied = Exception
sys.modules["psutil"].NoSuchProcess = Exception

# Frappe relies on pwd/grp for unix user checks which don't exist in Pyodide
create_mock("pwd", getpwuid=lambda x: DummyClass())
create_mock("grp", getgrgid=lambda x: DummyClass())

# ── orjson Mock (Rust extension → standard json) ────────────────────

import json
class MockOrjson:
    JSONDecodeError = json.JSONDecodeError
    OPT_NON_STR_KEYS = 1
    OPT_SERIALIZE_DATACLASS = 2
    OPT_INDENT_2 = 4
    OPT_APPEND_NEWLINE = 8
    OPT_PASSTHROUGH_DATETIME = 16
    OPT_UTC_Z = 32
    OPT_OMIT_MICROSECONDS = 64
    OPT_SORT_KEYS = 128

    @staticmethod
    def dumps(obj, default=None, option=None):
        return json.dumps(obj, default=default).encode("utf-8")

    @staticmethod
    def loads(obj):
        return json.loads(obj)

sys.modules["orjson"] = MockOrjson

# ── Additional Database Drivers ─────────────────────────────────────

create_mock("psycopg2", **db_exc)
create_mock("psycopg2.extensions", ISOLATION_LEVEL_REPEATABLE_READ=0)
create_mock("psycopg2.sql")
create_mock("psycopg2.errorcodes")
create_mock("psycopg2.errors")

import sqlite3
sqlite3.ProgrammingError = Exception
sqlite3.OperationalError = Exception
sqlite3.InternalError = Exception
sqlite3.DataError = Exception
sqlite3.NotSupportedError = Exception

# ── RQ (Redis Queue) Mocks ──────────────────────────────────────────

class DummyDequeueStrategy:
    DEFAULT = None

rq_mod = create_mock("rq",
    Queue=DummyClass, Worker=DummyClass, Callback=DummyClass,
    get_current_job=lambda *a, **k: None
)
rq_mod.defaults = create_mock("rq.defaults", DEFAULT_WORKER_TTL=420)
rq_mod.exceptions = create_mock("rq.exceptions",
    InvalidJobOperation=Exception, NoSuchJobError=Exception
)
rq_mod.job = create_mock("rq.job", Job=DummyClass, JobStatus=DummyClass)
rq_mod.logutils = create_mock("rq.logutils",
    setup_loghandlers=lambda *a, **k: None
)
rq_mod.timeouts = create_mock("rq.timeouts", JobTimeoutException=Exception)
rq_mod.worker = create_mock("rq.worker",
    DequeueStrategy=DummyDequeueStrategy, StopRequested=Exception,
    WorkerStatus=DummyClass
)
rq_mod.worker_pool = create_mock("rq.worker_pool", WorkerPool=DummyClass)

# ── Telemetry Mock ──────────────────────────────────────────────────

create_mock("posthog", Posthog=DummyClass)

# ── Install Frappe ──────────────────────────────────────────────────

# Ensure frappe is actually importable by putting it in sys.modules manually if needed
# (Pyodide can sometimes fail to parse directory structures deeply)
import importlib.util
spec = importlib.util.find_spec("frappe")
if not spec:
    print("Warning: frappe not found by default importer, manually registering...")
    sys.modules["frappe"] = create_mock("frappe")
