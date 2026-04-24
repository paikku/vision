"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const inputStyles = cva(
  "w-full bg-[var(--color-surface-2)] text-[var(--color-text)] placeholder:text-[var(--color-subtle)] outline-none transition-colors border border-[var(--color-line)] focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      size: {
        sm: "h-7 rounded-[var(--radius-md)] px-2 text-[var(--text-sm)]",
        md: "h-8 rounded-[var(--radius-md)] px-2.5 text-[var(--text-md)]",
        lg: "h-10 rounded-[var(--radius-lg)] px-3 text-[var(--text-base)]",
      },
      flavor: {
        filled: "",
        bare: "border-transparent bg-transparent hover:bg-[var(--color-hover)] focus:bg-[var(--color-surface-2)]",
      },
    },
    defaultVariants: {
      size: "sm",
      flavor: "filled",
    },
  },
);

export type InputVariants = VariantProps<typeof inputStyles>;

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export interface InputProps extends NativeInputProps, InputVariants {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, flavor, type, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type ?? "text"}
      className={cn(inputStyles({ size, flavor }), className)}
      {...props}
    />
  );
});

type NativeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size">;

export interface TextareaProps extends NativeTextareaProps, Pick<InputVariants, "flavor"> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, flavor, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        inputStyles({ size: "md", flavor }),
        "h-auto min-h-[80px] py-2 leading-[var(--leading-snug)]",
        className,
      )}
      {...props}
    />
  );
});
