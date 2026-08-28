/**
 * Threshold alerts. Create rules that watch one spreadsheet's metric and notify
 * (in-app bell / Slack) when it crosses a bound. Rules are evaluated on demand
 * with "今すぐ評価する"; firing is edge-triggered so it won't spam.
 *
 * 自動評価は外部のスケジューラが `/api/cron/alerts` を叩いたときにだけ動く。
 * `CRON_SECRET` が未設定ならそのエンドポイントは必ず 503 を返すので、自動評価は
 * 確実に動かない＝「今すぐ評価する」を押さない限り通知は一度も飛ばない。
 * この画面は以前それを黙っていて、「しきい値を超えたら通知します」とだけ
 * 書いていた。同じ仕組みのレポート画面は最初から警告していたので、
 * 片方だけが黙るという非対称になっていた。判定も文言も
 * src/lib/cron-status.ts に集めて、両方の画面で必ず同じことを言う。
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
import { getIntegration } from "@/lib/integrations";
import { isSingleTenantOptIn, resolveFallbackWebhook } from "@/lib/notify";
import {
  scheduledRunPossible,
  scheduledRunNote,
  ALERT_SWEEP_COPY,
} from "@/lib/cron-status";
import { env } from "@/lib/env";

/**
 * Whether a Slack message for this workspace would actually be delivered.
 *
 * ワークスペースの接続が本筋だが、自己ホストのデプロイ共通フォールバック
 * （SLACK_WEBHOOK_URL）が有効な場合も届く。そこを見ないと、正しく動いている
 * 自己ホスト環境に「接続されていません」と誤って出してしまう。判定は
 * src/lib/notify.ts の純粋関数をそのまま使い、送信側と食い違わないようにする。
 */
async function canDeliverSlack(workspaceId: string): Promise<boolean> {
  const slack = await getIntegration(workspaceId, "slack");
  // getSecret と同じ条件（復号できて、かつ有効）でないと送信されない。
  if (slack?.connected && slack.enabled) return true;

  // 行が「ある」なら、送信側はデプロイ共通のフォールバックを使わない
  // （notify.ts の hasStoredSlackIntegration と同じ判断）。ここを揃えないと、
  // 鍵の入れ替えで復号できなくなったワークスペースに対して、この画面だけが
  // 「Slackに届く」と言い続ける。設定画面は「未接続」と言い、実際にも届かない。
  // 画面と実挙動が食い違うのは、まさにこの一連の修正で潰してきた不具合そのもの。
  if (slack) return false;

  // 未設定が普通なので、設定されているときだけワークスペース数を数える。
  if (!env.SLACK_WEBHOOK_URL.trim()) return false;
  const workspaces = await db.workspace.findMany({ select: { id: true }, take: 2 });
  return resolveFallbackWebhook(
    env.SLACK_WEBHOOK_URL,
    workspaces.length,
    isSingleTenantOptIn(env.SLACK_WEBHOOK_SINGLE_TENANT),
  ).use;
}

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

  // 「通知先に Slack を選んだのに何も届かない」を作らないための判定。
  // 選んだ時点でフォームから知らせるので、保存してから発火するまで気づけない
  // という状態をなくす（Slack未接続なら sendWorkspaceSlack は黙って false を返す）。
  const slackDeliverable = await canDeliverSlack(user.workspace.id);

  // 自動評価の受け口が有効かどうか。無効なら「今すぐ評価する」を押した
  // ときにしか評価されない＝黙っていると通知がゼロのまま気づけない。
  // レポート画面（src/app/(app)/reports/page.tsx）と同じ判定を使う。
  const autoEvaluationPossible = scheduledRunPossible();

  return (
    <>
      <Topbar user={user} title="アラート" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="space-y-1">
            <p className="text-sm leading-relaxed text-ink-muted">
              スプレッドシートの数値がしきい値を超えたら、アプリ内のベルに通知します
              （Slack を選ぶと、ベルに加えて Slack にも送信します）。条件を作って
              「今すぐ評価する」で試せます。
            </p>
            {/*
              「通知します」だけで終えると、自動評価が動かない環境では
              いつまで待っても何も起きない理由が利用者に見えない。
              動く場合の説明と動かない場合の警告を対で出す
              （文面は scheduledRunNote に集約。レポート画面と同じもの）。
            */}
            <p className="text-xs leading-relaxed text-ink-muted">
              {scheduledRunNote(ALERT_SWEEP_COPY, autoEvaluationPossible)}
            </p>
          </div>

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
                            {/*
                              有効なのに自動評価が動かない環境では、押さない
                              限り一度も鳴らない。「有効」とだけ見えていると
                              動いていると思わせるので、レポート一覧の
                              「自動配信 / 手動のみ」と同じ形で状態を出す。
                            */}
                            {!r.enabled ? (
                              <Badge tone="neutral">停止中</Badge>
                            ) : autoEvaluationPossible ? (
                              <Badge tone="success">自動評価</Badge>
                            ) : (
                              <Badge tone="neutral">手動のみ</Badge>
                            )}
                            {/*
                              既に保存済みのルールも、Slackが未接続なら発火時に
                              何も届かない。作成時だけ警告しても、接続前に作った
                              ルールは黙ったままになるので、一覧でも状態を出す。
                            */}
                            {r.channel === "slack" &&
                              (slackDeliverable ? (
                                <Badge tone="info">Slack</Badge>
                              ) : (
                                <Badge tone="warning">Slack未接続</Badge>
                              ))}
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
              <AlertForm
                collections={collections as FormCollection[]}
                slackConnected={slackDeliverable}
              />
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
