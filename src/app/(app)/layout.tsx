import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/app/Sidebar";

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

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
