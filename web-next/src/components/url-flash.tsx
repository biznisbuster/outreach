"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** Čita ?ok= / ?error= iz URL-a i prikazuje toast (isti obrazac kao Astro Toaster). */
export function UrlFlash() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    const ok = searchParams.get("ok");
    const err = searchParams.get("error");
    if (ok) toast.success(decodeURIComponent(ok));
    if (err) toast.error(decodeURIComponent(err));
    if (ok || err) {
      window.history.replaceState({}, "", pathname);
    }
  }, [searchParams, pathname]);

  return null;
}
