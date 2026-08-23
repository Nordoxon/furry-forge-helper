import { Link, useRouterState } from "@tanstack/react-router";
import { CheckCheck, UserRound, ListChecks, Settings } from "lucide-react";

const tabs = [
  { to: "/", label: "Отбор", icon: CheckCheck },
  { to: "/queue", label: "Очередь", icon: ListChecks },
  { to: "/characters", label: "Персонажи", icon: UserRound },
  { to: "/setup", label: "Агент", icon: Settings },
] as const;

export function BottomNav() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  return (
    <nav className="sticky bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-2xl">
        {tabs.map((t) => {
          const active = t.to === "/" ? path === "/" : path.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <t.icon className="h-5 w-5" />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
