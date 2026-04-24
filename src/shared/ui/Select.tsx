"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const selectStyles = cva(
  "cursor-pointer appearance-none bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-line)] outline-none transition-colors hover:border-[var(--color-line-strong)] focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      size: {
        sm: "h-7 rounded-[var(--radius-md)] pl-2 pr-7 text-[var(--text-sm)]",
        md: "h-8 rounded-[var(--radius-md)] pl-2.5 pr-8 text-[var(--text-md)]",
        lg: "h-10 rounded-[var(--radius-lg)] pl-3 pr-9 text-[var(--text-base)]",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

export type SelectVariants = VariantProps<typeof selectStyles>;

type NativeSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">;

export interface SelectProps extends NativeSelectProps, SelectVariants {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size, children, ...props },
  ref,
) {
  return (
    <div className="relative inline-block">
      <select
        ref={ref}
        className={cn(selectStyles({ size }), className)}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
});
