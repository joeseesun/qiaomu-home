import { isComposingKey } from "./input-ui";
import type { Setting } from "obsidian";
import { L } from "./i18n";

/** Placeholders that show literal syntax (moment formats, Dataview, Obsidian search) and must keep their casing. */
export const SYNTAX_EXAMPLES = { weekly: "gggg-[W]ww", search: "tag:#work" } as const;

const pending = new WeakMap<HTMLElement, Set<() => void>>();

/**
 * Saves a text setting without a separate Save button: on blur, on Enter (⌘/Ctrl+Enter in text areas), on change
 * for date/time pickers, and when the dialog closes. `commit` may throw or return false; the error shows under the
 * field and the value stays so the user can fix it.
 */
export function autoSave(root: HTMLElement, setting: Setting, field: HTMLInputElement | HTMLTextAreaElement, commit: (value: string) => unknown): void {
  let saved = field.value, busy = false, queued = false, timer = 0;
  const status = setting.descEl.createDiv({ cls: "qh-save-state" });
  status.setAttr("aria-live", "polite");
  const clear = () => { status.setText(""); status.removeClass("is-error", "is-saved"); field.removeClass("is-invalid"); field.removeAttribute("aria-invalid"); };
  const flush = () => {
    const value = field.value;
    // A blur or close during an async save must preserve the latest edit, including a revert.
    if (busy) { queued = true; return; }
    if (value === saved) return;
    busy = true;
    window.clearTimeout(timer);
    void Promise.resolve().then(() => commit(value)).then(result => {
      if (result === false) throw new Error(L("保存失败，请重试", "Could not save; try again"));
      saved = value; clear();
      status.setText(L("已保存", "Saved")); status.addClass("is-saved");
      timer = window.setTimeout(() => { if (status.hasClass("is-saved")) status.setText(""); }, 1800);
    }).catch((error: unknown) => {
      clear();
      status.setText(error instanceof Error && error.message ? error.message : L("保存失败，请重试", "Could not save; try again"));
      status.addClass("is-error"); field.addClass("is-invalid"); field.setAttr("aria-invalid", "true");
    }).finally(() => {
      busy = false;
      if (queued) { queued = false; flush(); }
    });
  };
  field.addEventListener("input", clear);
  field.addEventListener("blur", flush);
  field.addEventListener("change", flush);
  field.addEventListener("keydown", event => {
    const submit = event instanceof KeyboardEvent && event.key === "Enter" && !isComposingKey(event) && (field instanceof HTMLInputElement || event.metaKey || event.ctrlKey);
    if (submit) { event.preventDefault(); flush(); }
  });
  if (!pending.has(root)) pending.set(root, new Set());
  pending.get(root)!.add(flush);
}

/** Commits every changed field in a dialog; call from Modal.onClose before emptying it. */
export function flushFields(root: HTMLElement): void {
  pending.get(root)?.forEach(flush => flush());
  pending.delete(root);
}
