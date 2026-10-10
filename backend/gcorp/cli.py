"""gcorp — the engine from the terminal.

  gcorp run "Ban diesel trucks in Anand Vihar at night for six months" --zone anandvihar --watch
  gcorp watch <run-id>            live council view (TUI)
  gcorp ask <run-id> "what if cameras at every entry point?"
  gcorp optimise --zone anandvihar --target 15 --budget 2
  gcorp track-record | gcorp sensors <run-id> | gcorp brief <run-id>
  gcorp ledger [row-id] | gcorp council | gcorp data pull
  gcorp serve | status | stop | config set endpoint <url>

Every command accepts --json for machine-readable output and --endpoint to
target a specific engine (e.g. the AgentCore Runtime URL).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time

from rich import box
from rich.console import Console, Group
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from . import client

# Paper-and-ink palette: ink for structure, one vermilion accent for what is live.
ACCENT = "#ff4a1c"
MUTED = "grey50"
STATUS = {"accepted": ("ACCEPTED", "bold"), "rejected": ("REJECTED", f"bold {ACCENT}"), "ask": ("[ASK]", "italic"), "pending": ("checking…", MUTED)}
STAGES = ["scope", "simulate", "challenge", "verify", "decide"]
DESKS = ["compiler", "simulator", "engineer", "epidemiologist", "economist", "skeptic", "verifier", "writer"]

console = Console(highlight=False, soft_wrap=False)


# --------------------------------------------------------------------------- token rendering

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
            }.get(k, k)
        return ref

    def text(self, raw: str, style: str = "") -> Text:
        out = Text(style=style)
        pos = 0
        for m in re.finditer(r"\[\[([^\]]+)\]\]", raw):
            out.append(raw[pos:m.start()])
            out.append(self.value(m.group(1)), style="underline")
            pos = m.end()
        out.append(raw[pos:])
        return out


# --------------------------------------------------------------------------- watch (TUI)

class Board:
    def __init__(self, run: dict, ledger: dict[str, dict]):
        self.run, self.res = run, Resolver(run, ledger)
        self.stages = {s: "idle" for s in STAGES}
        self.desk: dict[str, str] = {a: "" for a in DESKS}
        self.active = None
        self.lines: list[Group | Text] = []
        self.claims: dict[str, dict] = {}
        self.verdicts: dict[str, dict] = {}
        self.complete = False

    def apply(self, ev: dict) -> None:
        t = ev["type"]
        if t == "stage":
            self.stages[ev["stage"]] = "running" if ev["status"] == "start" else "done"
        elif t == "action":
            self.active = ev["agent"]
            tool = {"ledger.lookup": "opens", "sim.run": "runs", "claim.submit": "submits", "verify": "checks", "param.propose": "changes"}[ev["tool"]]
            self.desk[ev["agent"]] = f"{tool} {ev['target']}" + (f" · {ev['detail']}" if ev.get("detail") and ev["tool"] in ("ledger.lookup", "param.propose") else "")
        elif t == "message":
            self.active = ev["agent"]
            if ev.get("claimId"):
                self.claims[ev["claimId"]] = ev
            name = self.run_agent(ev["agent"])
            line = Text.assemble((f"{name:<15}", "bold" if ev["agent"] != "planner" else f"bold {ACCENT}"), self.res.text(ev["text"]))
            self.lines.append(line)
        elif t == "verdict":
            self.verdicts[ev["claimId"]] = ev
            label, style = STATUS[ev["status"]]
            self.desk["verifier"] = f"stamped {ev['claimId']} {label}"
            self.lines.append(Text.assemble(("               └ ", MUTED), (f"{label} ", style), self.res.text(ev["reason"], MUTED)))
        elif t == "param":
            self.res.overrides[ev["key"]] = ev["to"]
            self.lines.append(Text(f"               ↻ input changed: {ev['key']} {ev['from']} → {ev['to']} · re-simulating", style=ACCENT))
        elif t == "sim":
            self.res.round = ev["round"]
            self.lines.append(Text(f"               ∑ simulator round {ev['round']} · results.round-{ev['round']}.json written", style=MUTED))
        elif t == "complete":
            self.complete = True
            self.active = None

    @staticmethod
    def run_agent(a: str) -> str:
        return {"epidemiologist": "Epidemiologist", "writer": "Brief writer"}.get(a, a.capitalize())

    def render(self) -> Layout:
        sc = self.run["scenario"]
        head = Table.grid(expand=True)
        head.add_column(ratio=1)
        head.add_column(justify="right")
        pipe = Text()
        for s in STAGES:
            st = self.stages[s]
            pipe.append(f" {'●' if st == 'done' else '◐' if st == 'running' else '○'} {s} ", style=ACCENT if st == "running" else "bold" if st == "done" else MUTED)
        head.add_row(Text(sc["title"], style="bold"), Text(f"fp {self.res.sim()['fingerprint']}", style=MUTED))
        head.add_row(pipe, Text("complete" if self.complete else "live", style="bold" if self.complete else ACCENT))

        desks = Table(box=box.SIMPLE_HEAD, expand=True, show_edge=False, pad_edge=False)
        desks.add_column("desk", style="bold", width=15)
        desks.add_column("doing")
        for a in DESKS:
            mark = "▶ " if a == self.active else "  "
            desks.add_row(Text(mark + self.run_agent(a), style=ACCENT if a == self.active else "bold"), Text(self.desk[a], style="" if a == self.active else MUTED, overflow="ellipsis", no_wrap=True))

        s = self.res.sim()["summary"]
        band = Table.grid(expand=True)
        band.add_column()
        band.add_column(justify="right")
        band.add_row(Text(f"{sc['params']['zone']['value']} · zone mean", style=MUTED), Text(f"round {self.res.round}", style=MUTED))
        band.add_row(Text.assemble((f"{s['zoneBefore']:.0f}", "bold"), "  →  ", (f"{s['zoneAfterLo']:.0f}–{s['zoneAfterHi']:.0f}", f"bold {ACCENT}")),
                     Text(f"−{s['deltaLo']:.0f} to −{s['deltaHi']:.0f} AQI"))
        counts = {k: sum(1 for v in self.verdicts.values() if v["status"] == k) for k in ("accepted", "rejected", "ask")}
        band.add_row(Text("under stated assumptions · a range, not a forecast", style=MUTED),
                     Text(f"{counts['accepted']} accepted · {counts['rejected']} rejected · {counts['ask']} ask"))

        layout = Layout()
        layout.split_column(Layout(Panel(head, box=box.SQUARE, border_style="grey35"), size=4), Layout(name="body"), Layout(Panel(band, box=box.SQUARE, border_style="grey35"), size=5))
        layout["body"].split_row(
            Layout(Panel(desks, title="the chamber", title_align="left", box=box.SQUARE, border_style="grey35"), ratio=2),
            Layout(Panel(Group(*self.lines[-18:]), title="debate", title_align="left", box=box.SQUARE, border_style="grey35"), ratio=5),
        )
        return layout


def _ledger_map(eng: client.Engine) -> dict[str, dict]:
    return {r["id"]: r for r in eng.get("/api/ledger")}


def watch(eng: client.Engine, run_id: str, speed: float) -> None:
    run = eng.get(f"/api/runs/{run_id}")
    board = Board(run, _ledger_map(eng))
    with Live(board.render(), console=console, refresh_per_second=12, screen=False) as live:
        for ev in eng.stream(f"/api/runs/{run_id}/stream", speed=speed):
            board.apply(ev)
            live.update(board.render())
    _summary(run)


def _summary(run: dict) -> None:
    sims = run["sims"]
    s = sims[max(sims, key=int)]["summary"]
    rej = [c for c in run["claims"].values() if c["status"] == "rejected"]
    console.print(f"[bold]GCORP_RUN_OK[/] {run['id']} · −{s['deltaLo']:.0f} to −{s['deltaHi']:.0f} AQI ({s['pctLo']:.1f}–{s['pctHi']:.1f}%) · {len(run['claims'])} claims, {len(rej)} rejected · runs/{run['id']}/")


# --------------------------------------------------------------------------- commands

def _out(args, data, render) -> None:
    if args.json:
        print(json.dumps(data, indent=1, ensure_ascii=False))
    else:
        render(data)


def cmd_run(args, eng):
    run = eng.post("/api/runs", {"text": args.policy, "zoneId": args.zone})
    if args.json:
        return print(json.dumps({k: v for k, v in run.items() if k != "sims"}, indent=1, ensure_ascii=False))
    console.print(f"[{MUTED}]engine {eng.url} ({eng.source})[/]")
    if args.watch:
        return watch(eng, run["id"], args.speed)
    _summary(run)


def cmd_ask(args, eng):
    out = eng.post(f"/api/runs/{args.run}/interject", {"text": args.question})
    run = out["run"]
    res = Resolver(run, _ledger_map(eng))
    res.round = max(int(k) for k in run["sims"])
    res.overrides = run["finalOverrides"]
    if args.json:
        return print(json.dumps(out["events"], indent=1, ensure_ascii=False))
    for ev in out["events"]:
        if ev["type"] == "message":
            console.print(Text.assemble((f"{Board.run_agent(ev['agent']):<15}", "bold"), res.text(ev["text"])))
        elif ev["type"] == "param":
            console.print(f"[{ACCENT}]               ↻ {ev['key']} {ev['from']} → {ev['to']}[/]")
    _summary(run)


def cmd_runs(args, eng):
    runs = eng.get("/api/runs")

    def render(rs):
        t = Table(box=box.SIMPLE_HEAD)
        for c in ("id", "policy", "AQI change", "claims"):
            t.add_column(c)
        for r in rs:
            s = r["sims"][max(r["sims"], key=int)]["summary"]
            rej = sum(1 for c in r["claims"].values() if c["status"] == "rejected")
            t.add_row(r["id"], r["scenario"]["title"], f"−{s['deltaLo']:.0f} to −{s['deltaHi']:.0f}", f"{len(r['claims'])} ({rej} rejected)")
        console.print(t)
    _out(args, runs, render)


def cmd_brief(args, eng):
    run = eng.get(f"/api/runs/{args.run}")
    res = Resolver(run, _ledger_map(eng))
    res.round = max(int(k) for k in run["sims"])
    res.overrides = run["finalOverrides"]
    if args.json:
        return print(json.dumps(run["claims"], indent=1, ensure_ascii=False))
    s = res.sim()["summary"]
    console.print(Text(run["scenario"]["title"], style="bold"))
    console.print(f"Under these assumptions, the estimated reduction is [bold]{s['deltaLo']:.0f}–{s['deltaHi']:.0f}[/] AQI points ({s['pctLo']:.1f}–{s['pctHi']:.1f}%).\n")
    for status, title in (("accepted", "Findings"), ("ask", "Open questions"), ("rejected", "Excluded")):
        cs = [c for c in run["claims"].values() if c["status"] == status]
        if not cs:
            continue
        console.print(f"[bold]{title}[/]")
        for c in cs:
            console.print(Text.assemble(("  · ", MUTED), res.text(c["text"], "strike" if status == "rejected" else "")))
            if status == "rejected":
                console.print(Text("      " + c["reason"], style=ACCENT))
        console.print()


def cmd_optimise(args, eng):
    out = eng.get("/api/optimise", zone=args.zone, target=args.target, budget=args.budget, months=args.months)

    def render(o):
        console.print(f"[bold]Goal[/] −{o['target']:g} AQI in {o['zone']} within ₹{o['budget']:g} crore over {o['months']} months\n")
        t = Table(box=box.SIMPLE_HEAD)
        for c in ("#", "portfolio", "₹ crore", "AQI change", "P(goal)"):
            t.add_column(c)
        for i, p in enumerate(o["portfolios"][:6], 1):
            t.add_row(str(i), " + ".join(p["labels"]), f"{p['cost']:.2f}", f"−{p['deltaLo']:.0f} to −{p['deltaHi']:.0f}", f"{p['pTarget'] * 100:.0f}%")
        console.print(t)
        if o.get("note"):
            console.print(f"[{ACCENT}]{o['note']}[/]")
    _out(args, out, render)


def cmd_track(args, eng):
    out = eng.get("/api/track-record")

    def render(o):
        t = Table(box=box.SIMPLE_HEAD)
        for c in ("replay", "predicted", "calibrated", "observed", "hit"):
            t.add_column(c)
        for c in o["cases"]:
            t.add_row(c["name"], f"{c['predicted'][0]:.1f}–{c['predicted'][1]:.1f}%", f"{c['calibrated'][0]:.1f}–{c['calibrated'][1]:.1f}% ×{c['factor']}",
                      f"{c['observed'][0]}–{c['observed'][1]}%", "✓" if c["hitCalibrated"] else "✗")
        console.print(t)
        console.print(f"[bold]raw {o['hits']}/{o['total']} → calibrated {o['hitsCalibrated']}/{o['total']}[/]  [{MUTED}]{o['note']}[/]")
    _out(args, out, render)


def cmd_sensors(args, eng):
    out = eng.get(f"/api/runs/{args.run}/sensors")

    def render(o):
        console.print(f"Current mean band ±{o['bandWidth'] / 2:.1f} AQI. One sensor ({o['unitCost']}) at:")
        for c in o["candidates"]:
            console.print(f"  cell ({c['x']},{c['z']})  narrows the band by [bold]{c['reduction'] * 100:.0f}%[/]")
    _out(args, out, render)


def cmd_ledger(args, eng):
    if args.row:
        return _out(args, eng.get(f"/api/ledger/{args.row}"), lambda r: console.print_json(data=r))
    rows = eng.get("/api/ledger")

    def render(rs):
        t = Table(box=box.SIMPLE_HEAD)
        for c in ("id", "what", "value", "status"):
            t.add_column(c)
        for r in rs:
            t.add_row(r["id"], r["label"], r["value"][:28], r["status"])
        console.print(t)
    _out(args, rows, render)


def cmd_council(args, eng):
    from .council import AGENTS
    _out(args, AGENTS, lambda a: [console.print(Text.assemble((f"{v['name']:<15}", "bold"), (f"{v['role']}  ", ""), (f"tools: {', '.join(v['tools']) or '—'}", MUTED))) for v in a.values()])


def cmd_data(args, eng):
    from . import data
    report = data.pull(online=not args.offline)
    _out(args, report, lambda r: [console.print(f"[bold]{k:<10}[/] {v}") for k, v in r.items()])


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="gcorp", description="Pre-check city air policy from the terminal.")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.add_argument("--endpoint", help="engine URL (default: env, config, or local daemon)")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="convene the council on a policy")
    r.add_argument("policy")
    r.add_argument("--zone")
    r.add_argument("--watch", action="store_true")
    r.add_argument("--speed", type=float, default=2.0)
    w = sub.add_parser("watch", help="live council view for a run")
    w.add_argument("run")
    w.add_argument("--speed", type=float, default=2.0)
    a = sub.add_parser("ask", help="challenge the council mid-run")
    a.add_argument("run")
    a.add_argument("question")
    sub.add_parser("runs", help="list runs")
    b = sub.add_parser("brief", help="print the brief")
    b.add_argument("run")
    o = sub.add_parser("optimise", help="goal + budget -> ranked portfolios")
    o.add_argument("--zone", default="anandvihar")
    o.add_argument("--target", type=float, default=15)
    o.add_argument("--budget", type=float, default=2)
    o.add_argument("--months", type=int, default=3)
    sub.add_parser("track-record", help="replays vs observed outcomes")
    s = sub.add_parser("sensors", help="where one more sensor helps most")
    s.add_argument("run")
    lg = sub.add_parser("ledger", help="source ledger")
    lg.add_argument("row", nargs="?")
    sub.add_parser("council", help="role contracts")
    d = sub.add_parser("data", help="data pipeline")
    d.add_argument("action", choices=["pull"])
    d.add_argument("--offline", action="store_true")
    sv = sub.add_parser("serve", help="run the engine in the foreground (port 8000)")
    sv.add_argument("--port", type=int, default=8000)
    sub.add_parser("status", help="engine status")
    sub.add_parser("stop", help="stop the local daemon")
    c = sub.add_parser("config", help="get/set config, e.g. endpoint")
    c.add_argument("action", choices=["get", "set"])
    c.add_argument("key", nargs="?")
    c.add_argument("value", nargs="?")
    args = p.parse_args(argv)

    if args.cmd == "serve":
        import uvicorn
        uvicorn.run("gcorp.api:app", host="127.0.0.1", port=args.port, log_level="info")
        return 0
    if args.cmd == "stop":
        console.print("stopped" if client.stop_daemon() else "no daemon running")
        return 0
    if args.cmd == "config":
        if args.action == "set":
            cfg = client.config_set(args.key, args.value)
        else:
            cfg = client.config_get()
        console.print_json(data=cfg)
        return 0
    if args.cmd == "status":
        try:
            url, src = client.resolve(start=False)
            h = client.httpx.get(url + "/api/health", timeout=3).json()
            _out(args, {"endpoint": url, "source": src, **h}, lambda d: console.print(f"[bold]engine up[/] {d['endpoint']} ({d['source']}) · {d['runs']} runs · {d['ledgerRows']} ledger rows"))
        except RuntimeError as e:
            console.print(f"engine down: {e}")
        return 0

    if args.cmd in ("data", "council"):
        {"data": cmd_data, "council": cmd_council}[args.cmd](args, None)
        if args.cmd == "data":
            try:  # tell a running engine to pick up the new rows
                url, _ = client.resolve(start=False)
                client.httpx.post(url + "/api/reload", timeout=5)
            except Exception:  # noqa: BLE001
                pass
        return 0
    try:
        eng = client.Engine(args.endpoint)
    except RuntimeError as e:
        console.print(f"[{ACCENT}]engine unavailable:[/] {e}")
        return 1
    handlers = {"run": cmd_run, "watch": lambda a, e: watch(e, a.run, a.speed), "ask": cmd_ask, "runs": cmd_runs, "brief": cmd_brief,
                "optimise": cmd_optimise, "track-record": cmd_track, "sensors": cmd_sensors, "ledger": cmd_ledger,
                "council": cmd_council, "data": cmd_data}
    handlers[args.cmd](args, eng)
    return 0


if __name__ == "__main__":
    sys.exit(main())
