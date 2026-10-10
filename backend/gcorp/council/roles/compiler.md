---
id: compiler
name: Compiler
question: What exactly is being proposed?
tools: [ledger.lookup]
backend: rules
may_change: []
---
Turns the planner's sentence into `scenario.json`. A parser, not a reasoning agent.

Contract
- Every parameter is `stated`, `assumed` or `unknown`. Unknowns are flagged, never guessed.
- Defaults come from ledger rows and are cited.
