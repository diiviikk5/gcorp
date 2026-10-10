import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6", className)} aria-hidden>
      <path d="M16 3l11 6.3L16 15.6 5 9.3z" fill="#fff" />
      <path d="M5 9.3l11 6.3V29L5 22.7z" fill="#8a8a8a" />
      <path d="M27 9.3L16 15.6V29l11-6.3z" fill="#3a3a3a" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">Air Council</span>
    </span>
  );
}
