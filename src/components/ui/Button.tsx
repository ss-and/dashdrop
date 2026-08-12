import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

/**
 * Every variant defines an explicit `active:` state, not just `hover:`. A
 * hover-only button gives no acknowledgement at the moment of the click, which
 * is what makes an interface feel unresponsive even when it is fast.
 */
const variants: Record<Variant, string> = {
  primary:
    "bg-khaki-500 text-white hover:bg-khaki-600 active:bg-khaki-700 border border-khaki-600",
  secondary:
    "bg-paper-raised text-ink hover:bg-paper-sunken active:bg-ink-line border border-ink-rule",
  outline:
    "bg-transparent text-khaki-700 hover:bg-khaki-50 active:bg-khaki-100 border border-khaki-400",
  ghost:
    "bg-transparent text-ink-soft hover:bg-paper-sunken hover:text-ink active:bg-ink-line border border-transparent",
  danger:
    "bg-danger text-white hover:brightness-110 active:brightness-95 border border-danger",
};

/**
 * Heights follow the 36 / 40 / 44px hit-target ladder. The old `sm` was 32px,
 * below the comfortable minimum for a pointer and well below it for touch.
 */
const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * The button's classes, exposed so a `<Link>` that acts as a button looks
 * identical to one. Several screens had hand-rolled anchor styling that drifted
 * out of sync (32px tall, wrong khaki, no press state); they use this instead.
 */
export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded font-medium",
    "transition-colors duration-fast active:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-khaki-500/40",
    "disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    variants[variant],
    sizes[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={buttonStyles({ variant, size, className })}
      {...props}
    />
  ),
);
Button.displayName = "Button";
