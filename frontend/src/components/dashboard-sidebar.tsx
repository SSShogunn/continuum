"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import { motion } from "motion/react";
import {
  Database,
  Share2,
  FileOutput,
  PlayCircle,
  BarChart3,
  Activity,
  Plug,
  ShieldCheck,
  Settings as SettingsIcon,
} from "lucide-react";
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

const UserButton = dynamic(() => import("@clerk/nextjs").then((m) => m.UserButton), {
  ssr: false,
  loading: () => <div className="size-7 rounded-full bg-muted shrink-0" />,
});

const NAV_LINKS = [
  { href: "/dashboard", label: "Stats", icon: BarChart3 },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/dashboard/memory", label: "Memory", icon: Database },
  { href: "/dashboard/memory-graph", label: "Graph", icon: Share2 },
  { href: "/dashboard/export", label: "Export", icon: FileOutput },
  { href: "/dashboard/playground", label: "Playground", icon: PlayCircle },
  { href: "/dashboard/connections", label: "Connections", icon: Plug },
  { href: "/dashboard/admin", label: "Admin", icon: ShieldCheck },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const { user } = useUser();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/dashboard" className="px-2 py-1.5 font-semibold text-lg tracking-tight group-data-[collapsible=icon]:hidden">
          Continuum
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
                return (
                  <SidebarMenuItem key={link.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={link.label}
                      className="relative data-active:bg-transparent"
                      render={
                        <Link href={link.href}>
                          {active && (
                            <motion.span
                              layoutId="sidebar-active-pill"
                              className="absolute inset-0 rounded-md bg-sidebar-accent"
                              transition={{ duration: 0.15, ease: "easeOut" }}
                            />
                          )}
                          <link.icon className="relative" />
                          <span className="relative">{link.label}</span>
                        </Link>
                      }
                    />
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
              isActive={pathname.startsWith("/dashboard/settings")}
              tooltip="Settings"
              render={
                <Link href="/dashboard/settings">
                  <SettingsIcon />
                  <span>Settings</span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <div className="flex items-center gap-2 min-w-0">
            <UserButton />
            <span className="text-sm truncate group-data-[collapsible=icon]:hidden">
              {user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? ""}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
