"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { cn } from "@/core/utils";

/**
 * SortHeader — klik = single sort, Shift+klik = multi-sort (isti UX kao Astro).
 */
export function SortHeaderCell({
  colKey,
  label,
  align = "left",
  width,
  defaultDir = "asc",
}: {
  colKey: string;
  label: string;
  align?: "left" | "center" | "right";
  width?: string;
  defaultDir?: "asc" | "desc";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sorts = (() => {
    const raw = searchParams.get("sort");
    if (!raw) return [{ key: "createdAt", dir: "desc" as "asc" | "desc" }];
    const out = raw
      .split(",")
      .map((p) => {
        const [k, d] = p.split(":");
        return { key: k, dir: (d === "asc" ? "asc" : "desc") as "asc" | "desc" };
      })
      .filter((s) => s.key);
    return out.length ? out : [{ key: "createdAt", dir: "desc" as "asc" | "desc" }];
  })();

  const idx = sorts.findIndex((s) => s.key === colKey);
  const dir = idx >= 0 ? sorts[idx].dir : null;
  const priority = idx >= 0 && sorts.length > 1 ? idx + 1 : null;

  const commit = useCallback(
    (entries: { key: string; dir: "asc" | "desc" }[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (entries.length === 0) params.delete("sort");
      else params.set("sort", entries.map((e) => `${e.key}:${e.dir}`).join(","));
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const onClick = (e: React.MouseEvent) => {
    if (!e.shiftKey) {
      if (sorts.length === 1 && sorts[0].key === colKey) {
        commit([{ key: colKey, dir: sorts[0].dir === "asc" ? "desc" : "asc" }]);
      } else {
        commit([{ key: colKey, dir: defaultDir }]);
      }
      return;
    }
    if (idx >= 0) {
      const copy = [...sorts];
      copy[idx] = { key: colKey, dir: copy[idx].dir === "asc" ? "desc" : "asc" };
      commit(copy);
    } else {
      commit([...sorts, { key: colKey, dir: defaultDir }]);
    }
  };

  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const justifyClass = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <th className={cn("select-none px-3 py-2", alignClass, width)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-foreground",
          justifyClass,
          dir ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <span className={cn("text-[9px]", dir ? "text-primary" : "text-muted-foreground/40")}>
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "·"}
        </span>
        {priority && <span className="rounded bg-primary/15 px-1 text-[9px] font-bold text-primary">{priority}</span>}
      </button>
    </th>
  );
}
