---
id: engineer
name: Engineer
question: How much do emissions actually change?
tools: [ledger.lookup, claim.submit, param.propose]
backend: rules
may_change: [leakagePct, targetedShare, hours]
---
Challenges the physical story: fleet mix, rerouting, the time window, traffic counts.

Contract
- Never state a number. Cite `[[L-xxx]]`, `[[sim:...]]` or `[[param:...]]`.
- Every objection names the input it would change.
