"""Unit tests for frappe_mocks polyfills and patches."""

import base64
import hashlib
import os
import sys
import types
import unittest

# Ensure dependencies are mocked so frappe_mocks.py can load without host dependencies
if "frappe" not in sys.modules or getattr(sys.modules["frappe"], "__spec__", None) is None:
    import importlib.machinery
    mock_frappe = types.ModuleType("frappe")
    mock_frappe.__spec__ = importlib.machinery.ModuleSpec("frappe", None)
    sys.modules["frappe"] = mock_frappe

if "fakeredis" not in sys.modules:
    mock_fakeredis = types.ModuleType("fakeredis")
    mock_fakeredis.FakeServer = lambda: None
    mock_fakeredis.FakeRedis = object
    sys.modules["fakeredis"] = mock_fakeredis

if "redis" not in sys.modules:
    mock_redis = types.ModuleType("redis")
    mock_redis.Connection = types.SimpleNamespace()
    mock_redis.client = types.ModuleType("redis.client")
    mock_redis.client.PubSub = types.SimpleNamespace()
    sys.modules["redis"] = mock_redis
    sys.modules["redis.client"] = mock_redis.client

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "python"))

import frappe_mocks  # noqa: E402
from frappe_mocks import _pbkdf2_hmac  # noqa: E402


class FrappeMocksPBKDF2Test(unittest.TestCase):
    def test_pbkdf2_hmac_attached_to_hashlib(self):
        """Ensure hashlib has pbkdf2_hmac."""
        self.assertTrue(hasattr(hashlib, "pbkdf2_hmac"))

    def test_pbkdf2_hmac_matches_standard_library(self):
        """Ensure _pbkdf2_hmac produces identical output to stdlib pbkdf2_hmac across hash algorithms."""
        password = b"secret_password_123"
        salt = b"random_salt_456"
        iterations = 500

        for hash_name in ["sha256", "sha512", "sha384", "sha224", "sha1", "md5"]:
            with self.subTest(hash=hash_name):
                expected = hashlib.pbkdf2_hmac(hash_name, password, salt, iterations, 32)
                actual = _pbkdf2_hmac(hash_name, password, salt, iterations, 32)
                self.assertEqual(expected, actual)

    def test_pbkdf2_hmac_default_dklen(self):
        """When dklen is None, output length should match the digest size."""
        expected = hashlib.pbkdf2_hmac("sha256", b"pwd", b"salt", 100)
        actual = _pbkdf2_hmac("sha256", b"pwd", b"salt", 100)
        self.assertEqual(len(actual), 32)
        self.assertEqual(expected, actual)

    def test_pbkdf2_hmac_input_types(self):
        """Supports str, bytes, bytearray, and memoryview."""
        expected = hashlib.pbkdf2_hmac("sha256", b"pwd", b"salt", 100, 16)

        # str inputs
        self.assertEqual(_pbkdf2_hmac("sha256", "pwd", "salt", 100, 16), expected)

        # bytearray inputs
        self.assertEqual(
            _pbkdf2_hmac("sha256", bytearray(b"pwd"), bytearray(b"salt"), 100, 16),
            expected,
        )

        # memoryview inputs
        self.assertEqual(
            _pbkdf2_hmac("sha256", memoryview(b"pwd"), memoryview(b"salt"), 100, 16),
            expected,
        )

    def test_pbkdf2_hmac_frappe_admin_password_verification(self):
        """Verifies the exact Administrator password hash in site1.db."""
        # Salt: 'ISTEmHMupVTKWQsBoDTGOA' (base64)
        raw_salt = base64.b64decode("ISTEmHMupVTKWQsBoDTGOA==")
        derived = _pbkdf2_hmac("sha256", b"admin", raw_salt, 29000, 32)
        derived_b64 = base64.b64encode(derived).decode().rstrip("=")
        self.assertEqual(derived_b64, "GmZdD7STYMyUYjlCeZk9zFQTAp8odp5vQak/f8KxwNY")


if __name__ == "__main__":
    unittest.main()
