import { Link, useRouterState } from "@tanstack/react-router";
import { Workflow, Archive, UserRound, ImageIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const items = [
  { title: "Конвейер", subtitle: "Активный релиз", url: "/", icon: Workflow },
  { title: "Персонажи", subtitle: "Пресеты тегов и названий", url: "/characters", icon: UserRound },
  { title: "Архив", subtitle: "Прошлые релизы", url: "/archive", icon: Archive },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ImageIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold leading-none">Furry Manager</p>
            <p className="truncate text-[10px] text-muted-foreground">локально · приватно</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active =
                  item.url === "/" ? currentPath === "/" : currentPath.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild size="lg" isActive={active} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate text-sm font-medium">{item.title}</span>
                          <span className="truncate text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                            {item.subtitle}
                          </span>
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
    </Sidebar>
  );
}
