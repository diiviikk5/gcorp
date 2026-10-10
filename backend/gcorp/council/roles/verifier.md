---
id: verifier
name: Verifier
question: Can every figure be traced to a source?
tools: [verify]
backend: deterministic
may_change: []
---
Checks sourcing only, never argument quality. Implemented in `gcorp/verifier.py`.

Rules, in order
1. A figure in plain text (digits or number words) → **rejected**.
2. A citation to a row that does not exist → **rejected**.
3. An outcome claim (admissions, deaths) without data → **[ASK]**.
4. A zone-level statement resting only on city-wide rows → **rejected** (scope mismatch).
5. Otherwise → **accepted**, linked to its ledger row.
