import { cn } from "@/lib/utils";

type Tone = "khaki" | "success" | "warning" | "danger" | "info" | "neutral";
type Variant = "dot" | "soft";

/**
 * Status colours. `dot` carries the colour in a 6px marker and leaves the label
 * as normal text; `soft` is the filled chip, kept for the few places where the
 * value really is a standalone object (plan name, category label).
 *
 * `dot` is the default on purpose. A grid full of pale filled rectangles — one
 * per select cell — was the loudest part of the old look, and it also made the
 * values harder to read than plain text would have been.
 */
const dotTones: Record<Tone, string> = {
  khaki: "bg-khaki-500",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-ink-faint",
};

const softTones: Record<Tone, string> = {
  khaki: "bg-khaki-100 text-khaki-800",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-paper-sunken text-ink-soft",
};

export function Badge({
  tone = "neutral",
  variant = "dot",
  className,
  children,
  ...props
}: {
  tone?: Tone;
  variant?: Variant;
} & React.HTMLAttributes<HTMLSpanElement>) {
  if (variant === "soft") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium",
          softTones[tone],
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-ink",
        className,
      )}
      {...props}
    >
      {/* A neutral value carries no signal, so it gets no marker at all. */}
      {tone !== "neutral" && (
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotTones[tone])}
        />
      )}
      {children}
    </span>
  );
}

/** Map a select option color name to a Badge tone. */
export function toneFromColor(color?: string): Tone {
  switch (color) {
    case "success":
    case "warning":
    case "danger":
    case "info":
    case "khaki":
      return color;
    default:
      return "neutral";
  }
}
