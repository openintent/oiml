// Created once by OSL (@osl/backend-drizzle-next). The sidebar: the app's pages, and a fixed footer with the signed-in user and settings. Its data comes from generated/app/nav.ts, so new pages appear here without edits.
// You own this file: OSL never rewrites it.

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
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
  SidebarTrigger
} from "@/components/ui/sidebar";
import { APP_TITLE, SIDEBAR } from "@/generated/app/nav";

export function AppSidebar() {
  const pathname = usePathname();
  if (!SIDEBAR) return null;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="flex min-w-0 flex-1 items-center rounded-md px-2 py-1 text-sm font-semibold group-data-[collapsible=icon]:hidden"
          >
            {APP_TITLE}
          </Link>
          <SidebarTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SIDEBAR.items.map(item => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    render={<Link href={item.path} />}
                    isActive={pathname === item.path || pathname.startsWith(item.path + "/")}
                    tooltip={item.label}
                  >
                    {item.icon ? <item.icon /> : null}
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavFooter />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** The fixed footer: the settings link (the model has no auth, so nobody signs in) */
function NavFooter() {
  const pathname = usePathname();
  if (!SIDEBAR?.footer.settings) return null;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link href="/settings" />}
          isActive={pathname === "/settings"}
          tooltip="Settings"
        >
          <Settings />
          <span>Settings</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
