import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, clearSessionCookie } from "@/lib/auth";
import { getPlan, formatPrice, anyPlanPurchasable } from "@/lib/plans";
import { Topbar } from "@/components/app/Topbar";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";
import { SlackCard } from "@/components/settings/SlackCard";
import { NotionCard } from "@/components/settings/NotionCard";
import { getIntegration } from "@/lib/integrations";

export const metadata = { title: "設定" };

/**
 * ワークスペース内の権限の表示名。DBには "owner" などの内部名で入っているので、
 * そのまま出すと日本語の画面に英単語が1つだけ混ざる。未知の値は隠さずに
 * そのまま出す（何が保存されているのか分からなくなるほうが困る）。
 */
const ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

/** Server Action: clear the session cookie and return to the login page. */
async function logout() {
  "use server";
  await clearSessionCookie();
  redirect("/login");
}

/** A labelled read-only field row. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-ink-line py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const plan = getPlan(user.workspace.plan);
  // Masked summary only — the sealed webhook URL never reaches the client.
  const slack = await getIntegration(user.workspace.id, "slack");
  const notion = await getIntegration(user.workspace.id, "notion");

  return (
    <>
      <Topbar user={user} title="設定" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Account */}
          <Card>
            <CardHeader>
              <CardTitle>アカウント情報</CardTitle>
            </CardHeader>
            <CardBody className="py-1">
              <InfoRow label="お名前" value={user.name} />
              <InfoRow label="メールアドレス" value={user.email} />
            </CardBody>
          </Card>

          {/* Workspace */}
          <Card>
            <CardHeader>
              <CardTitle>ワークスペース</CardTitle>
            </CardHeader>
            <CardBody className="py-1">
              <InfoRow label="ワークスペース名" value={user.workspace.name} />
              <InfoRow
                label="現在のプラン"
                value={
                  <span className="inline-flex items-center gap-2">
                    <Badge tone="khaki" variant="soft">{plan.name}</Badge>
                    <span className="text-ink-muted">
                      {formatPrice(plan)}
                      {plan.priceMonthly ? " / 月" : ""}
                    </span>
                  </span>
                }
              />
              <InfoRow
                label="権限"
                value={ROLE_LABEL[user.workspace.role] ?? user.workspace.role}
              />
              <InfoRow
                label="上限"
                value={`スプレッドシート ${plan.limits.collections} 個 ・ 1シート ${plan.limits.recordsPerCollection.toLocaleString()} 行`}
              />
            </CardBody>
            <CardBody className="border-t border-ink-line">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* プランを切り替える手段（決済・アップグレードAPI・管理画面）は
                    まだ無いので、「変更できます」とは書かない。ボタンの行き先も
                    料金の説明ページであることを名前で示す。 */}
                <p className="text-sm text-ink-muted">
                  {anyPlanPurchasable
                    ? "上限を増やすにはプランを変更してください。"
                    : "現在ご利用いただけるのは Free プランのみです（有料プランは準備中で、お申し込みはまだできません）。"}
                </p>
                <Link href="/pricing">
                  <Button variant="outline" size="sm">
                    {anyPlanPurchasable ? "プランを変更" : "料金プランを見る"}
                  </Button>
                </Link>
              </div>
            </CardBody>
          </Card>

          {/* Integrations */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-muted">連携</h2>
            <SlackCard initial={slack} />
            <NotionCard initial={notion} />
          </section>

          {/* Session */}
          <Card>
            <CardHeader>
              <CardTitle>セッション</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-muted">
                  この端末からサインアウトします。
                </p>
                <form action={logout}>
                  <Button type="submit" variant="ghost" size="sm">
                    <NavIcon name="logout" className="h-4 w-4" />
                    ログアウト
                  </Button>
                </form>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
