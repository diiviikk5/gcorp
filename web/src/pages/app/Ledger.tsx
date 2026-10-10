import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/app/AppLayout";
import { allLedger } from "@/data/ledger";
import { useUi } from "@/store/ui";

export default function Ledger() {
  const [q, setQ] = useState("");
  const open = useUi((s) => s.openProvenance);
  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return allLedger().filter((r) => !t || `${r.id} ${r.label} ${r.source} ${r.scope}`.toLowerCase().includes(t));
  }, [q]);

  return (
    <div>
      <PageHeader
        title="Source ledger"
        actions={
          <label className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] ring-1 ring-inset ring-line focus-within:ring-white/30">
            <Search className="size-3.5 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows" className="w-40 bg-transparent outline-none placeholder:text-faint" />
          </label>
        }
      />
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <p className="max-w-2xl text-[13px] leading-relaxed text-mute">
          Every number the council or the brief uses resolves to one of these rows. Claims that cite anything else are rejected. All values are demo data shaped like the real table.
        </p>
        <table className="mt-6 w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-faint">
              <th className="w-[84px] py-2.5 font-normal">Row</th>
              <th className="py-2.5 font-normal">What</th>
              <th className="py-2.5 text-right font-normal">Value</th>
              <th className="hidden py-2.5 pl-6 font-normal lg:table-cell">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} onClick={() => open({ ref: r.id })} className="cursor-pointer transition-colors hover:bg-white/[0.02]">
                <td className="py-3 font-mono text-[11.5px] text-mute">{r.id}</td>
                <td className="py-3">
                  <div>{r.label}</div>
                  <div className="text-[11.5px] text-faint">{r.scope}</div>
                </td>
                <td className="max-w-[220px] py-3 text-right font-mono text-[12px] tabular">{r.value}</td>
                <td className="hidden max-w-[280px] truncate py-3 pl-6 text-[12px] text-mute lg:table-cell">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
