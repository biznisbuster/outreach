"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/core/utils";

function coerce(fieldName: string, raw: string): string | number | null {
  if (raw === "") return null;
  if (fieldName === "googleRating") {
    const n = parseFloat(raw.replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  if (fieldName === "reviewsCount") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  }
  return raw;
}

export function EditableField({
  leadId,
  name,
  label,
  value,
  type = "text",
  placeholder,
  required,
  step,
  min,
  max,
  onSaved,
}: {
  leadId: number;
  name: string;
  label: string;
  value?: string | number | null;
  type?: string;
  placeholder?: string;
  required?: boolean;
  step?: string;
  min?: string;
  max?: string;
  onSaved?: () => void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSaved = useRef<string>(value == null ? "" : String(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (raw: string) => {
    if (lastSaved.current === raw) return;
    setState("saving");
    fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [name]: coerce(name, raw) }),
    })
      .then((r) => {
        if (r.ok) {
          setState("saved");
          lastSaved.current = raw;
          onSaved?.();
          setTimeout(() => setState("idle"), 1500);
        } else {
          setState("error");
          toast.error(`Greška pri čuvanju: ${label}`);
        }
      })
      .catch(() => {
        setState("error");
        toast.error(`Greška pri čuvanju: ${label}`);
      });
  };

  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        {state === "saving" && <span className="text-[10px]">Čuvam…</span>}
        {state === "saved" && <span className="text-[10px] text-success">✓ Sačuvano</span>}
        {state === "error" && <span className="text-[10px] text-destructive">Greška</span>}
      </span>
      <input
        type={type}
        defaultValue={value == null ? "" : String(value)}
        placeholder={placeholder}
        required={required}
        step={step}
        min={min}
        max={max}
        onBlur={(e) => {
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => save(v), 300);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-primary",
          state === "error" && "border-destructive",
        )}
      />
    </label>
  );
}
