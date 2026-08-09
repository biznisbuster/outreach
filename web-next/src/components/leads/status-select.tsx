"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function StatusSelect({
  leadId,
  initial,
  statuses,
}: {
  leadId: number;
  initial: number | null;
  statuses: { id: number; name: string; color: string }[];
}) {
  const router = useRouter();
  const current = statuses.find((s) => s.id === initial);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    const statusId = v === "__none__" ? null : Number(v);
    fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId }),
    })
      .then((r) => {
        if (r.ok) {
          toast.success("Status ažuriran");
          router.refresh();
        } else {
          toast.error("Greška pri promeni statusa");
        }
      })
      .catch(() => toast.error("Greška pri promeni statusa"));
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="header-status-select" className="text-xs font-medium text-muted-foreground">
        Status:
      </label>
      <select
        id="header-status-select"
        onChange={onChange}
        defaultValue={initial != null ? String(initial) : "__none__"}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-primary"
        style={current ? { color: current.color } : undefined}
      >
        {statuses.map((s) => (
          <option key={s.id} value={String(s.id)} style={{ color: s.color }}>
            {s.name}
          </option>
        ))}
        <option value="__none__">Bez statusa</option>
      </select>
    </div>
  );
}
