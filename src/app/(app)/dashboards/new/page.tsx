import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { aiProvider } from "@/lib/env";
import { can } from "@/lib/plans";
import { Topbar } from "@/components/app/Topbar";
import { GenerateWizard } from "@/components/dashboard/GenerateWizard";

/**
 * "画像・PDFから作成" — generate a dashboard from a screenshot, PDF, or a
 * free-text description. Works with or without an AI key configured (falls back
 * to the closest built-in template when no key is present).
 *
 * AI を実際に呼ぶかどうかは「APIキーがあるか」だけでは決まらない。1回叩くたびに
 * 実費が出るので、プランでも閉じている（src/lib/plans.ts の aiAssist）。画面には
 * 両方の理由を分けて出したいので、ウィザードには2つ別々に渡す——キーが無いのか、
 * プランで閉じているのかで、利用者に伝えるべきことが違うため。
 */
export default async function GenerateDashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <>
      <Topbar user={user} title="画像・PDFからダッシュボードを作成" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <GenerateWizard
            aiConfigured={aiProvider !== null}
            planAllowsAi={can(user.workspace.plan, "aiAssist")}
          />
        </div>
      </main>
    </>
  );
}
