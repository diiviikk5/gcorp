import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { BadgeCheck, BookOpenCheck, Building2, Columns3, LayoutGrid, ListChecks, Plus, Search, Target, Wind } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { useRunList, useRuns } from "@/store/runs";
import { useUi } from "@/store/ui";
import { Logo } from "../ui/Logo";
import { Kbd } from "../ui/Badge";
import { ProvenanceSheet } from "./ProvenanceSheet";
import { CommandPalette } from "./CommandPalette";

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/app/assessments", label: "Assessments", icon: ListChecks },
  { to: "/app/plan", label: "Plan", icon: Target },
  { to: "/app/compare", label: "Compare", icon: Columns3 },
  { to: "/app/track-record", label: "Track record", icon: BadgeCheck },
  { to: "/app/breathe", label: "Breathe", icon: Wind },
  { to: "/app/ledger", label: "Source ledger", icon: BookOpenCheck },
];

export function AppLayout() {
  const runs = useRunList();
  const engine = useRuns((s) => s.engine);
  const connect = useRuns((s) => s.connect);
  useEffect(() => { if (engine === "unknown") connect(); }, [engine, connect]);
  const setPalette = useUi((s) => s.setPalette);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const fullBleed = /^\/app\/runs\/[^/]+$/.test(pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input,textarea,[contenteditable]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); }
      else if (!typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); navigate("/app/new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setPalette]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line md:flex">
        <div className="flex h-12 items-center px-3.5">
          <NavLink to="/" className="rounded-md px-1 py-1 hover:bg-black/[0.04]"><Logo /></NavLink>
        </div>

        <div className="mt-2 flex gap-1.5 px-2.5">
          <NavLink to="/app/new" className="flex h-8 flex-1 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium ring-1 ring-inset ring-black/[0.1] transition-colors hover:bg-black/[0.05]">
            <Plus className="size-3.5" /> New assessment <Kbd className="ml-auto">N</Kbd>
          </NavLink>
          <button onClick={() => setPalette(true)} className="grid size-8 place-items-center rounded-lg text-mute ring-1 ring-inset ring-black/[0.08] hover:bg-black/[0.05] hover:text-fg" aria-label="Search">
            <Search className="size-3.5" />
          </button>
        </div>

        <nav className="mt-4 space-y-px px-2.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors", isActive ? "bg-black/[0.07] text-fg" : "text-mute hover:bg-black/[0.04] hover:text-fg")}
            >
              <n.icon className="size-4" strokeWidth={1.8} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-3 px-2.5">
          <NavLink to="/council" className="flex h-9 items-center gap-2.5 rounded-md border border-fg/80 px-2 text-[13px] font-medium transition-colors hover:bg-fg hover:text-bg">
            <Building2 className="size-4" strokeWidth={1.8} /> Council House
            <span className="ml-auto font-mono text-[10px] opacity-60">3D</span>
          </NavLink>
        </div>

        <div className="mt-6 px-4 text-[11px] text-faint">Recent</div>
        <div className="mt-1.5 flex-1 space-y-px overflow-y-auto px-2.5">
          {runs.slice(0, 8).map((r) => (
            <NavLink
              key={r.id}
              to={`/app/runs/${r.id}`}
              className={({ isActive }) => cn("group flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors", isActive ? "bg-black/[0.07] text-fg" : "text-mute hover:bg-black/[0.04] hover:text-fg")}
            >
              <span className="truncate">{r.scenario.title.split(" · ")[0]}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-faint">{r.scenario.title.split(" · ")[1]}</span>
            </NavLink>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-3 text-[11px] text-faint">
          <span className="flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", engine === "online" ? "bg-[var(--color-accent)]" : "bg-faint")} />{engine === "online" ? "engine live" : "offline mock"}</span>
          <button onClick={() => setPalette(true)} className="flex items-center gap-0.5 hover:text-fg"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></button>
        </div>
      </aside>

      <main className={cn("relative min-w-0 flex-1", fullBleed ? "overflow-hidden" : "overflow-y-auto")}>
        <Outlet />
      </main>
      <ProvenanceSheet />
      <CommandPalette />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; crumbs?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="flex h-12 items-center gap-3 px-6 text-[13px]">
        {crumbs ?? <span className="font-medium">{title}</span>}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
      {subtitle && <div className="px-6 pb-3 text-[13px] text-mute">{subtitle}</div>}
    </div>
  );
}
