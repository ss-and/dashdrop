/**
 * 「ダッシュボード」 — a plain list of the workspace's saved dashboards.
 *
 * ダッシュボードは自分の URL（/d/{id}）で開き、シートごとの分析タブもあるので、
 * ホームに埋め込んで描画する必要はない。ここは行の一覧だけ。
 */
import Link from "next/link";
import { NavIcon } from "@/components/app/icons";
import { HomeRow } from "./HomeRow";

export interface DashboardEntry {
  id: string;
  name: string;
  icon?: string;
}

export function DashboardSection({
  dashboards,
}: {
  dashboards: DashboardEntry[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="section-title">ダッシュボード</h2>

      {dashboards.length > 0 && (
        <div className="overflow-hidden rounded-md border border-ink-line bg-paper-raised">
          <ul>
            {dashboards.map((d) => (
              <HomeRow
                key={d.id}
                href={`/d/${d.id}`}
                icon={d.icon ?? "dashboard"}
                name={d.name}
              />
            ))}
          </ul>
        </div>
      )}

      <Link
        href="/dashboards"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-khaki-700 hover:underline"
      >
        <NavIcon name="plus" className="h-4 w-4" />
        ダッシュボードを追加
      </Link>
    </section>
  );
}
