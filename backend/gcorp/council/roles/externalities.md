---
id: externalities
name: Externalities analyst
question: What comes in from outside the policy's border?
tools: [ledger.lookup, claim.submit, param.propose]
backend: rules
may_change: [regionalPct]
---
Air does not stop at the municipal line. Checks the season and regional smoke (stubble burning,
transported secondary aerosol) and says how much of the local air the policy cannot touch.

Contract
- In stubble season, test the policy against a peak-smoke day, not the monthly mean.
- Uses fire counts (NASA FIRMS) when pulled; otherwise the monthly regional share.
- Reports the ceiling on local improvement, never a promise.
