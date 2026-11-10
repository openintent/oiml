// Created once by OSL (@osl/backend-hono-trpc-vite). The sidebar: the app's pages, and a fixed footer with the signed-in user and settings. Its data comes from generated/app/nav.ts, so new pages appear here without edits.
// You own this file: OSL never rewrites it.

"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, LogIn, LogOut, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
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
import { client, sessionUser } from "@generated/app/client";
import { APP_TITLE, SIDEBAR, canOpen, userInitials, userName, userSubtitle } from "@generated/app/nav";

export function AppSidebar() {
  const matchRoute = useMatchRoute();
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  if (!SIDEBAR) return null;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <Link
            to="/"
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
              {SIDEBAR.items.filter(item => canOpen(item.access, user)).map(item => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    render={<Link to={item.path} />}
                    isActive={Boolean(matchRoute({ to: item.path, fuzzy: true }))}
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

/** The fixed footer: who is signed in (with sign out) and the settings link */
function NavFooter() {
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const logout = useMutation({
    mutationFn: () => client.auth.logout(),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    }
  });
  if (!SIDEBAR) return null;
  const user = sessionUser(session.data);
  const settingsActive = Boolean(matchRoute({ to: "/settings" }));
  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-1">
        {SIDEBAR.footer.user ? (
          user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" className="flex-1 data-[popup-open]:bg-sidebar-accent" />}
              >
                <Avatar size="sm" className="rounded-md">
                  <AvatarFallback className="rounded-md text-xs">{userInitials(user)}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userName(user)}</span>
                  <span className="truncate text-xs text-muted-foreground">{userSubtitle(user)}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                {SIDEBAR.footer.settings ? (
                  <DropdownMenuItem render={<Link to="/settings" />}>
                    <Settings />
                    Settings
                  </DropdownMenuItem>
                ) : null}
                {SIDEBAR.footer.settings ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={() => logout.mutate()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton render={<Link to="/login" />} className="flex-1" tooltip="Sign in">
              <LogIn />
              <span>Sign in</span>
            </SidebarMenuButton>
          )
        ) : null}
        {SIDEBAR.footer.settings ? (
          <SidebarMenuButton
            render={<Link to="/settings" />}
            isActive={settingsActive}
            tooltip="Settings"
            aria-label="Settings"
            className={SIDEBAR.footer.user ? "w-auto shrink-0" : undefined}
          >
            <Settings />
            {SIDEBAR.footer.user ? null : <span>Settings</span>}
          </SidebarMenuButton>
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
