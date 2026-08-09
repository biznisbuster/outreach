"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  ListChecks,
  Inbox,
  Send,
  FileText,
  Paperclip,
  Tag,
  Settings,
  Activity,
  LogOut,
} from "lucide-react";
import { cn } from "@/core/utils";

const SECTIONS: { title: string; items: { href: string; label: string; icon: React.ElementType }[] }[] = [
  {
    title: "Sad",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Outreach",
    items: [
      { href: "/campaigns", label: "Kampanje", icon: Users },
      { href: "/leads", label: "Leadovi", icon: KanbanSquare },
      { href: "/queue", label: "Red slanja", icon: ListChecks },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    title: "Podešavanje",
    items: [
      { href: "/senders", label: "Senderi", icon: Send },
      { href: "/templates", label: "Šabloni", icon: FileText },
      { href: "/attachments", label: "Attachments", icon: Paperclip },
      { href: "/statuses", label: "Statusi", icon: Tag },
      { href: "/settings", label: "Podešavanja", icon: Settings },
    ],
  },
  {
    title: "Uvidi",
    items: [{ href: "/audit", label: "Audit log", icon: Activity }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/50 md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-sm">
          <Send className="size-4" />
        </div>
        <span className="text-lg font-bold tracking-tight">Outreach</span>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {sec.title}
            </div>
            <div className="space-y-0.5">
              {sec.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary-soft text-accent-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <form method="POST" action="/api/auth/logout">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="size-4" />
            Odjavi se
          </button>
        </form>
      </div>
    </aside>
  );
}
