/**
 * 売上サマリー — the money story of the workspace in one card.
 *
 * Reads left to right as a funnel: 受注金額（商談）→ 請求金額（請求書）→ 入金済み。
 * Each step links to the object it comes from, so a number is always one click
 * from the rows behind it. Under the funnel, 入金状況の内訳 lists one row per
 * invoice status with the same Badge treatment the CRM list views use.
 *
 * Pure presentation: the home page (server component) does the aggregation.
 */
import { Fragment } from "react";
import Link from "next/link";
import { Badge, toneFromColor } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { NavIcon } from "@/components/app/icons";

export interface RevenueStep {
  key: string;
  label: string;
  /** Summed amount in yen. */
  amount: number;
  /** How many records make up the amount. */
  count: number;
  href: string;
}

export interface RevenueStatusRow {
  value: string;
  label: string;
  /** Select option color (success / warning / danger / info / khaki). */
  color?: string;
  count: number;
  amount: number;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function RevenueSummary({
  steps,
  statuses,
  invoicesHref,
}: {
  steps: RevenueStep[];
  statuses: RevenueStatusRow[];
  /** Link to the 請求書 object. */
  invoicesHref: string;
}) {
  if (steps.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-ink-line px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-sm font-semibold text-ink">売上サマリー</h3>
          <p className="truncate text-xs text-ink-muted">
            商談から請求・入金までのつながり
          </p>
        </div>
        <Link
          href={invoicesHref}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
        >
          請求書を開く
          <NavIcon name="chevron" className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-4 px-4 py-4">
        {/* 受注 → 請求 → 入金 */}
        <div className="flex flex-wrap items-stretch gap-2">
          {steps.map((s, i) => (
            <Fragment key={s.key}>
              <Link
                href={s.href}
                className="group min-w-[10rem] flex-1 rounded border border-ink-line bg-paper-sunken px-3 py-2 transition-colors hover:border-khaki-300 hover:bg-khaki-50"
              >
                <p className="truncate text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  {s.label}
                </p>
                <p className="mt-0.5 truncate text-lg font-semibold tabular-nums text-ink group-hover:text-khaki-800">
                  {yen(s.amount)}
                </p>
                <p className="truncate text-2xs tabular-nums text-ink-muted">
                  {s.count.toLocaleString()} 件
                </p>
              </Link>
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="flex shrink-0 items-center text-ink-faint"
                >
                  <NavIcon name="chevron" className="h-4 w-4" />
                </span>
              )}
            </Fragment>
          ))}
        </div>

        {/* 入金状況の内訳 */}
        {statuses.length > 0 && (
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              入金状況の内訳
            </p>
            <ul className="mt-2 divide-y divide-ink-line overflow-hidden rounded border border-ink-line">
              {statuses.map((s) => (
                <li
                  key={s.value}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <Badge tone={toneFromColor(s.color)}>{s.label}</Badge>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-ink-muted">
                    {s.count.toLocaleString()} 件
                  </span>
                  <span className="w-32 shrink-0 text-right text-sm font-medium tabular-nums text-ink">
                    {yen(s.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
