const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
]);

/**
 * Broad predicate: "is this target currently capturing text input?"
 * Use this to gate global keyboard shortcuts so typing in a field is never
 * intercepted. `<select>` is included because it consumes typed letters for
 * option matching.
 */
export function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const editableRoot = target.closest("[contenteditable='true']");
  if (editableRoot) return true;

  const tag = target.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;

  const type = (target as HTMLInputElement).type.toLowerCase();
  return ![
    "checkbox",
    "radio",
    "button",
    "submit",
    "reset",
    "file",
    "color",
    "range",
  ].includes(type);
}

/**
 * Strict predicate: "is this element worth keeping focus on after the user
 * is done interacting?" Only true for genuine text-entry surfaces. `<select>`,
 * checkbox, radio, color, range etc. are all false — those should release
 * focus so global shortcuts work without an extra click.
 */
export function isTextInputElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;

  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;

  const type = (target as HTMLInputElement).type.toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
}
