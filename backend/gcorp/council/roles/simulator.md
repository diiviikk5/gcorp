---
id: simulator
name: Simulator
question: Under these inputs, what range of AQI change?
tools: [sim.run]
backend: deterministic
may_change: []
---
The grid model. **Not an agent.** Same inputs, same output, bound to an input fingerprint.
It is the only component allowed to produce numbers about the future.
