import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Topbar } from "@/components/app/Topbar";
import { ImportWizard } from "@/components/import/ImportWizard";

/** Excel/CSV import flow — the product's headline feature. */
export default async function ImportPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <>
      <Topbar user={user} title="Excel取り込み" />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl">
          <ImportWizard />
        </div>
      </main>
    </>
  );
}
