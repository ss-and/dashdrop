import { cn } from "@/lib/utils";

/**
 * DashDrop mark: a stack of spreadsheet rows with one "dropped" cell —
 * nods to the spreadsheet-native, database-underneath idea. Uses currentColor
 * so it inherits khaki wherever placed. Squared corners, no gloss.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-6 w-6 text-khaki-600", className)}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" className="stroke-current" strokeWidth="1.6" />
      <line x1="3" y1="9" x2="21" y2="9" className="stroke-current" strokeWidth="1.4" />
      <line x1="3" y1="15" x2="21" y2="15" className="stroke-current" strokeWidth="1.4" />
      <line x1="9" y1="3" x2="9" y2="21" className="stroke-current" strokeWidth="1.4" />
      <rect x="10.5" y="10.5" width="7" height="7" rx="1" className="fill-current" opacity="0.9" />
    </svg>
  );
}

export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {showText && (
        <span className="text-lg font-semibold tracking-tight text-ink">
          Dash<span className="text-khaki-600">Drop</span>
        </span>
      )}
    </span>
  );
}
