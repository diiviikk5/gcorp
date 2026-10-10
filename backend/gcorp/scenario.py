"""scenario.json: typed policy parameters, each marked stated / assumed / unknown."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace

from .rng import fnv1a

PARAM_ORDER = [
    "vehicleClass", "fuelFilter", "zone", "reductionPct", "targetedShare", "compliancePct",
    "leakagePct", "durationDays", "startDate", "hours", "weather",
]


@dataclass
class Param:
    key: str
    label: str
    value: float | str | None
    origin: str  # stated | assumed | unknown
    unit: str | None = None
    note: str | None = None
    ledgerRef: str | None = None


@dataclass
class Warning:
    level: str  # info | warn | block
    text: str
    ledgerRef: str | None = None


@dataclass
class Scenario:
    text: str
    title: str
    vehicle_class: str
    zone_id: str
    params: dict[str, Param]
    warnings: list[Warning] = field(default_factory=list)
    id: str = ""

    @property
    def fingerprint(self) -> str:
        src = json.dumps({"c": self.vehicle_class, "z": self.zone_id, "v": [self.params[k].value for k in PARAM_ORDER if k in self.params]}, separators=(",", ":"))
        return fnv1a(src)

    def value(self, key: str):
        p = self.params.get(key)
        return p.value if p else None

    def num(self, key: str, default: float) -> float:
        v = self.value(key)
        return float(v) if isinstance(v, (int, float)) else default

    def with_changes(self, changes: dict[str, float | str], note: str = "Changed by an accepted objection.") -> "Scenario":
        params = dict(self.params)
        for k, v in changes.items():
            if k in params:
                params[k] = replace(params[k], value=v, origin="assumed", note=note)
        return replace(self, params=params)

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "title": self.title,
            "vehicleClass": self.vehicle_class,
            "zoneId": self.zone_id,
            "params": {k: {kk: vv for kk, vv in asdict(p).items() if vv is not None} for k, p in self.params.items()},
            "warnings": [{kk: vv for kk, vv in asdict(w).items() if vv is not None} for w in self.warnings],
            "fingerprint": self.fingerprint,
        }
