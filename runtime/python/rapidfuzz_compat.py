"""Pure-Python stand-in for rapidfuzz, which ships only compiled wheels.

rapidfuzz is ERPNext's single non-pure-Python dependency, so it cannot be
installed into Pyodide the way the other requirements are. It is used in exactly
one place in erpnext version-16 — bank transaction party auto-matching:

    from rapidfuzz import fuzz, process
    from rapidfuzz.utils import default_process
    process.extract(query=..., choices={...}, scorer=fuzz.token_set_ratio,
                    processor=default_process)

This implements that surface on top of difflib. It is a real substitute rather
than an absorbing stub: scores are computed, so matching behaves sensibly rather
than silently returning nothing. Scores will not be bit-identical to rapidfuzz's
C++ implementation, so a borderline match near ERPNext's cutoff of 80 may fall
on the other side of the line.
"""

import re
import sys
from difflib import SequenceMatcher
from types import ModuleType

__all__ = ["install"]


def default_process(text):
    """Lowercase, replace non-alphanumeric runs with spaces, and trim."""
    if text is None:
        return ""
    return re.sub(r"[^a-zA-Z0-9]+", " ", str(text)).strip().lower()


def _ratio(left, right):
    if not left and not right:
        return 100.0
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio() * 100.0


def ratio(left, right, processor=None, **_kwargs):
    if processor:
        left, right = processor(left), processor(right)
    return _ratio(str(left or ""), str(right or ""))


def partial_ratio(left, right, processor=None, **_kwargs):
    if processor:
        left, right = processor(left), processor(right)
    shorter, longer = sorted([str(left or ""), str(right or "")], key=len)
    if not shorter:
        return 0.0
    best = 0.0
    for start in range(max(len(longer) - len(shorter), 0) + 1):
        best = max(best, _ratio(shorter, longer[start:start + len(shorter)]))
    return best


def token_sort_ratio(left, right, processor=None, **_kwargs):
    if processor:
        left, right = processor(left), processor(right)
    return _ratio(
        " ".join(sorted(str(left or "").split())),
        " ".join(sorted(str(right or "").split())),
    )


def token_set_ratio(left, right, processor=None, **_kwargs):
    """rapidfuzz's token_set_ratio: compare the shared tokens against each side."""
    if processor:
        left, right = processor(left), processor(right)
    left_tokens = set(str(left or "").split())
    right_tokens = set(str(right or "").split())
    if not left_tokens and not right_tokens:
        return 100.0

    intersection = sorted(left_tokens & right_tokens)
    left_only = sorted(left_tokens - right_tokens)
    right_only = sorted(right_tokens - left_tokens)

    shared = " ".join(intersection)
    combined_left = (shared + " " + " ".join(left_only)).strip()
    combined_right = (shared + " " + " ".join(right_only)).strip()

    return max(
        _ratio(shared, combined_left),
        _ratio(shared, combined_right),
        _ratio(combined_left, combined_right),
    )


def extract(query=None, choices=None, scorer=None, processor=None, limit=5, score_cutoff=0, **_kw):
    """Return [(choice, score, key)] sorted by descending score.

    Matches rapidfuzz's tuple shape: ERPNext indexes [1] for the score and [2]
    for the key, so the ordering here is load-bearing.
    """
    scorer = scorer or token_set_ratio
    if choices is None:
        return []

    items = choices.items() if isinstance(choices, dict) else enumerate(choices)
    results = []
    for key, choice in items:
        score = scorer(query, choice, processor=processor)
        if score >= (score_cutoff or 0):
            results.append((choice, score, key))

    results.sort(key=lambda row: row[1], reverse=True)
    return results[:limit] if limit else results


def extractOne(query=None, choices=None, **kwargs):  # noqa: N802 - rapidfuzz's name
    found = extract(query=query, choices=choices, limit=1, **kwargs)
    return found[0] if found else None


def install():
    """Register the substitute in sys.modules, unless the real package exists."""
    try:
        import rapidfuzz  # noqa: F401
        return False
    except ImportError:
        pass

    fuzz = ModuleType("rapidfuzz.fuzz")
    for name in ("ratio", "partial_ratio", "token_sort_ratio", "token_set_ratio"):
        setattr(fuzz, name, globals()[name])

    process = ModuleType("rapidfuzz.process")
    process.extract = extract
    process.extractOne = extractOne

    utils = ModuleType("rapidfuzz.utils")
    utils.default_process = default_process

    package = ModuleType("rapidfuzz")
    package.__path__ = []
    package.fuzz = fuzz
    package.process = process
    package.utils = utils

    sys.modules.update({
        "rapidfuzz": package,
        "rapidfuzz.fuzz": fuzz,
        "rapidfuzz.process": process,
        "rapidfuzz.utils": utils,
    })
    print("[playground] rapidfuzz substitute installed (pure Python).")
    return True
