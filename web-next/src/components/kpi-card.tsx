import Link from "next/link";
import { cn } from "@/core/utils";
import { Users, Send, TrendingUp, Inbox, type LucideIcon } from "lucide-react";

const TONES = {
  primary: { bg: "bg-primary-soft", fg: "text-primary" },
  success: { bg: "bg-success-soft", fg: "text-success" },
  warning: { bg: "bg-warning-soft", fg: "text-warning" },
  info: { bg: "bg-info-soft", fg: "text-info" },
  muted: { bg: "bg-muted", fg: "text-muted-foreground" },
} as const;

const ICONS: Record<string, LucideIcon> = {
  users: Users,
  send: Send,
  "trending-up": TrendingUp,
  inbox: Inbox,
};

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: string;
  tone?: keyof typeof TONES;
  href?: string;
}) {
  const t = TONES[tone];
  const Icon = icon ? ICONS[icon] : undefined;

  const inner = (
    <>
      {Icon && (
        <div className={cn("absolute right-4 top-4 flex size-9 items-center justify-center rounded-lg", t.bg, t.fg)}>
          <Icon className="size-4" />
        </div>
      )}
      <p className="pr-12 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold leading-none tracking-tight tabular-nums text-foreground">{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </>
  );

  const cls =
    "group relative flex h-full flex-col justify-between gap-3 rounded-lg border border-border bg-card px-4 pt-4 pb-5 shadow-xs transition-all duration-150 hover:border-primary/30 hover:shadow-sm";

  if (href) {
    return (
      <Link href={href} className={cn(cls, "press cursor-pointer")}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
