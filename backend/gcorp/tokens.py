"""Provenance tokens -> display text, shared by the CLI and the cloud bridge."""

from __future__ import annotations

import re

TOKEN = re.compile(r"\[\[([^\]]+)\]\]")


class Resolver:
    """Renders [[L-011]] / [[sim:x]] / [[param:x]] / [[fp]] the way the web app does."""

    def __init__(self, run: dict, ledger: dict[str, dict]):
        self.run, self.ledger = run, ledger
        self.round = 1
        self.overrides: dict = {}

    def sim(self) -> dict:
        sims = self.run["sims"]
        return sims.get(str(self.round)) or sims[max(sims, key=int)]

    def value(self, ref: str) -> str:
        if ref.startswith("L-"):
            row = self.ledger.get(ref)
            if not row:
                return f"{ref}?"
            v = row["value"]
            try:
                if (row.get("unit") or "").startswith("fraction"):
                    return f"{float(v) * 100:.0f}%"
            except ValueError:
                pass
            return v if len(v) < 22 else ref
        if ref == "fp":
            return self.sim()["fingerprint"]
        if ref.startswith("param:"):
            k = ref[6:]
            p = self.run["scenario"]["params"].get(k, {})
            v = self.overrides.get(k, p.get("value"))
            if k == "durationDays" and isinstance(v, (int, float)):
                return f"{round(v / 30)} months" if v >= 60 else f"{int(v)} days"
            return f"{v:g}%" if p.get("unit") == "%" and isinstance(v, (int, float)) else str(v)
        if ref.startswith("sim:"):
            s = self.sim()["summary"]
            k = ref[4:]
            return {
                "zoneBefore": f"{s['zoneBefore']:.0f}",
                "zoneAfterRange": f"{s['zoneAfterLo']:.0f}–{s['zoneAfterHi']:.0f}",
                "deltaRange": f"{s['deltaLo']:.0f}–{s['deltaHi']:.0f}",
                "pctRange": f"{s['pctLo']:.1f}–{s['pctHi']:.1f}%",
                "spillover": f"{-s['spillover']:+.1f} AQI",
                "ceiling": f"{s.get('ceilingPct', 0):.1f}%",
                "regional": f"{s.get('regionalPct', 0):.0f}%",
            }.get(k, k)
        return ref

    def plain(self, raw: str) -> str:
        return TOKEN.sub(lambda m: self.value(m.group(1)), raw)

    def text(self, raw: str, style: str = ""):
        from rich.text import Text
        out = Text(style=style)
        pos = 0
        for m in re.finditer(r"\[\[([^\]]+)\]\]", raw):
            out.append(raw[pos:m.start()])
            out.append(self.value(m.group(1)), style="underline")
            pos = m.end()
        out.append(raw[pos:])
        return out
