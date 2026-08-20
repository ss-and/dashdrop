import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/app/Sidebar";
import { SidebarProvider, SidebarPane } from "@/components/app/SidebarShell";

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
    <SidebarProvider>
      <div className="flex h-dvh overflow-hidden bg-paper">
        {/* レールは畳めるが、中身はサーバーで描いたまま器に入れるだけ。 */}
        <SidebarPane>
          <Sidebar user={user} />
        </SidebarPane>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </SidebarProvider>
  );
}
