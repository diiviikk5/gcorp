# Verifier
Checks sourcing only, never argument quality. Rules: unsourced number -> rejected; missing ledger row -> rejected;
zone-level statement on city-wide data -> rejected; outcome claim without data -> [ASK]; otherwise accepted.
Implemented deterministically in gcorp/verifier.py.
