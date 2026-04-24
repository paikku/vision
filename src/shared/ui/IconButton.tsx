"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

const iconButtonStyles = cva(
  "inline-flex select-none items-center justify-center transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      variant: {
        ghost: "text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]",
        subtle:
          "bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-surface-3)]",
        solid:
          "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)]",
        danger:
          "text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]",
      },
      size: {
        xs: "h-6 w-6 rounded-[var(--radius-sm)]",
        sm: "h-7 w-7 rounded-[var(--radius-md)]",
        md: "h-8 w-8 rounded-[var(--radius-md)]",
        lg: "h-10 w-10 rounded-[var(--radius-lg)]",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "sm",
    },
  },
);

export type IconButtonVariants = VariantProps<typeof iconButtonStyles>;

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    IconButtonVariants {
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, variant, size, label, icon, type, ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        title={label}
        className={cn(iconButtonStyles({ variant, size }), className)}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
