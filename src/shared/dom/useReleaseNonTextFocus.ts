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
 *   - `pointerup`  — covers any mouse/pen/touch interaction end, including
 *     `<select>` dropdown close.
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

    const release = () => {
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

    root.addEventListener("pointerup", release, true);
    root.addEventListener("change", release, true);
    root.addEventListener("keyup", release, true);
    return () => {
      root.removeEventListener("pointerup", release, true);
      root.removeEventListener("change", release, true);
      root.removeEventListener("keyup", release, true);
    };
  }, [rootRef]);
}
