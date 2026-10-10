"""Stylised Delhi grid. Port of web/src/sim/city.ts (same seed -> same city).

Zone positions follow real relative geography (Yamuna to the east, Anand Vihar
across it, Dwarka south-west); the grid itself is illustrative, not GIS.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

from .rng import clamp, mulberry32

GRID = 30


@dataclass(frozen=True)
class Zone:
    id: str
    name: str
    district: str
    cx: int
    cz: int
    character: str
    schools: int
    hospitals: int
    population_k: int


@dataclass
class Cell:
    x: int
    z: int
    kind: str
    zone: str
    height: float
    road_weight: float
    population: float


@dataclass
class Station:
    id: str
    name: str
    x: int
    z: int
    aqi: int = 0
    ledger_ref: str = ""


@dataclass
class City:
    size: int
    cells: list[Cell]
    zones: list[Zone]
    stations: list[Station] = field(default_factory=list)

    def idx(self, x: int, z: int) -> int:
        return z * self.size + x


ZONES: list[Zone] = [
    Zone("narela", "Narela", "North", 8, 2, "industrial", 38, 4, 410),
    Zone("rohini", "Rohini", "North West", 4, 7, "suburban", 112, 14, 860),
    Zone("jahangirpuri", "Jahangirpuri", "North", 12, 5, "dense", 64, 6, 540),
    Zone("shahdara", "Shahdara", "Shahdara", 26, 6, "dense", 88, 9, 720),
    Zone("wazirpur", "Wazirpur", "North West", 10, 10, "industrial", 41, 5, 380),
    Zone("mundka", "Mundka", "West", 2, 14, "industrial", 29, 3, 300),
    Zone("punjabibagh", "Punjabi Bagh", "West", 8, 15, "mixed", 70, 11, 520),
    Zone("ito", "ITO", "Central", 17, 12, "transit", 34, 12, 260),
    Zone("anandvihar", "Anand Vihar", "East", 26, 14, "transit", 57, 7, 610),
    Zone("lodhi", "Lodhi Road", "New Delhi", 16, 18, "green", 22, 8, 140),
    Zone("rkpuram", "R K Puram", "South West", 11, 21, "mixed", 61, 9, 450),
    Zone("dwarka", "Dwarka", "South West", 3, 23, "suburban", 96, 10, 690),
    Zone("okhla", "Okhla", "South East", 20, 25, "industrial", 46, 6, 480),
]
ZONE_BY_ID = {z.id: z for z in ZONES}

STATION_DEFS = [
    ("S-AV", "Anand Vihar", "anandvihar", 0, 0),
    ("S-PP", "Patparganj", "anandvihar", -2, -3),
    ("S-VV", "Vivek Vihar", "shahdara", 0, 2),
    ("S-ITO", "ITO", "ito", 0, 0),
    ("S-PB", "Punjabi Bagh", "punjabibagh", 1, -1),
    ("S-RKP", "R K Puram", "rkpuram", 0, 0),
    ("S-WZ", "Wazirpur", "wazirpur", 0, 0),
    ("S-JP", "Jahangirpuri", "jahangirpuri", 0, 1),
    ("S-RH", "Rohini", "rohini", 1, 0),
    ("S-DW", "Dwarka Sec-8", "dwarka", 1, -1),
    ("S-OK", "Okhla Phase-2", "okhla", -1, 0),
    ("S-LR", "Lodhi Road", "lodhi", 0, 0),
    # Mundka and Narela intentionally have no usable station in the demo window.
]


def river_x(z: float) -> float:
    return 21.5 + 1.6 * math.sin(z / 4.6) + ((z - 20) * 0.25 if z > 20 else 0)


def _nearest_zone(x: int, z: int) -> str:
    best, bd = ZONES[0].id, math.inf
    rx = river_x(z)
    for zn in ZONES:
        east_zone = zn.cx > river_x(zn.cz)
        if east_zone != (x > rx):
            continue
        d = (zn.cx - x) ** 2 + (zn.cz - z) ** 2 * 1.1
        if d < bd:
            bd, best = d, zn.id
    return best


def build_city(seed: int = 11) -> City:
    rnd = mulberry32(seed)
    n = GRID
    cells: list[Cell] = []
    for z in range(n):
        for x in range(n):
            zone = _nearest_zone(x, z)
            ch = ZONE_BY_ID[zone].character
            rx = river_x(z)
            kind = "building"
            on_river = abs(x + 0.5 - rx) < 1.05
            ring = ((x in (7, 18)) and 7 <= z <= 21) or ((z in (7, 21)) and 7 <= x <= 18)
            nh = z == 13 and x >= 15
            outer = (x == 1 and 3 < z < 27) or (z == 27 and 1 < x < 20)
            grid = x % 5 == 3 or z % 5 == 2
            ridge = 12 <= x <= 13 and 9 <= z <= 15
            lodhi_park = 14 <= x <= 16 and 17 <= z <= 19

            if on_river:
                kind = "arterial" if nh else "river"
            elif ring or nh or outer:
                kind = "arterial"
            elif grid:
                kind = "road"
            elif ridge or lodhi_park:
                kind = "park"
            elif ch == "industrial" and rnd() < 0.72:
                kind = "industrial"
            elif ch == "green" and rnd() < 0.45:
                kind = "park"
            elif ch == "suburban" and rnd() < 0.16:
                kind = "park"
            elif rnd() < (0.1 if ch == "transit" else 0.2):
                kind = "open"
            elif rnd() < 0.05:
                kind = "park"

            height = 0.0
            if kind == "building":
                r = rnd()
                height = {
                    "transit": 0.7 + r * 1.9,
                    "dense": 0.7 + r * 1.5,
                    "mixed": 0.6 + r * 1.4,
                    "suburban": 0.45 + r * 1.1,
                    "green": 0.4 + r * 0.6,
                }.get(ch, 0.5 + r * 0.8)
                if rnd() < 0.04:
                    height += 1.8
            elif kind == "industrial":
                height = 0.35 + rnd() * 0.45

            road_weight = 1.0 if kind == "arterial" else 0.55 if kind == "road" else 0.0
            population = height * (0.7 if ch == "transit" else 1) if kind == "building" else 0.12 if kind == "industrial" else 0.0
            cells.append(Cell(x, z, kind, zone, height, road_weight, population))

    rw = [c.road_weight for c in cells]
    for _ in range(2):
        nxt = rw[:]
        for z in range(n):
            for x in range(n):
                s = cnt = 0
                for dz in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        xx, zz = x + dx, z + dz
                        if 0 <= xx < n and 0 <= zz < n:
                            s += rw[zz * n + xx]
                            cnt += 1
                nxt[z * n + x] = max(rw[z * n + x], (s / cnt) * 0.9)
        rw = nxt
    for c, w in zip(cells, rw):
        c.road_weight = clamp(w, 0, 1)

    stations = [
        Station(sid, name, ZONE_BY_ID[zid].cx + dx, ZONE_BY_ID[zid].cz + dz, 0, f"L-{sid}")
        for sid, name, zid, dx, dz in STATION_DEFS
    ]
    return City(n, cells, ZONES, stations)


def baseline_field(city: City, seed: int = 7) -> list[float]:
    """Pre-policy AQI field: a winter 'very poor' day."""
    n = city.size
    rnd = mulberry32(seed)
    raw = [0.0] * (n * n)
    for c in city.cells:
        v = 268 + 70 * c.road_weight
        if c.kind == "industrial":
            v += 55
        if c.kind == "park":
            v -= 28
        if c.kind == "river":
            v -= 10
        v += (c.x / n) * 45
        v += (1 - c.z / n) * 25
        v += (rnd() - 0.5) * 40
        raw[city.idx(c.x, c.z)] = v
    out = [0.0] * (n * n)
    for z in range(n):
        for x in range(n):
            s = w = 0.0
            for dz in range(-2, 3):
                for dx in range(-2, 3):
                    xx, zz = x + dx, z + dz
                    if 0 <= xx < n and 0 <= zz < n:
                        k = 1 / (1 + dx * dx + dz * dz)
                        s += raw[zz * n + xx] * k
                        w += k
            out[z * n + x] = clamp(s / w, 150, 490)
    for st in city.stations:
        st.aqi = round(out[city.idx(st.x, st.z)] + 6)
    return out


def uncertainty_field(city: City, extra_sensors: list[tuple[int, int]] | None = None) -> list[float]:
    """0 = sensor right here, 1 = no sensor within reach."""
    pts = [(s.x, s.z) for s in city.stations] + list(extra_sensors or [])
    u = [0.0] * (city.size * city.size)
    for c in city.cells:
        d = min(math.hypot(px - c.x, pz - c.z) for px, pz in pts)
        u[city.idx(c.x, c.z)] = clamp((d - 1.5) / 8, 0, 1)
    return u


@lru_cache(maxsize=1)
def get_city() -> tuple[City, list[float], list[float]]:
    city = build_city()
    base = baseline_field(city)
    unc = uncertainty_field(city)
    return city, base, unc


def zone_cells(zone_id: str) -> list[Cell]:
    city, _, _ = get_city()
    return [c for c in city.cells if zone_id == "all" or c.zone == zone_id]


def zone_coverage(zone_id: str, unc: list[float] | None = None) -> str:
    city, _, u0 = get_city()
    u = unc or u0
    cells = zone_cells(zone_id)
    m = sum(u[city.idx(c.x, c.z)] for c in cells) / len(cells) if cells else 1
    return "good" if m < 0.36 else "thin" if m < 0.6 else "none"


def zone_baseline(zone_id: str) -> float:
    city, base, _ = get_city()
    cells = zone_cells(zone_id)
    return sum(base[city.idx(c.x, c.z)] for c in cells) / len(cells) if cells else 0.0
