import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/cn";

export function Segmented<T extends string>({ value, onChange, options, size = "sm", className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; size?: "sm" | "md"; className?: string }) {
  const id = useId();
  return (
    <div className={cn("relative inline-flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-inset ring-white/[0.08]", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn("relative z-10 inline-flex items-center gap-1.5 rounded-md font-medium transition-colors", size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-8 px-3 text-[13px]", active ? "text-fg" : "text-mute hover:text-fg")}
          >
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 -z-10 rounded-md bg-white/[0.09] shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_1px_0_0_rgb(255_255_255/0.06)_inset]" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
