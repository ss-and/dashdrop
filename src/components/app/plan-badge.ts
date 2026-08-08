import { getPlan } from "@/lib/plans";

/** Small helper mapping a plan id to a badge label + classes for the topbar. */
export function getPlanBadge(planId: string): { label: string; className: string } {
  const plan = getPlan(planId);
  const styles: Record<string, string> = {
    free: "bg-paper-sunken text-ink-muted border-ink-line",
    pro: "bg-khaki-100 text-khaki-800 border-khaki-300",
    business: "bg-ink text-paper border-ink",
  };
  return { label: plan.name, className: styles[plan.id] ?? styles.free };
}
