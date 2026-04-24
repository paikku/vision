"use client";

import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-[1rem] select-none items-center justify-center rounded-[var(--radius-xs)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1 font-mono text-[var(--text-2xs)] text-[var(--color-muted)]",
        className,
      )}
      {...props}
    />
  );
}
