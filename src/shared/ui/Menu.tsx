"use client";

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** Positioning — these are applied as inline fixed position. */
  x: number;
  y: number;
  children: ReactNode;
  className?: string;
}

export function Menu({ open, onClose, x, y, children, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      style={{ top: y, left: x }}
      className={cn(
        "fixed z-50 min-w-[180px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] py-1 text-[var(--text-sm)] shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MenuItemProps extends HTMLAttributes<HTMLButtonElement> {
  tone?: "default" | "danger";
  disabled?: boolean;
  shortcut?: ReactNode;
  children: ReactNode;
}

export function MenuItem({
  tone = "default",
  disabled,
  shortcut,
  className,
  children,
  ...props
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        tone === "danger"
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-hover)]",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {shortcut ? (
        <span className="shrink-0 text-[var(--text-2xs)] text-[var(--color-subtle)]">{shortcut}</span>
      ) : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-[var(--color-line)]" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-1.5 text-[var(--text-2xs)] font-medium uppercase tracking-wide text-[var(--color-subtle)]">
      {children}
    </div>
  );
}
