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
