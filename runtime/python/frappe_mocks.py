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

def create_exception_mock(name):
    """Returns a dynamically generated Exception subclass to safely mock module errors."""
    return type(name, (Exception,), {})

class AbsorbingMeta(type):
    def __getattr__(cls, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return cls()

class AbsorbingMock(metaclass=AbsorbingMeta):
    """A bulletproof mock that safely swallows any attribute access, method call, or iteration."""
    def __init__(self, *a, **k): pass
    def __getattr__(self, name): return self
    def __call__(self, *a, **k): return self
    def __iter__(self): return iter([])
    def __len__(self): return 0
    def __bool__(self): return False
    def __getitem__(self, key): return self
    def __setitem__(self, key, value): pass
    def __enter__(self): return self
    def __exit__(self, *a, **k): pass
    
    @classmethod
    def __class_getitem__(cls, item): return cls

# ── Disabled-integration mocks ───────────────────────────────────────
#
# These back the AutoMockFinder below, which fabricates entire module trees
# for optional integrations that are not installed in the browser runtime.
#
# Import must always succeed: Frappe imports several integration modules
# eagerly, before it checks whether the integration is configured. But a
# *call* into one of these means real feature code is executing against a
# stub, which previously succeeded silently and produced wrong results.
#
# Mode is read from PLAYGROUND_INTEGRATION_MOCK_MODE:
#   strict (default) - raise DisabledIntegrationError on call
#   warn             - print a warning and absorb the call
#   absorb           - legacy silent behavior
#
# Every call is recorded in INTEGRATION_MOCK_USAGE regardless of mode, so a
# test can assert that a flow touched no disabled integration.

import os

INTEGRATION_MOCK_MODE = os.environ.get("PLAYGROUND_INTEGRATION_MOCK_MODE", "strict")
INTEGRATION_MOCK_USAGE = []


class DisabledIntegrationError(RuntimeError):
    """Raised when code calls into an integration that is not available."""


def _record_integration_use(qualified_name):
    INTEGRATION_MOCK_USAGE.append(qualified_name)
    if INTEGRATION_MOCK_MODE == "strict":
        raise DisabledIntegrationError(
            f"{qualified_name} was called, but that integration is not available "
            f"in the browser runtime. It is mocked for import compatibility only. "
            f"Set PLAYGROUND_INTEGRATION_MOCK_MODE=warn to downgrade this to a warning."
        )
    if INTEGRATION_MOCK_MODE == "warn":
        print(f"[playground] WARNING: called disabled integration {qualified_name}")


class DisabledIntegrationMeta(type):
    def __getattr__(cls, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return cls()


class DisabledIntegrationMock(metaclass=DisabledIntegrationMeta):
    """Import-safe placeholder that reports use instead of silently absorbing it.

    Attribute access stays permissive so that ``from x import y`` and
    module-level symbol lookups keep working. Only invocation is treated as
    real feature execution.
    """

    def __init__(self, *a, **k):
        object.__setattr__(self, "_playground_name", k.pop("_playground_name", "<disabled integration>"))

    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        child = DisabledIntegrationMock()
        object.__setattr__(child, "_playground_name", f"{object.__getattribute__(self, '_playground_name')}.{name}")
        return child

    def __call__(self, *a, **k):
        _record_integration_use(object.__getattribute__(self, "_playground_name"))
        return self

    def __iter__(self): return iter([])
    def __len__(self): return 0
    def __bool__(self): return False
    def __getitem__(self, key): return self.__getattr__(str(key))
    def __setitem__(self, key, value): pass
    def __enter__(self): return self
    def __exit__(self, *a, **k): pass

    @classmethod
    def __class_getitem__(cls, item): return cls


def _disabled_attr(module_name, name):
    """Resolve an attribute on a fabricated integration module."""
    if name in ('__file__', '__path__', '__spec__', '__loader__', '__all__'):
        raise AttributeError(name)
    if name.endswith("Error") or name.endswith("Exception"):
        return create_exception_mock(name)
    mock = DisabledIntegrationMock()
    object.__setattr__(mock, "_playground_name", f"{module_name}.{name}")
    return mock


class AutoMockModule(ModuleType):
    """Module whose attributes resolve to import-safe disabled-integration mocks."""
    def __init__(self, name):
        super().__init__(name)
        self.__path__ = []

    def __getattr__(self, name):
        return _disabled_attr(self.__name__, name)


class AutoMockFinder:
    """A sys.meta_path finder that intercepts and mocks imports for specified prefixes."""
    def __init__(self, prefixes):
        self.prefixes = prefixes

    def find_spec(self, fullname, path, target=None):
        for prefix in self.prefixes:
            if fullname == prefix or fullname.startswith(prefix + "."):
                import importlib.machinery

                class AutoMockLoader:
                    def create_module(self, spec):
                        return AutoMockModule(fullname)

                    def exec_module(self, module):
                        module.__getattr__ = lambda name: _disabled_attr(fullname, name)

                return importlib.machinery.ModuleSpec(fullname, AutoMockLoader())
        return None


# ── Base DB Exceptions ──────────────────────────────────────────────

db_exc = {
    name: create_exception_mock(name) for name in [
        "Error", "Warning", "InterfaceError", "DatabaseError", "DataError",
        "OperationalError", "IntegrityError", "InternalError", "ProgrammingError",
        "NotSupportedError"
    ]
}

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

# Use a shared server so all Frappe Redis connections share the same in-memory dataset
shared_server = fakeredis.FakeServer()

class FakeRedisWrapper(fakeredis.FakeRedis):
    def __init__(self, *args, **kwargs):
        kwargs.pop("connection_class", None)
        kwargs.pop("_invalidator_id", None)
        kwargs["decode_responses"] = False
        kwargs.setdefault("server", shared_server)
        super().__init__(*args, **kwargs)

    @classmethod
    def from_url(cls, *args, **kwargs):
        kwargs.pop("connection_class", None)
        kwargs.pop("_invalidator_id", None)
        kwargs["decode_responses"] = False
        kwargs.setdefault("server", shared_server)
        return super().from_url(*args, **kwargs)

    def info(self, section=None):
        return {
            "used_memory_human": "1.00M",
            "redis_version": "7.0.0",
            "connected_clients": 1,
            "used_memory_peak_human": "1.00M"
        }

    def execute_command(self, *args, **options):
        if args and str(args[0]).lower() == "info":
            # Redis-py's .info() method parses the raw string response from execute_command('INFO')
            return b"used_memory_human:1.00M\r\nredis_version:7.0.0\r\nconnected_clients:1\r\nused_memory_peak_human:1.00M\r\n"
        return super().execute_command(*args, **options)

redis.Redis = FakeRedisWrapper
redis.StrictRedis = FakeRedisWrapper
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

create_mock("redis.commands.search", Search=AbsorbingMock)
create_mock("redis.commands", search=sys.modules["redis.commands.search"])

# ── MySQL Mocks ─────────────────────────────────────────────────────
# (Even though we use sqlite, Frappe unconditionally imports MySQLdb in some places)

# OmniMock is needed instead of AbsorbingMock specifically for MySQLdb constant tables
# (e.g. MySQLdb.constants.ER or FIELD_TYPE) which require `0` for numeric comparisons in Frappe.
class _OmniMock:
    """Returns 0 for any attribute access — used for MySQLdb constant tables."""
    def __getattr__(self, name):
        return 0
    def __call__(self, *a, **k):
        return self

OmniMock = _OmniMock()

create_mock("MySQLdb", **db_exc)
create_mock("MySQLdb._mysql", escape_string=lambda *a, **k: b"")
create_mock("MySQLdb.constants", ER=OmniMock, FIELD_TYPE=OmniMock)
create_mock("MySQLdb.converters", conversions={})
create_mock("MySQLdb.cursors", SSCursor=AbsorbingMock)

# ── OS / Process Mocks ──────────────────────────────────────────────

class DummyProcess:
    def __init__(self, *a, **k): pass
    def terminate(self): pass
    def kill(self): pass

create_mock("psutil")
sys.modules["psutil"].Process = DummyProcess
sys.modules["psutil"].AccessDenied = create_exception_mock("AccessDenied")
sys.modules["psutil"].NoSuchProcess = create_exception_mock("NoSuchProcess")

# >>> ablatable: pwd_grp
# Frappe relies on pwd/grp for unix user checks which don't exist in Pyodide
create_mock("pwd", getpwuid=lambda x: AbsorbingMock())
create_mock("grp", getgrgid=lambda x: AbsorbingMock())
# <<< ablatable: pwd_grp

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

# >>> ablatable: psycopg2
create_mock("psycopg2", **db_exc)
create_mock("psycopg2.extensions", ISOLATION_LEVEL_REPEATABLE_READ=0)
create_mock("psycopg2.sql")
create_mock("psycopg2.errorcodes")
create_mock("psycopg2.errors")
# <<< ablatable: psycopg2

# ── RQ (Redis Queue) Mocks ──────────────────────────────────────────

class DummyCallback:
    def __init__(self, func=None, *a, **k):
        self.func = func
    def __call__(self, *a, **k):
        if self.func: return self.func(*a, **k)

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
        self.failed_job_registry = AbsorbingMock()
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

class DummyDequeueStrategy:
    DEFAULT = None

rq_mod = create_mock("rq",
    Queue=DummyQueue, Worker=AbsorbingMock, Callback=DummyCallback,
    get_current_job=lambda *a, **k: None
)
rq_mod.defaults = create_mock("rq.defaults", DEFAULT_WORKER_TTL=420)
rq_mod.exceptions = create_mock("rq.exceptions",
    InvalidJobOperation=create_exception_mock("InvalidJobOperation"),
    NoSuchJobError=create_exception_mock("NoSuchJobError")
)
rq_mod.job = create_mock("rq.job", Job=DummyJob, JobStatus=DummyJobStatus)
rq_mod.logutils = create_mock("rq.logutils", setup_loghandlers=lambda *a, **k: None)
rq_mod.timeouts = create_mock("rq.timeouts", JobTimeoutException=create_exception_mock("JobTimeoutException"))
rq_mod.worker = create_mock("rq.worker",
    DequeueStrategy=DummyDequeueStrategy, StopRequested=create_exception_mock("StopRequested"),
    WorkerStatus=AbsorbingMock
)
rq_mod.worker_pool = create_mock("rq.worker_pool", WorkerPool=AbsorbingMock)
rq_mod.command = create_mock("rq.command", send_stop_job_command=lambda *a, **k: None)
rq_mod.queue = create_mock("rq.queue", Queue=DummyQueue)

# ── Optional Integrations (Auto-Mocked) ─────────────────────────────

# Telemetry is disabled in the browser runtime. Mock Frappe's adapter directly
# because its Integration base class must be a real class, not an absorbing
# optional-module placeholder.
create_mock("frappe.utils.sentry", capture_exception=lambda *a, **k: None)

# Automatically mock these entire trees so we don't have to stub them one-by-one.
# >>> ablatable-list: integrations
sys.meta_path.insert(0, AutoMockFinder([
    "googleapiclient",
    "google",
    "ldap3",
    "posthog",
    "twilio",
    "boto3",
    "botocore",
    "dropbox",
    "braintree",
    "stripe",
    "plaid",
    "sentry_sdk",
]))
# <<< ablatable-list: integrations

# ── Install Frappe ──────────────────────────────────────────────────

# A missing Frappe archive is a boot failure, not something to paper over.
# Registering a fake `frappe` module here used to turn a broken runtime
# download into confusing downstream AttributeErrors instead of one clear
# error at the point of failure.
import importlib.util

if not importlib.util.find_spec("frappe"):
    raise ImportError(
        "The Frappe runtime is not present in /home/pyodide/frappe_env. "
        "The runtime archive failed to download or unpack. "
        "Rebuild it with `npm run build:runtime`."
    )
