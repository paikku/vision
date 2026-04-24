"use client";

import {
  forwardRef,
  useEffect,
  type ReactNode,
  type MouseEvent,
  type HTMLAttributes,
} from "react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Disable close-on-backdrop-click (defaults to enabled) */
  dismissOnBackdrop?: boolean;
  /** Disable ESC-to-close (defaults to enabled) */
  dismissOnEscape?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}

const sizeClass: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "w-[400px] max-w-[92vw]",
  md: "w-[560px] max-w-[92vw]",
  lg: "w-[840px] max-w-[95vw]",
  xl: "w-[1200px] max-w-[95vw]",
  full: "w-[96vw] h-[92vh]",
};

export function Modal({
  open,
  onClose,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  size = "md",
  className,
  children,
  ...ariaProps
}: ModalProps) {
  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissOnEscape, onClose]);

  if (!open) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (!dismissOnBackdrop) return;
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      {...ariaProps}
      onMouseDown={onBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] p-4 backdrop-blur-sm"
    >
      <div
        className={cn(
          "relative flex max-h-[95vh] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-lg)]",
          sizeClass[size],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface ModalHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
  className,
  children,
  ...props
}: ModalHeaderProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? (
          <div className="text-[var(--text-base)] font-semibold text-[var(--color-text-strong)]">
            {title}
          </div>
        ) : null}
        {subtitle ? (
          <div className="text-[var(--text-sm)] text-[var(--color-muted)]">{subtitle}</div>
        ) : null}
        {children}
      </div>
      {onClose ? (
        <IconButton
          label="닫기"
          size="sm"
          onClick={onClose}
          icon={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          }
        />
      ) : null}
    </div>
  );
}

export const ModalBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ModalBody({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5", className)}
        {...props}
      />
    );
  },
);

export function ModalFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-line)] px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
