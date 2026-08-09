import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/core/utils";

interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs = [],
  backHref,
  backLabel,
  sticky = false,
  size = "default",
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  backHref?: string;
  backLabel?: string;
  sticky?: boolean;
  size?: "default" | "compact" | "hero";
  actions?: React.ReactNode;
  className?: string;
}) {
  const SIZE = {
    compact: { wrap: "px-4 py-3 md:px-5", title: "text-base md:text-lg", subtitle: "text-xs" },
    default: { wrap: "px-4 py-3 md:px-6 md:py-4", title: "text-lg md:text-xl", subtitle: "text-xs md:text-sm" },
    hero: { wrap: "px-4 pt-6 pb-4 md:px-6 md:pt-8 md:pb-6", title: "text-2xl md:text-3xl", subtitle: "text-sm md:text-base" },
  };
  const s = SIZE[size];
  const stickCls = sticky
    ? "md:sticky md:top-0 z-30 glass border-b border-border"
    : "border-b border-border bg-card/60 backdrop-blur-sm";

  return (
    <header className={cn(stickCls, s.wrap, className)}>
      {backHref && (
        <Link
          href={backHref}
          className="mb-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          <span>{backLabel ?? "Nazad"}</span>
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              {breadcrumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden="true">/</span>}
                  {c.href ? (
                    <Link href={c.href} className="hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-foreground">
                      {c.label}
                    </span>
                  )}
                </span>
              ))}
            </nav>
          )}
          <h1 className={cn("font-bold tracking-tight", s.title)}>{title}</h1>
          {subtitle && <p className={cn("mt-0.5 text-muted-foreground", s.subtitle)}>{subtitle}</p>}
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">{actions}</div>}
      </div>
    </header>
  );
}
