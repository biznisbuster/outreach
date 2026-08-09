import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-1 border-b border-border px-4 md:justify-end">
          <ThemeToggle />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
