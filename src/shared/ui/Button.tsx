"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

const buttonStyles = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent)]",
        secondary:
          "border border-[var(--color-line)] bg-transparent text-[var(--color-text)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-hover)]",
        ghost:
          "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-hover)]",
        subtle:
          "bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-surface-3)]",
        danger:
          "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-hover)]",
        "danger-ghost":
          "bg-transparent text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]",
        link: "bg-transparent p-0 text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline",
      },
      size: {
        xs: "h-6 rounded-[var(--radius-sm)] px-2 text-[var(--text-2xs)]",
        sm: "h-7 rounded-[var(--radius-md)] px-2.5 text-[var(--text-sm)]",
        md: "h-8 rounded-[var(--radius-md)] px-3 text-[var(--text-md)]",
        lg: "h-10 rounded-[var(--radius-lg)] px-4 text-[var(--text-base)] font-semibold",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "link",
        size: ["xs", "sm", "md", "lg"],
        class: "h-auto px-0",
      },
    ],
    defaultVariants: {
      variant: "secondary",
      size: "sm",
      block: false,
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonStyles>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariants {
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, leadingIcon, trailingIcon, children, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(buttonStyles({ variant, size, block }), className)}
      {...props}
    >
      {leadingIcon ? <span className="shrink-0">{leadingIcon}</span> : null}
      {children}
      {trailingIcon ? <span className="shrink-0">{trailingIcon}</span> : null}
    </button>
  );
});

export { buttonStyles };
