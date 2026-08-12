import { Link, useLocation } from "react-router-dom";
import { useUser, useClerk, UserButton } from "@clerk/clerk-react";
import { motion } from "motion/react";
import {
  Database,
  Share2,
  FileOutput,
  BarChart3,
  Activity,
  Plug,
  ShieldCheck,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";

function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { ContinuumMark } from "@/components/continuum-mark";
import { useOnboarding } from "@/lib/onboarding-context";

const NAV_LINKS = [
  { href: "/dashboard", label: "Stats", icon: BarChart3, gated: true, adminOnly: false },
  { href: "/dashboard/activity", label: "Activity", icon: Activity, gated: true, adminOnly: false },
  { href: "/dashboard/memory", label: "Memory", icon: Database, gated: true, adminOnly: false },
  { href: "/dashboard/memory-graph", label: "Graph", icon: Share2, gated: true, adminOnly: false },
  { href: "/dashboard/export", label: "Export", icon: FileOutput, gated: true, adminOnly: false },
  { href: "/dashboard/connections", label: "Connections", icon: Plug, gated: false, adminOnly: false },
  { href: "/dashboard/admin", label: "Admin", icon: ShieldCheck, gated: false, adminOnly: true },
];

export function DashboardSidebar() {
  const { pathname } = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { isNewUser } = useOnboarding();
  const isAdmin = Boolean((user?.publicMetadata as { isAdmin?: boolean } | undefined)?.isAdmin);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          to="/dashboard"
          className="flex items-center gap-2 px-2 py-1.5 font-heading font-semibold text-lg tracking-tight text-primary group-data-[collapsible=icon]:justify-center"
        >
          <ContinuumMark className="size-4 shrink-0" />
          <span className="text-foreground group-data-[collapsible=icon]:hidden">Continuum</span>
        </Link>
        <div className="group-data-[collapsible=icon]:hidden">
          <WorkspaceSwitcher />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_LINKS.map((link) => {
                const active =
                  link.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(link.href);
                const lockedForAdmin = link.adminOnly && !isAdmin;
                const disabled = (link.gated && isNewUser) || lockedForAdmin;

                if (disabled) {
                  return (
                    <SidebarMenuItem key={link.href}>
                      <SidebarMenuButton
                        disabled
                        tooltip={lockedForAdmin ? "Admin access required" : "Connect a client first"}
                        className="relative cursor-not-allowed opacity-50"
                      >
                        <link.icon className="relative" />
                        <span className="relative">{link.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={link.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={link.label}
                      className="relative data-active:bg-transparent"
                    >
                      <Link to={link.href}>
                        {active && (
                          <motion.span
                            layoutId="sidebar-active-pill"
                            className="absolute inset-0 rounded-md bg-sidebar-accent"
                            transition={{ duration: 0.15, ease: "easeOut" }}
                          />
                        )}
                        <link.icon className="relative" />
                        <span className="relative flex items-center gap-1.5">
                          {link.label}
                          {link.href === "/dashboard/connections" && isNewUser && (
                            <span
                              className="size-1.5 rounded-full bg-primary animate-pulse"
                              aria-label="Start here"
                            />
                          )}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith("/dashboard/settings")}
              tooltip="Settings"
            >
              <Link to="/dashboard/settings">
                <SettingsIcon />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="GitHub">
              <a href="https://github.com/SSShogunn/continuum" target="_blank" rel="noopener noreferrer">
                <GithubMark />
                <span>GitHub</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <div className="flex items-center gap-2 min-w-0">
            <UserButton />
            <span className="text-sm truncate group-data-[collapsible=icon]:hidden">
              {user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? ""}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: "/" })}
              title="Log out"
              className="flex items-center justify-center rounded-md border bg-secondary/40 size-8 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
