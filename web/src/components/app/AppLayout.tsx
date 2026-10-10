import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { BookOpenCheck, ChevronsUpDown, Columns3, Command, LayoutGrid, ListChecks, Plus, Search, Settings2 } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { useRuns } from "@/store/runs";
import { useUi } from "@/store/ui";
import { Logo } from "../ui/Logo";
import { Kbd } from "../ui/Badge";
import { ProvenanceSheet } from "./ProvenanceSheet";
import { CommandPalette } from "./CommandPalette";

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/app/assessments", label: "Assessments", icon: ListChecks },
  { to: "/app/compare", label: "Compare", icon: Columns3 },
  { to: "/app/ledger", label: "Source ledger", icon: BookOpenCheck },
];

export function AppLayout() {
  const runs = useRuns((s) => s.runs);
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
      <aside className="hidden w-[244px] shrink-0 flex-col border-r border-line bg-s1/60 md:flex">
        <div className="flex h-12 items-center px-3.5">
          <NavLink to="/" className="rounded-md px-1 py-1 hover:bg-white/[0.04]"><Logo /></NavLink>
        </div>

        <div className="px-2.5">
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]">
            <span className="grid size-6 place-items-center rounded-md bg-gradient-to-br from-[#ffb36b] to-[#ff6b8a] text-[10px] font-bold text-black/80">DL</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">Delhi · NCT</span>
              <span className="block truncate text-[11px] text-faint">Urban planning cell</span>
            </span>
            <ChevronsUpDown className="size-3.5 text-faint" />
          </button>
        </div>

        <div className="mt-3 flex gap-1.5 px-2.5">
          <NavLink to="/app/new" className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 text-[13px] font-medium ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-white/[0.09]">
            <Plus className="size-3.5" /> New assessment <Kbd className="ml-auto">N</Kbd>
          </NavLink>
          <button onClick={() => setPalette(true)} className="grid size-8 place-items-center rounded-lg text-mute ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.05] hover:text-fg" aria-label="Search">
            <Search className="size-3.5" />
          </button>
        </div>

        <nav className="mt-4 space-y-px px-2.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors", isActive ? "bg-white/[0.07] text-fg" : "text-mute hover:bg-white/[0.04] hover:text-fg")}
            >
              <n.icon className="size-4" strokeWidth={1.8} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 px-4 eyebrow !text-[10px]">Recent runs</div>
        <div className="mt-1.5 flex-1 space-y-px overflow-y-auto px-2.5">
          {runs.slice(0, 8).map((r) => (
            <NavLink
              key={r.id}
              to={`/app/runs/${r.id}`}
              className={({ isActive }) => cn("group flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors", isActive ? "bg-white/[0.07] text-fg" : "text-mute hover:bg-white/[0.04] hover:text-fg")}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", r.kind === "replay" ? "bg-a-skeptic" : r.scenario.warnings.some((w) => w.level === "block") ? "bg-bad" : "bg-ok")} />
              <span className="truncate">{r.scenario.title.split(" · ")[0]}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-faint">{r.scenario.title.split(" · ")[1]}</span>
            </NavLink>
          ))}
        </div>

        <div className="border-t border-line p-2.5">
          <button onClick={() => setPalette(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-mute hover:bg-white/[0.04] hover:text-fg">
            <Command className="size-3.5" /> Command menu <span className="ml-auto flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </button>
          <div className="mt-1 flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <span className="grid size-6 place-items-center rounded-full bg-s4 text-[10px] font-semibold text-mute ring-1 ring-line-2">AP</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px]">A. Planner</span>
              <span className="block truncate text-[10.5px] text-faint">Demo workspace</span>
            </span>
            <Settings2 className="size-3.5 text-faint" />
          </div>
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
