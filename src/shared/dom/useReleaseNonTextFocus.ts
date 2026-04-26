"use client";

import { useEffect, type RefObject } from "react";
import { isTextInputElement } from "./isEditableElement";

/**
 * Globally release focus from non-text-input elements after user interaction
 * so workspace keyboard shortcuts stay live.
 *
 * After the user clicks a button, picks a `<select>` option, toggles a
 * checkbox, etc., the browser leaves focus on that element. Global shortcuts
 * that gate on `isEditableElement` then refuse to fire (`<select>`) or just
 * feel sticky because Space/Enter retriggers the focused button. Calling this
 * hook from a shell once moves focus back to `document.body` once the
 * interaction has settled.
 *
 * Triggers (all attached to `rootRef.current` in the capture phase):
 *   - `pointerup`  — covers any mouse/pen/touch interaction end. Skipped when
 *     the target is inside a `<select>` because the dropdown stays open only
 *     while the select keeps focus; blurring here would close it before the
 *     user can pick an option. The `change` listener still fires once a value
 *     is chosen, and an outside-click pointerup releases focus if the user
 *     cancels.
 *   - `change`     — covers select/checkbox/radio/color/range value changes
 *     (also fires for keyboard-driven changes that produce no pointerup).
 *   - `keyup`      — Enter/Space activations on focused buttons.
 *
 * The blur is deferred via `requestAnimationFrame` so it doesn't race with
 * native handlers that depend on the element still being focused (e.g. the
 * select committing its choice).
 *
 * Skip rules — the hook does NOT blur when:
 *   - active element is a text input (per `isTextInputElement`)
 *   - active element carries `data-keep-focus` (escape hatch for modals,
 *     focus traps, intentionally sticky widgets)
 *   - active element lives outside `rootRef` (e.g. portal'd menu)
 *
 * Tab-key navigation is intentionally NOT a trigger, so keyboard users keep
 * normal focus traversal and visible focus rings.
 */
export function useReleaseNonTextFocus(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scheduleBlur = () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return;
        if (active === document.body) return;
        if (!root.contains(active)) return;
        if (isTextInputElement(active)) return;
        if (active.closest("[data-keep-focus]")) return;
        active.blur();
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      // Native <select>: pointerup fires while the dropdown is still open
      // because the select retains focus until the user picks (or cancels).
      // Skip — the `change` handler covers the pick, and if the user cancels
      // by clicking elsewhere, that outside pointerup will release focus.
      const target = e.target;
      if (target instanceof Element && target.closest("select")) return;
      scheduleBlur();
    };

    root.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("change", scheduleBlur, true);
    root.addEventListener("keyup", scheduleBlur, true);
    return () => {
      root.removeEventListener("pointerup", onPointerUp, true);
      root.removeEventListener("change", scheduleBlur, true);
      root.removeEventListener("keyup", scheduleBlur, true);
    };
  }, [rootRef]);
}
