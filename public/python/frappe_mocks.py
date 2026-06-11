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

class DummyCallback:
    def __init__(self, func=None, *a, **k):
        self.func = func

    def __call__(self, *a, **k):
        if self.func:
            return self.func(*a, **k)

class DummyJobStatus:
    QUEUED = "queued"
    STARTED = "started"
    FINISHED = "finished"
    FAILED = "failed"

class DummyJob:
    def __init__(self, id=None, kwargs=None, status=DummyJobStatus.FINISHED, *a, **k):
        self.id = id
        self.kwargs = kwargs or {}
        self._status = status

    def get_status(self, refresh=False):
        return self._status

    def delete(self):
        return None

    @classmethod
    def fetch(cls, *a, **k):
        raise sys.modules["rq.exceptions"].NoSuchJobError()

    @classmethod
    def fetch_many(cls, *a, **k):
        return []

class DummyQueue:
    def __init__(self, name="default", connection=None, is_async=True, *a, **k):
        self.name = name
        self.connection = connection
        self.is_async = is_async
        self.jobs = []
        self.count = 0
        self.failed_job_registry = DummyClass()
        self.failed_job_registry.get_job_ids = lambda *a, **k: []

    @classmethod
    def all(cls, connection=None, *a, **k):
        return []

    def enqueue_call(self, func, kwargs=None, job_id=None, *a, **k):
        kwargs = kwargs or {}
        job = DummyJob(id=job_id, kwargs=kwargs, status=DummyJobStatus.FINISHED)
        self.jobs.append(job)
        self.count = len(self.jobs)
        return job



class _OmniMock:
    """Returns 0 for any attribute access — used for MySQLdb constant tables."""
    def __getattr__(self, name):
        return 0
    def __call__(self, *a, **k):
        return self

OmniMock = _OmniMock()

# ── Redis Mocks ─────────────────────────────────────────────────────

import fakeredis
import redis

# Patch Connection class so that Frappe's register_connect_callback works without errors
if not hasattr(redis.Connection, "register_connect_callback"):
    def _register_connect_callback(self, callback):
        self._connect_callback = callback
    redis.Connection.register_connect_callback = _register_connect_callback
    if hasattr(redis, "UnixDomainSocketConnection"):
        redis.UnixDomainSocketConnection.register_connect_callback = _register_connect_callback

class FakeRedisWrapper(fakeredis.FakeRedis):
    def __init__(self, *args, **kwargs):
        kwargs.pop("connection_class", None)
        kwargs.pop("_invalidator_id", None)
        super().__init__(*args, **kwargs)

    @classmethod
    def from_url(cls, *args, **kwargs):
        kwargs.pop("connection_class", None)
        kwargs.pop("_invalidator_id", None)
        return super().from_url(*args, **kwargs)

redis.Redis = FakeRedisWrapper
redis.from_url = FakeRedisWrapper.from_url

# Prevent threading crashes in Pyodide when Frappe tries to run the Redis invalidator thread
class DummyThread:
    def __init__(self, *args, **kwargs):
        self.daemon = True
    def start(self):
        pass
    def join(self, timeout=None):
        pass
    def is_alive(self):
        return True

import redis.client
if hasattr(redis.client, "PubSub"):
    def dummy_run_in_thread(self, *args, **kwargs):
        return DummyThread()
    redis.client.PubSub.run_in_thread = dummy_run_in_thread

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
    Queue=DummyQueue, Worker=DummyClass, Callback=DummyCallback,
    get_current_job=lambda *a, **k: None
)
rq_mod.defaults = create_mock("rq.defaults", DEFAULT_WORKER_TTL=420)
rq_mod.exceptions = create_mock("rq.exceptions",
    InvalidJobOperation=Exception, NoSuchJobError=Exception
)
rq_mod.job = create_mock("rq.job", Job=DummyJob, JobStatus=DummyJobStatus)
rq_mod.logutils = create_mock("rq.logutils",
    setup_loghandlers=lambda *a, **k: None
)
rq_mod.timeouts = create_mock("rq.timeouts", JobTimeoutException=Exception)
rq_mod.worker = create_mock("rq.worker",
    DequeueStrategy=DummyDequeueStrategy, StopRequested=Exception,
    WorkerStatus=DummyClass
)
rq_mod.worker_pool = create_mock("rq.worker_pool", WorkerPool=DummyClass)
rq_mod.command = create_mock("rq.command", send_stop_job_command=lambda *a, **k: None)

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
