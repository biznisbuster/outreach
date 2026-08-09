"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, useState, useCallback } from "react";

// ─── Sidebar collapse state (localStorage-backed external store) ─────────
const COLLAPSE_KEY = "app_sidebar_collapsed";
const collapseListeners = new Set<() => void>();
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeCollapsed(cb: () => void) {
  collapseListeners.add(cb);
  return () => collapseListeners.delete(cb);
}
function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  collapseListeners.forEach((cb) => cb());
}
import { Command } from "cmdk";
import {
  LayoutDashboard,
  Users,
  SquareKanban,
  ListChecks,
  Inbox,
  Send,
  FileText,
  Paperclip,
  Tag,
  Settings,
  Activity,
  LogOut,
  Search,
  Sun,
  Moon,
  Menu,
  X,
  ChevronRight,
  Mail,
} from "lucide-react";
import { cn } from "@/core/utils";

type Item = { href: string; label: string; icon: React.ElementType; shortcut?: string };
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: "Sad",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" }],
  },
  {
    title: "Outreach",
    items: [
      { href: "/campaigns", label: "Kampanje", icon: Users, shortcut: "G K" },
      { href: "/leads", label: "Leadovi", icon: SquareKanban },
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

function useDark() {
  return useSyncExternalStore(
    (cb) => {
      const obs = new MutationObserver(cb);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => obs.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

function ThemeToggle({ expanded = false, compact = false }: { expanded?: boolean; compact?: boolean }) {
  const dark = useDark();
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    try {
      localStorage.setItem("app_theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  const cls = expanded
    ? "flex h-9 w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    : compact
      ? "relative inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-md text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
      : "relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground";

  return (
    <button
      type="button"
      data-theme-toggle
      onClick={toggle}
      aria-label="Prebaci temu"
      title="Prebaci tamnu/svetlu temu"
      className={cls}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {expanded && <span className="sidebar-label flex-1 truncate text-left">Tema</span>}
    </button>
  );
}

function SidebarContent({
  variant,
  onNavigate,
  onOpenPalette,
}: {
  variant: "fixed" | "drawer";
  onNavigate?: () => void;
  onOpenPalette: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <div className="flex h-14 items-center justify-between gap-1 border-b border-border px-4" data-sidebar-header>
        <Link href="/" className="flex min-w-0 items-center gap-2.5" onClick={onNavigate}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-sm shadow-primary/30">
            <Mail className="size-[18px]" />
          </span>
          <span className="sidebar-label truncate text-lg font-bold tracking-tight">Outreach</span>
        </Link>
        {variant === "fixed" ? (
          <CollapseButton />
        ) : (
          <button
            type="button"
            onClick={onNavigate}
            className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Zatvori meni"
          >
            <X className="size-[18px]" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {SECTIONS.map((sec) => (
          <div key={sec.title} className="mb-4">
            <div className="sidebar-label mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {sec.title}
            </div>
            <ul className="space-y-0.5">
              {sec.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      className={cn(
                        "group/link press relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary-soft text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center transition-colors",
                          active ? "text-primary" : "text-muted-foreground group-hover/link:text-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="sidebar-label flex-1 truncate">{item.label}</span>
                      {item.shortcut && (
                        <span className="sidebar-label inline-flex shrink-0 items-center gap-0.5 text-[10px] font-normal text-muted-foreground">
                          {item.shortcut}
                        </span>
                      )}
                      {active && (
                        <span
                          className="sidebar-label-hidden absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-primary"
                          aria-hidden="true"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-border p-2.5">
        <ThemeToggle expanded />
        <button
          type="button"
          onClick={onOpenPalette}
          data-cmd-k-toggle
          className="sidebar-label flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Otvori brzu navigaciju"
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <Search className="size-4" />
          </span>
          <span className="sidebar-label flex-1 truncate text-left">Brza pretraga</span>
          <kbd className="sidebar-label rounded border border-border bg-muted px-1 py-0 text-[10px] font-normal text-muted-foreground">
            ⌘K
          </kbd>
        </button>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            data-logout-btn
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Odjavi se"
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              <LogOut className="size-4" />
            </span>
            <span className="sidebar-label flex-1 truncate text-left">Odjavi se</span>
          </button>
        </form>
      </div>
    </>
  );
}

function CollapseButton() {
  return (
    <button
      type="button"
      data-collapse-toggle
      className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="Skrati sidebar"
      title="Skrati sidebar"
    >
      <ChevronRight className="size-3.5 transition-transform" />
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    writeCollapsed(!readCollapsed());
  }, []);

  useEffect(() => {
    document.body.classList.toggle("no-scroll", drawerOpen);
    return () => document.body.classList.remove("no-scroll");
  }, [drawerOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Mobile top bar */}
      <header
        className="safe-top fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
        role="banner"
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Otvori meni"
          aria-expanded={drawerOpen}
        >
          <Menu className="size-[22px]" />
        </button>
        <Link href="/" className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-sm shadow-primary/30">
            <Mail className="size-3.5" />
          </span>
          <span className="truncate text-base font-bold tracking-tight">Outreach</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Otvori brzu pretragu"
          >
            <Search className="size-5" />
          </button>
          <ThemeToggle compact />
        </div>
      </header>

      <div className="flex h-dvh overflow-hidden">
        {/* Desktop sidebar */}
        <aside
          id="app-sidebar"
          data-sidebar-variant="fixed"
          data-collapsed={collapsed ? "true" : "false"}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-collapse-toggle]")) toggleCollapsed();
          }}
          className="hidden h-dvh shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out md:flex"
        >
          <SidebarContent variant="fixed" onOpenPalette={() => setPaletteOpen(true)} />
        </aside>

        {/* Mobile drawer */}
        <aside
          id="mobile-sidebar-drawer"
          data-sidebar-variant="drawer"
          data-drawer-state={drawerOpen ? "open" : "closed"}
          className="app-drawer safe-top safe-bottom fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-2xl md:hidden"
        >
          <SidebarContent
            variant="drawer"
            onNavigate={() => setDrawerOpen(false)}
            onOpenPalette={() => {
              setDrawerOpen(false);
              setPaletteOpen(true);
            }}
          />
        </aside>

        {/* Backdrop */}
        <div
          className="app-drawer-backdrop fixed inset-0 z-40 bg-black/50 md:hidden"
          data-backdrop-state={drawerOpen ? "open" : "closed"}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />

        <main className="flex-1 overflow-y-auto pt-14 md:pt-0">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
    </>
  );
}

function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[15vh]" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Brza navigacija">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder="Pretraži stranice…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">Nema rezultata.</Command.Empty>
            {SECTIONS.map((sec) => (
              <Command.Group key={sec.title} heading={sec.title} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
                {sec.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.href}
                      value={item.label}
                      onSelect={() => {
                        setOpen(false);
                        window.location.href = item.href;
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      {item.label}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
