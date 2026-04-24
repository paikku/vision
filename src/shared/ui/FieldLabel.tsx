"use client";

import { type LabelHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  hint?: ReactNode;
}

export function FieldLabel({ required, hint, className, children, ...props }: FieldLabelProps) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-2 text-[var(--text-sm)] font-medium text-[var(--color-muted)]",
        className,
      )}
      {...props}
    >
      <span>
        {children}
        {required ? <span className="ml-0.5 text-[var(--color-danger)]">*</span> : null}
      </span>
      {hint ? <span className="text-[var(--text-2xs)] text-[var(--color-subtle)]">{hint}</span> : null}
    </label>
  );
}
