"""`gcorp aws ...` — provision, inspect and demo the AWS side from the terminal."""

from __future__ import annotations

import json

from rich.console import Console
from rich.table import Table

from . import PREFIX, REGION, STATE, state

console = Console(highlight=False)
ACCENT = "#ff4a1c"


def status() -> None:
    st = state()
    if not st.get("account"):
        console.print(f"not provisioned · run [bold]gcorp aws up[/] (profile/region {REGION}, state {STATE})")
        return
    t = Table(box=None, pad_edge=False, show_header=True, header_style="dim")
    t.add_column("service")
    t.add_column("resource")
    t.add_column("")
    rows = [
        ("S3", f"s3://{st.get('bucket', '—')}", "bucket" in st),
        ("DynamoDB", ", ".join((st.get("tables") or {}).values()) or "—", bool(st.get("tables"))),
        ("SSM", st.get("openaqParam", "no OpenAQ key"), "openaqParam" in st),
        ("SNS", (st.get("topic") or "—").rsplit(":", 1)[-1], "topic" in st),
        ("Lambda", ", ".join(f"{PREFIX}-{k}" for k in st.get("lambdas", {})) or "—", bool(st.get("lambdas"))),
        ("Step Functions", (st.get("stateMachine") or "—").rsplit(":", 1)[-1], "stateMachine" in st),
        ("Scheduler", f"{st.get('schedule', '—')} · rate(1 hour)", "schedule" in st),
        ("CloudWatch", "dashboard 'gcorp' · namespace Gcorp", "dashboard" in st),
        ("Guardrails", f"{PREFIX}-grounding v{st['guardrail']['version']}" if st.get("guardrail") else "—", "guardrail" in st),
        ("Knowledge Base", f"{st['kb']['id']} on S3 Vectors" if st.get("kb") else "—", "kb" in st),
        ("AgentCore Gateway", (st.get("gateway") or {}).get("url", "—"), "gateway" in st),
        ("AgentCore Policy", f"{(st.get('policyEngine') or {}).get('policies', 0)} Cedar policies · ENFORCE" if st.get("policyEngine") else "—", "policyEngine" in st),
        ("AgentCore Runtime", f"{st['runtime']['id']} · {st['runtime']['status']}" if st.get("runtime") else "—",
         (st.get("runtime") or {}).get("status") == "READY"),
        ("IAM", f"{len(st.get('roles', {}))} service roles · {len(st.get('agentRoles', {}))} agent identities", bool(st.get("agentRoles"))),
    ]
    for name, res, ok in rows:
        t.add_row(name, res, "[green]●[/]" if ok else f"[{ACCENT}]○[/]")
    console.print(f"[bold]gcorp on aws[/] · account {st['account']} · {st['region']}\n")
    console.print(t)
    for step, err in (st.get("errors") or {}).items():
        console.print(f"[{ACCENT}]! {step}[/] {err[:160]}")
    if st.get("dashboard"):
        console.print(f"\n[dim]dashboard[/] {st['dashboard']}")


def gate_demo() -> None:
    """Show Cedar at work: the same tool call, permitted for one agent and refused for another."""
    from .cloud import call_tool
    cases = [
        ("externalities", "propose_change", {"key": "regionalPct", "value": "40", "agent": "externalities"}, "its contract names regionalPct"),
        ("economist", "propose_change", {"key": "regionalPct", "value": "40", "agent": "economist"}, "not in its contract"),
        ("skeptic", "propose_change", {"key": "compliancePct", "value": "55", "agent": "skeptic"}, "its contract names compliancePct"),
        ("skeptic", "propose_change", {"key": "regionalPct", "value": "10", "agent": "skeptic"}, "wrong input for this role"),
        ("engineer", "ledger_lookup", {"rowId": "L-011"}, "everyone may read the ledger"),
        ("engineer", "assess", {"policy": "Ban trucks at night"}, "only the planner may launch a run"),
    ]
    for agent, tool, a, why in cases:
        r = call_tool(agent, tool, a)
        mark = "[green]permit[/]" if r.get("ok") else f"[{ACCENT}]deny[/]  " if r.get("denied") else "[yellow]error[/] "
        console.print(f"{mark} {agent:<14} {tool}({json.dumps(a)[:46]}) [dim]— {why}[/]")
        if not r.get("ok") and not r.get("denied"):
            console.print(f"        [dim]{str(r.get('error'))[:200]}[/]")


def run(args) -> int:
    from . import provision
    if args.action == "up":
        console.print(f"[bold]gcorp aws up[/] · {REGION}\n")
        provision.up([s.strip() for s in args.only.split(",")] if args.only else None, email=args.email)
        console.print()
        status()
    elif args.action == "status":
        status()
    elif args.action == "down":
        if not args.yes:
            console.print("this deletes every gcorp resource in the account. rerun with [bold]--yes[/]")
            return 1
        provision.down()
    elif args.action == "gate":
        gate_demo()
    elif args.action == "tools":
        from .cloud import list_tools
        console.print_json(data=list_tools())
    elif args.action == "watch":
        from .cloud import executions, run_watch
        console.print_json(data=run_watch() if args.now else executions())
    elif args.action == "readings":
        from .cloud import readings
        r = readings()
        if not r.get("ok"):
            console.print_json(data=r)
            return 1
        t = Table(box=None, header_style="dim")
        for col in ("zone", "AQI", "band", "PM2.5 24h", "kind", "source"):
            t.add_column(col)
        for x in sorted(r["readings"], key=lambda x: -x["aqi"]):
            t.add_row(x["zone"], str(int(x["aqi"])), x["band"], f"{x['pm25']:.0f}", x["kind"], x["source"])
        console.print(f"[dim]updated {r['updatedAt']}[/]")
        console.print(t)
    elif args.action == "search":
        from .cloud import kb_search
        console.print_json(data=kb_search(" ".join(args.query) or "truck diversion"))
    elif args.action == "invoke":
        from .cloud import invoke_runtime
        r = invoke_runtime({"policy": " ".join(args.query) or "Ban trucks from entering Anand Vihar at night", "backend": args.backend})
        if r.get("ok"):
            run_ = r["run"]
            s = run_["sims"][str(max(int(k) for k in run_["sims"]))]["summary"]
            console.print(f"[bold]{run_['scenario']['title']}[/] on AgentCore Runtime · {run_['host']['seconds']}s")
            console.print(f"Δ {s['deltaLo']:.0f}–{s['deltaHi']:.0f} AQI · confidence {run_['confidence']['grade']} · backends {run_['host']['backends']}")
        else:
            console.print_json(data=r)
    return 0


def add_parser(sub) -> None:
    a = sub.add_parser("aws", help="provision / inspect Gcorp on AWS (Bedrock, AgentCore, Step Functions…)")
    a.add_argument("action", choices=["up", "status", "down", "gate", "tools", "watch", "readings", "search", "invoke"])
    a.add_argument("query", nargs="*")
    a.add_argument("--only", help="comma-separated steps: core,storage,secrets,alerts,iam,lambdas,watch,dashboard,guardrail,kb,gateway,policy,runtime")
    a.add_argument("--email", help="subscribe this address to air alerts (SNS sends a confirmation email)")
    a.add_argument("--yes", action="store_true")
    a.add_argument("--now", action="store_true", help="watch: start an execution now")
    a.add_argument("--backend", default="bedrock", choices=["bedrock", "rules"])
