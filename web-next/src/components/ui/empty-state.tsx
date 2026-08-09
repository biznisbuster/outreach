import { cn } from "@/core/utils";
import { SearchX } from "lucide-react";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <SearchX className="size-5" />
      </div>
      <h3 className="font-medium">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
