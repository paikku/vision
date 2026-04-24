"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  const control = (
    <input
      ref={ref}
      type="checkbox"
      id={id}
      className={cn(
        "h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        !label && className,
      )}
      {...props}
    />
  );
  if (!label) return control;
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-text)]",
        props.disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      {control}
      <span className="flex min-w-0 flex-col leading-[var(--leading-tight)]">
        <span>{label}</span>
        {description ? (
          <span className="text-[var(--text-2xs)] text-[var(--color-muted)]">{description}</span>
        ) : null}
      </span>
    </label>
  );
});
