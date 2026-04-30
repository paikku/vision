"use client";

import { useState } from "react";

/**
 * Chip-style tag input. Type a tag and hit Enter or comma to commit.
 * Backspace on empty input removes the last tag. Whitespace trimmed; empty
 * tags ignored.
 */
export function TagInput({
  value,
  onChange,
  disabled,
  placeholder = "태그 입력 후 Enter…",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  };

  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  return (
    <div
      className={[
        "flex min-h-[34px] flex-wrap items-center gap-1 rounded-md bg-[var(--color-surface-2)] px-1.5 py-1",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      {value.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[11px]"
        >
          {t}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label="태그 삭제"
              className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"
            >
              ×
            </button>
          )}
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            removeAt(value.length - 1);
          }
        }}
        onBlur={() => draft && commit(draft)}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-[var(--color-muted)]"
      />
    </div>
  );
}
