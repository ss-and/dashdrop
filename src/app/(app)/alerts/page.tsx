/**
 * Threshold alerts. Create rules that watch one spreadsheet's metric and notify
 * (in-app bell / Slack) when it crosses a bound. Rules are evaluated on demand
 * with "今すぐ評価する"; firing is edge-triggered so it won't spam.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Topbar } from "@/components/app/Topbar";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";
import { AlertForm, type FormCollection } from "@/components/alerts/AlertForm";
import { EvaluateButton } from "@/components/alerts/EvaluateButton";
import { AlertRuleActions } from "@/components/alerts/AlertRuleActions";
import { conditionText, type FieldLite } from "@/lib/alert-format";
import type { AlertMetric } from "@/lib/alerts";

export default async function AlertsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const [collections, rules] = await Promise.all([
    db.collection.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        fields: {
          orderBy: { position: "asc" },
          select: { key: true, name: true, type: true },
        },
      },
    }),
    db.alertRule.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const collectionById = new Map(collections.map((c) => [c.id, c]));

  return (
    <>
      <Topbar user={user} title="アラート" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <p className="text-sm leading-relaxed text-ink-muted">
            スプレッドシートの数値がしきい値を超えたら、ベルや Slack
            に通知します。条件を作って「今すぐ評価する」で試せます。
          </p>

          {/* Rules list */}
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>アラート一覧</CardTitle>
              <EvaluateButton />
            </CardHeader>
            <CardBody className="p-0">
              {rules.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                  <NavIcon name="bell" className="h-6 w-6 text-ink-faint" />
                  <p className="text-sm text-ink-muted">
                    まだアラートがありません。下のフォームから作成できます。
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-ink-line">
                  {rules.map((r) => {
                    const collection = collectionById.get(r.collectionId);
                    const fields: FieldLite[] = collection?.fields ?? [];
                    const metric = r.metric as unknown as AlertMetric;
                    const condition = conditionText(
                      metric,
                      r.operator,
                      r.threshold,
                      fields,
                    );
                    return (
                      <li
                        key={r.id}
                        className="flex items-start justify-between gap-4 px-5 py-4"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium text-ink">
                              {r.name}
                            </p>
                            {!r.enabled && <Badge tone="neutral">停止中</Badge>}
                            {r.channel === "slack" && (
                              <Badge tone="info">Slack</Badge>
                            )}
                          </div>
                          <p className="text-xs text-ink-muted">
                            {collection?.name ?? "（削除されたシート）"}
                          </p>
                          <p className="font-mono text-sm text-ink-soft tabular-nums">
                            {condition}
                          </p>
                          {r.lastValue !== null &&
                            r.lastValue !== undefined && (
                              <p className="text-2xs text-ink-faint">
                                前回評価値:{" "}
                                {new Intl.NumberFormat("ja-JP").format(
                                  r.lastValue,
                                )}
                              </p>
                            )}
                        </div>
                        <AlertRuleActions id={r.id} enabled={r.enabled} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Create form */}
          <Card>
            <CardHeader>
              <CardTitle>アラートを作成</CardTitle>
            </CardHeader>
            <CardBody>
              <AlertForm collections={collections as FormCollection[]} />
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
