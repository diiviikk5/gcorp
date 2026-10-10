import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BookOpenCheck, Columns3, FileText, Home, LayoutGrid, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useUi } from "@/store/ui";
import { useRuns } from "@/store/runs";
import { cn } from "@/lib/cn";
import { Kbd } from "../ui/Badge";

interface Item { id: string; label: string; hint?: string; icon: React.ComponentType<{ className?: string }>; to: string; group: string }

export function CommandPalette() {
  const open = useUi((s) => s.palette);
  const setOpen = useUi((s) => s.setPalette);
  const runs = useRuns((s) => s.runs);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      { id: "new", label: "New assessment", hint: "N", icon: Plus, to: "/app/new", group: "Actions" },
      { id: "ov", label: "Overview", icon: LayoutGrid, to: "/app", group: "Navigate" },
      { id: "cmp", label: "Compare policies", icon: Columns3, to: "/app/compare", group: "Navigate" },
      { id: "led", label: "Source ledger", icon: BookOpenCheck, to: "/app/ledger", group: "Navigate" },
      { id: "home", label: "Landing page", icon: Home, to: "/", group: "Navigate" },
    ];
    const rs: Item[] = runs.map((r) => ({ id: r.id, label: r.scenario.title, hint: r.id, icon: FileText, to: `/app/runs/${r.id}`, group: "Runs" }));
    const all = [...base, ...rs];
    if (!q.trim()) return all;
    const t = q.toLowerCase();
    return all.filter((i) => i.label.toLowerCase().includes(t) || i.hint?.toLowerCase().includes(t));
  }, [q, runs]);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 20); } }, [open]);
  useEffect(() => setSel(0), [q]);

  const go = (i?: Item) => { if (!i) return; setOpen(false); navigate(i.to); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-bg/80 pt-[14vh] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.97, y: -8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.25 }}
            className="w-[580px] max-w-[92vw] overflow-hidden rounded-2xl border border-line-2 bg-s1/95 shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                  if (e.key === "Enter") go(items[sel]);
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Search runs, pages, actions…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-1.5">
              {items.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-mute">Nothing matches “{q}”.</div>}
              {items.map((i, idx) => (
                <div key={i.id}>
                  {(idx === 0 || items[idx - 1].group !== i.group) && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-faint">{i.group}</div>}
                  <button
                    onMouseMove={() => setSel(idx)}
                    onClick={() => go(i)}
                    className={cn("flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13px]", sel === idx ? "bg-black/[0.07] text-fg" : "text-mute")}
                  >
                    <i.icon className="size-4 shrink-0" />
                    <span className="truncate">{i.label}</span>
                    {i.hint && <span className="ml-auto font-mono text-[11px] text-faint">{i.hint}</span>}
                    {sel === idx && <ArrowRight className="size-3.5 shrink-0" />}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
