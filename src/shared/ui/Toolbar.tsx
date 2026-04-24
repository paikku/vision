"use client";

import { type HTMLAttributes } from "react";
import { cn } from "./cn";

export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      className={cn(
        "flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1",
        className,
      )}
      {...props}
    />
  );
}

export function ToolbarDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn("mx-1 h-4 w-px bg-[var(--color-line)]", className)} />;
}
