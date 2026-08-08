import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, clearSessionCookie } from "@/lib/auth";
import { getPlan, formatPrice } from "@/lib/plans";
import { Topbar } from "@/components/app/Topbar";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";

export const metadata = { title: "設定" };

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
                    <Badge tone="khaki">{plan.name}</Badge>
                    <span className="text-ink-muted">
                      {formatPrice(plan)}
                      {plan.priceMonthly ? " / 月" : ""}
                    </span>
                  </span>
                }
              />
              <InfoRow label="権限" value={user.workspace.role} />
            </CardBody>
            <CardBody className="border-t border-ink-line">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-muted">
                  上限を増やすにはプランを変更してください。
                </p>
                <Link href="/pricing">
                  <Button variant="outline" size="sm">
                    プランを変更
                  </Button>
                </Link>
              </div>
            </CardBody>
          </Card>

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
