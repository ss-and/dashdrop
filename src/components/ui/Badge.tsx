import { cn } from "@/lib/utils";

type Tone = "khaki" | "success" | "warning" | "danger" | "info" | "neutral";

const tones: Record<Tone, string> = {
  khaki: "bg-khaki-100 text-khaki-800 border-khaki-200",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  info: "bg-info-soft text-info border-info/20",
  neutral: "bg-paper-sunken text-ink-soft border-ink-line",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: { tone?: Tone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
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
