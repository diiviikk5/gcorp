"""The verifier checks sourcing only. It never judges whether an argument is good.

Rules, applied in order:
1. Any figure written in plain text (digits or number words) instead of a
   [[token]] -> REJECTED. Agents may not produce numbers.
2. Any [[L-xxx]] token that is not a ledger row -> REJECTED.
3. A zone-level statement citing only city-wide rows -> REJECTED (scope mismatch).
4. A claim about outcomes (health, deaths, admissions) with no ledger support -> ASK.
5. Otherwise -> ACCEPTED, linked to the first ledger row it cites.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import ledger

TOKEN = re.compile(r"\[\[([^\]]+)\]\]")
NUMBER_WORDS = r"\b(halves|halve|half|third|quarter|double|triple|twice|dozen|hundreds?|thousands?|lakhs?|crores?|percent|one|two|three|four|five|six|seven|eight|nine|ten)\b"
DIGIT = re.compile(r"\d")
NAMES = re.compile(r"\b(?:PM ?(?:2\.5|10|1)|NO2|NOx|SO2|O3|CO2|BS-?(?:III|IV|VI|3|4|6)|[234]W|S5P)(?![\w.])", re.I)
OUTCOME = re.compile(r"\b(admissions?|deaths?|lives|asthma|mortality|hospitali[sz]ations?|cases)\b", re.I)
LEVEL_RANK = {"none": -1, "city": 0, "district": 1, "zone": 2, "point": 3}


@dataclass
class Verdict:
    status: str  # accepted | rejected | ask
    reason: str
    ledger_ref: str | None = None
    rule: str = ""


def check(text: str, scope: str = "city") -> Verdict:
    refs = TOKEN.findall(text)
    bare = TOKEN.sub(" ", text)
    # Names are not figures: pollutants (PM2.5, NO2), emission standards (BS-VI), vehicle classes (2W/3W).
    bare = NAMES.sub(" ", bare)

    if DIGIT.search(bare) or re.search(NUMBER_WORDS, bare, re.I):
        found = (DIGIT.search(bare) and "a digit") or re.search(NUMBER_WORDS, bare, re.I).group(0)
        return Verdict("rejected", f"Contains a figure (“{found}”) that is not a ledger or simulator reference. Number removed.", rule="unsourced-number")

    ledger_refs = [r for r in refs if r.startswith("L-")]
    for r in ledger_refs:
        if ledger.get(r) is None:
            return Verdict("rejected", f"Cites {r}, which is not in the ledger.", rule="missing-row")

    if OUTCOME.search(bare) and not any(ledger.get(r) and ledger.get(r)["value"] != "not found" for r in ledger_refs):
        return Verdict("ask", "No local dose-response or outcome data in the ledger (row L-022 is empty). Moved to open questions, kept out of the brief.", "L-022", rule="outcome-unsourced")

    if ledger_refs and scope in LEVEL_RANK:
        best = max(LEVEL_RANK[ledger.get(r)["scopeLevel"]] for r in ledger_refs)
        if best < LEVEL_RANK[scope] and scope in ("zone", "point"):
            r = ledger_refs[0]
            return Verdict("rejected", f"{r} is {ledger.get(r)['scopeLevel']}-wide; it cannot support a {scope}-level statement. Scope mismatch.", rule="scope-mismatch")

    if not refs:
        return Verdict("accepted", "Interpretation only; no figure asserted.", rule="no-figures")
    first = ledger_refs[0] if ledger_refs else None
    cited = ", ".join(ledger_refs) if ledger_refs else "simulator outputs"
    return Verdict("accepted", f"{cited} resolve{'s' if len(ledger_refs) <= 1 else ''} and the scope matches.", first, rule="sourced")
