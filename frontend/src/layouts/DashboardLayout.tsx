import { Outlet } from "react-router-dom";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { OnboardingProvider } from "@/lib/onboarding-context";

export default function DashboardLayout() {
  return (
    <WorkspaceProvider>
      <OnboardingProvider>
        <TooltipProvider>
          <SidebarProvider>
            <DashboardSidebar />
            <SidebarInset>
              <header className="sticky top-0 z-40 flex items-center gap-2 border-b bg-background/80 backdrop-blur px-4 py-2.5 supports-backdrop-filter:bg-background/60">
                <SidebarTrigger />
              </header>
              <Outlet />
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </OnboardingProvider>
    </WorkspaceProvider>
  );
}
