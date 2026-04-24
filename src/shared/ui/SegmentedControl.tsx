"use client";

import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const name = useId();
  const sizeClasses =
    size === "sm"
      ? "h-7 p-0.5 text-[var(--text-sm)]"
      : "h-8 p-0.5 text-[var(--text-md)]";
  return (
    <div
      role="radiogroup"
      {...aria}
      className={cn(
        "inline-flex items-stretch rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)]",
        sizeClasses,
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            name={name}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex min-w-[2rem] items-center justify-center rounded-[calc(var(--radius-md)-2px)] px-2.5 font-medium transition-colors outline-none",
              "disabled:cursor-not-allowed disabled:opacity-40",
              active
                ? "bg-[var(--color-surface-3)] text-[var(--color-text-strong)] shadow-[var(--shadow-xs)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
