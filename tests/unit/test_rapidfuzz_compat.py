"""Verify the rapidfuzz substitute against the contract ERPNext depends on.

erpnext/accounts/doctype/bank_transaction/auto_match_party.py calls:

    process.extract(query=..., choices={id: name}, scorer=fuzz.token_set_ratio,
                    processor=default_process)

and then indexes result[0][1] as the score and result[0][2] as the key, with a
cutoff of 80. The tuple order is therefore load-bearing.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "python"))

import rapidfuzz_compat  # noqa: E402

rapidfuzz_compat.install()

from rapidfuzz import fuzz, process  # noqa: E402
from rapidfuzz.utils import default_process  # noqa: E402


class RapidfuzzCompatTest(unittest.TestCase):
    def test_default_process_normalises(self):
        self.assertEqual(default_process("  ACME  Corp., Ltd. "), "acme corp ltd")
        self.assertEqual(default_process(None), "")

    def test_token_set_ratio_bounds(self):
        self.assertEqual(fuzz.token_set_ratio("acme corp", "acme corp"), 100.0)
        self.assertEqual(fuzz.token_set_ratio("", ""), 100.0)
        self.assertLess(fuzz.token_set_ratio("acme corp", "zzz industries"), 40)

    def test_token_set_ratio_ignores_word_order_and_extras(self):
        # The defining property of token_set_ratio: a subset scores 100.
        self.assertEqual(fuzz.token_set_ratio("acme corp ltd", "corp acme"), 100.0)

    def test_extract_tuple_shape_matches_rapidfuzz(self):
        result = process.extract(
            query="ACME Corp",
            choices={"C-001": "Acme Corporation", "C-002": "Beta Industries"},
            scorer=fuzz.token_set_ratio,
            processor=default_process,
        )
        self.assertTrue(result)
        value, score, key = result[0]
        self.assertEqual(key, "C-001", "index 2 must be the dict key (the party id)")
        self.assertEqual(value, "Acme Corporation", "index 0 must be the matched value")
        self.assertIsInstance(score, float)

    def test_extract_is_sorted_by_descending_score(self):
        result = process.extract(
            query="acme",
            choices={"a": "acme", "b": "acme corporation", "c": "totally different"},
            scorer=fuzz.token_set_ratio,
            processor=default_process,
        )
        scores = [row[1] for row in result]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_exact_match_clears_erpnext_cutoff(self):
        # ERPNext treats > 80 as a confident match.
        result = process.extract(
            query="Acme Corporation",
            choices={"C-001": "Acme Corporation"},
            scorer=fuzz.token_set_ratio,
            processor=default_process,
        )
        self.assertGreater(result[0][1], 80)

    def test_empty_choices_returns_empty(self):
        self.assertEqual(process.extract(query="x", choices={}), [])

    def test_install_is_idempotent(self):
        self.assertFalse(rapidfuzz_compat.install(), "should not re-register when present")


if __name__ == "__main__":
    unittest.main(verbosity=2)
