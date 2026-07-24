import { AppHeader } from "@/components/app-header";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { WorkspaceProvider } from "@/lib/workspace-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="min-h-screen">
        <AppHeader>
          <WorkspaceSwitcher />
        </AppHeader>
        {children}
      </div>
    </WorkspaceProvider>
  );
}
