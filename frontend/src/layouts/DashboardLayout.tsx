import { Outlet } from "react-router-dom";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
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
            <SidebarInset className="min-w-0">
              <Outlet />
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </OnboardingProvider>
    </WorkspaceProvider>
  );
}
