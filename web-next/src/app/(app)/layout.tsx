import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/toaster";
import { UrlFlash } from "@/components/url-flash";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <Toaster />
      <UrlFlash />
    </>
  );
}
