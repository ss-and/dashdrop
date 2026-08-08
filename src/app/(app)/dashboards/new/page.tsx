import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { aiProvider } from "@/lib/env";
import { Topbar } from "@/components/app/Topbar";
import { GenerateWizard } from "@/components/dashboard/GenerateWizard";

/**
 * "画像・PDFから作成" — generate a dashboard from a screenshot, PDF, or a
 * free-text description. Works with or without an AI key configured (falls back
 * to the closest built-in template when no key is present).
 */
export default async function GenerateDashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <>
      <Topbar user={user} title="画像・PDFからダッシュボードを作成" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <GenerateWizard aiConfigured={aiProvider !== null} />
        </div>
      </main>
    </>
  );
}
