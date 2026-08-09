/**
 * "Add a table" — choose a template or an empty table, then create a Collection.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Topbar } from "@/components/app/Topbar";
import { NewCollectionForm } from "@/components/grid/NewCollectionForm";

export default async function NewCollectionPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <>
      <Topbar user={user} title="スプレッドシートを追加" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <NewCollectionForm />
        </div>
      </main>
    </>
  );
}
