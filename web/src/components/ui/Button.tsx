import { forwardRef } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,color,border-color,box-shadow,transform] duration-150 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(180deg,#f4f6fb,#d9dee8)] text-[#0b0d12] shadow-[0_1px_0_0_rgb(255_255_255/0.6)_inset,0_0_0_1px_rgb(255_255_255/0.2),0_8px_24px_-8px_rgb(143_179_255/0.45)] hover:shadow-[0_1px_0_0_rgb(255_255_255/0.6)_inset,0_0_0_1px_rgb(255_255_255/0.35),0_10px_32px_-8px_rgb(143_179_255/0.6)]",
  secondary: "bg-s3 text-fg shadow-[0_0_0_1px_var(--color-line-2),0_1px_0_0_rgb(255_255_255/0.05)_inset] hover:bg-s4",
  outline: "text-fg shadow-[0_0_0_1px_var(--color-line-2)] hover:bg-white/[0.04]",
  ghost: "text-mute hover:bg-white/[0.05] hover:text-fg",
  danger: "bg-bad/10 text-bad shadow-[0_0_0_1px_rgb(255_107_107/0.3)] hover:bg-bad/15",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12.5px]",
  md: "h-9 px-3.5 text-[13.5px]",
  lg: "h-11 px-5 text-[14.5px]",
};

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  to?: string;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant = "secondary", size = "md", className, to, children, ...rest }, ref) {
  const cls = cn(base, variants[variant], sizes[size], className);
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  return (
    <button ref={ref} className={cls} {...rest}>
      {children}
    </button>
  );
});
