import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6", className)} aria-hidden>
      <defs>
        <linearGradient id="lg-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d6e2ff" />
          <stop offset="1" stopColor="#8fb3ff" />
        </linearGradient>
        <linearGradient id="lg-l" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d93ff" />
          <stop offset="1" stopColor="#3b4f8f" />
        </linearGradient>
        <linearGradient id="lg-r" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a63b8" />
          <stop offset="1" stopColor="#222c52" />
        </linearGradient>
      </defs>
      <path d="M16 3l11 6.3L16 15.6 5 9.3z" fill="url(#lg-top)" />
      <path d="M5 9.3l11 6.3V29L5 22.7z" fill="url(#lg-l)" />
      <path d="M27 9.3L16 15.6V29l11-6.3z" fill="url(#lg-r)" />
      <path d="M10 14.8l3 1.7v5l-3-1.7zM19 16.5l3-1.7v5l-3 1.7z" fill="#0b0d12" opacity=".35" />
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
