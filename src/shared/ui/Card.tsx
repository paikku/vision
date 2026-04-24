"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn";

const cardStyles = cva("flex flex-col", {
  variants: {
    variant: {
      panel:
        "bg-[var(--color-surface)] border border-[var(--color-line)] rounded-[var(--radius-lg)]",
      raised:
        "bg-[var(--color-surface-2)] border border-[var(--color-line)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]",
      ghost: "bg-transparent",
      plain:
        "bg-[var(--color-surface)] border border-[var(--color-line)] rounded-[var(--radius-md)]",
    },
    padding: {
      none: "",
      sm: "p-2",
      md: "p-3",
      lg: "p-4",
    },
  },
  defaultVariants: {
    variant: "panel",
    padding: "none",
  },
});

export type CardVariants = VariantProps<typeof cardStyles>;

export interface CardProps extends HTMLAttributes<HTMLDivElement>, CardVariants {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, padding, ...props },
  ref,
) {
  return <div ref={ref} className={cn(cardStyles({ variant, padding }), className)} {...props} />;
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 text-[var(--text-md)] font-medium text-[var(--color-text-strong)]",
          className,
        )}
        {...props}
      />
    );
  },
);

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardBody({ className, ...props }, ref) {
    return <div ref={ref} className={cn("flex flex-col gap-2 p-3", className)} {...props} />;
  },
);

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center justify-end gap-2 border-t border-[var(--color-line)] px-3 py-2",
          className,
        )}
        {...props}
      />
    );
  },
);
