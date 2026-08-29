import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import {
  onboardingSteps,
  SETUP_DONE_COOKIE,
  type OnboardingStep,
} from "@/lib/onboarding";
import { Sidebar } from "@/components/app/Sidebar";
import { SidebarProvider, SidebarPane } from "@/components/app/SidebarShell";
import { SetupGuide } from "@/components/app/SetupGuide";

/**
 * Authenticated app shell. Guards every /(app) route: unauthenticated users
 * are redirected to /login. Renders the persistent Sidebar; each page renders
 * its own <Topbar title=…> for the header row.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const workspaceId = user.workspace.id;

  /*
   * 設定ガイドの材料。ここは**全ページ共通の器**なので、増やしたクエリは
   * 例外なく全画面の表示に乗る。だから2段構えにしてある。
   *
   * 1. 一度終えた人は Cookie を持っているので、**1本も数えない**。
   *    去年オンボーディングを終えた利用者が、もう出ないパネルのために毎ページ
   *    4本を払い続けるのは無駄。1ページあたりのクエリ数は運用コストの内訳で
   *    いちばん効く費目なので、ここは黙って払わない（通知ベルの30秒
   *    ポーリングを直したのと同じ理由）。
   * 2. まだの人だけ数える。安いものだけにしてある:
   *      - workbook / dashboard は workspaceId に索引があり、行数も二桁で収まる。
   *      - レコードだけは COUNT を避けて findFirst にした。判定は「1件でも
   *        あるか」だけで、onboarding.ts の OnboardingState もそう書いてある。
   *    4本を Promise.all で並べて1往復ぶんの待ちに畳む。
   */
  const setupDone = (await cookies()).get(SETUP_DONE_COOKIE)?.value === "1";

  let steps: OnboardingStep[] = [];
  if (!setupDone) {
    const [workbooks, dashboards, sharedDashboards, anyRecord] =
      await Promise.all([
        db.workbook.count({ where: { workspaceId } }),
        db.dashboard.count({ where: { workspaceId } }),
        db.dashboard.count({ where: { workspaceId, shareToken: { not: null } } }),
        db.record.findFirst({
          where: { collection: { workspaceId } },
          select: { id: true },
        }),
      ]);

    steps = onboardingSteps({
      workbooks,
      dashboards,
      sharedDashboards,
      records: anyRecord ? 1 : 0,
      emailVerified: user.emailVerified,
    });
  }

  return (
    <SidebarProvider>
      <div className="flex h-dvh overflow-hidden bg-paper">
        {/* レールは畳めるが、中身はサーバーで描いたまま器に入れるだけ。 */}
        <SidebarPane>
          <Sidebar user={user} />
        </SidebarPane>
        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            メール未確認の知らせは Topbar の中（ロゴ・ナビの下）に置いてある。
            以前はここ——つまり**トップバーより上**——に全幅で出していたので、
            製品のクロームより通知の方が上位に見えていた。知らせが看板を
            上回る画面は、それだけで作りが粗く見える。
          */}
          {children}
        </div>
        {/* 右下に常駐。入口は塞がず、消えるべきときには自分で消える。 */}
        <SetupGuide workspaceId={workspaceId} steps={steps} />
      </div>
    </SidebarProvider>
  );
}
