"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes, type ReactNode, type CSSProperties } from "react";
import { cn } from "./cn";

const badgeStyles = cva(
  "inline-flex select-none items-center gap-1 whitespace-nowrap font-medium leading-none",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--color-surface-2)] text-[var(--color-text)]",
        muted: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
        outline:
          "border border-[var(--color-line)] bg-transparent text-[var(--color-muted)]",
        accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
        success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
        warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
        danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
        info: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
      },
      size: {
        xs: "h-4 rounded-[var(--radius-xs)] px-1 text-[var(--text-2xs)]",
        sm: "h-5 rounded-[var(--radius-sm)] px-1.5 text-[var(--text-2xs)]",
        md: "h-6 rounded-[var(--radius-md)] px-2 text-[var(--text-xs)]",
      },
      shape: {
        rect: "",
        pill: "rounded-[var(--radius-full)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "sm",
      shape: "rect",
    },
  },
);

export type BadgeVariants = VariantProps<typeof badgeStyles>;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, BadgeVariants {
  /** When set, overrides tone and uses this color as background (soft) + text. */
  color?: string;
  swatch?: ReactNode;
}

function hexToRgba(hex: string, alpha: number) {
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone, size, shape, color, style, swatch, children, ...props },
  ref,
) {
  const resolvedStyle: CSSProperties | undefined = color
    ? { background: hexToRgba(color, 0.16), color, ...style }
    : style;
  return (
    <span
      ref={ref}
      className={cn(badgeStyles({ tone: color ? undefined : tone, size, shape }), className)}
      style={resolvedStyle}
      {...props}
    >
      {swatch}
      {children}
    </span>
  );
});
