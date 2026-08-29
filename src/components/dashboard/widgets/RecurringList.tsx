import { formatValue } from "@/lib/utils";
import type { RecurringData } from "@/lib/widgets";

/**
 * 定期支払いの一覧。
 *
 * 一番上に「月あたりいくら」を置く。この画面を開く人が知りたいのはそれで、
 * 内訳は確かめるために見るものだから。年あたりを併記するのは、月 ¥1,480 が
 * 年 ¥17,760 だと分かった瞬間に判断が変わることがあるため。
 *
 * 止まったものは**消さずに、薄く残す**。「先月まであった行が今月は無い」より
 * 「止まったと判断した」と書いてあるほうが確かめようがある。合計には入れない。
 */

/** 0件と「見ていない」を同じ顔で出さないための、空のときの説明。 */
function Empty({ notApplicable }: { notApplicable: boolean }) {
  return (
    <div className="flex h-24 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm text-ink-muted">
        {notApplicable
          ? "この表からは定期支払いを探せません"
          : "くり返し出ている支払いは見つかりませんでした"}
      </p>
      <p className="text-xs text-ink-faint">
        {notApplicable
          ? "日付・摘要・金額にあたる列が見つかりませんでした"
          : `同じ相手・同じ間隔で3回以上あるものを探しています`}
      </p>
    </div>
  );
}

export function RecurringList({ data }: { data: RecurringData }) {
  if (data.items.length === 0) {
    return <Empty notApplicable={data.notApplicable} />;
  }

  return (
    <div className="space-y-3">
      {/* 合計。ここが主役なので、内訳より一段大きく置く。 */}
      <div className="flex items-baseline justify-between gap-3 rounded-md bg-sunken px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-xs text-ink-muted">月あたり</div>
          <div className="text-xl font-semibold tabular-nums text-ink">
            {formatValue(data.monthlyTotal, "currency")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-muted">年あたり</div>
          <div className="text-sm font-medium tabular-nums text-ink-muted">
            {formatValue(data.yearlyTotal, "currency")}
          </div>
        </div>
      </div>

      <ul className="divide-y divide-ink-line">
        {data.items.map((item) => (
          <li
            key={`${item.label}-${item.cadence}`}
            className={`flex items-center justify-between gap-3 py-2 ${
              item.active ? "" : "opacity-55"
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm text-ink" title={item.label}>
                {item.label}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                <span>{item.cadence}</span>
                <span aria-hidden>·</span>
                <span>{item.occurrences}回</span>
                {item.variable && (
                  <span className="rounded border border-ink-line px-1 py-px text-[10px] text-ink-muted">
                    変動
                  </span>
                )}
                {!item.active && (
                  <span className="rounded border border-ink-line px-1 py-px text-[10px] text-ink-muted">
                    止まった（最終 {item.last}）
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-medium tabular-nums text-ink">
                {formatValue(item.amount, "currency")}
              </div>
              {/* 毎月以外は、比べられるように月あたりも出す。 */}
              {item.cadence !== "毎月" && (
                <div className="text-xs tabular-nums text-ink-faint">
                  月 {formatValue(item.monthly, "currency")}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.endedCount > 0 && (
        <p className="text-xs text-ink-faint">
          薄い行は、最後の支払いから間隔の2倍以上あいているものです。合計には
          入れていません。
        </p>
      )}
    </div>
  );
}
