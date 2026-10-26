import { MarkdownView, TFile, type App } from "obsidian";
import { appendTask, editTask, importLegacy, parseTasks, type NoteTask } from "./quadrant-note";
import type { Quadrant, QuadrantTask } from "./quadrant-data";

export interface QuadrantNote { path: string; file: TFile | null; content: string; tasks: NoteTask[] }
const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
export function validateQuadrantPath(path: string, configDir: string): string {
  if (!path || path !== path.trim() || /[\\:]/.test(path) || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.startsWith("/") || !/\.md$/i.test(path)
    || path.split("/").some(part => !part || part === "." || part === "..") || path.toLowerCase() === configDir.toLowerCase() || path.toLowerCase().startsWith(`${configDir.toLowerCase()}/`)) {
    throw new Error("Choose a Markdown path inside the vault, outside its configuration folder.");
  }
  return path;
}
export class QuadrantNoteStore {
  constructor(private app: App) {}
  private path(path: string): string { return validateQuadrantPath(path, this.app.vault.configDir); }
  private file(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && !(file instanceof TFile)) throw new Error("The task note path is a folder.");
    return file;
  }
  private snapshot(path: string, file: TFile | null, content: string): QuadrantNote { return { path, file, content, tasks: parseTasks(content) }; }
  async read(path: string): Promise<QuadrantNote> {
    path = this.path(path);
    const file = this.file(path);
    return this.snapshot(path, file, file ? await this.app.vault.read(file) : "");
  }
  private enqueue<T>(path: string, action: () => Promise<T>): Promise<T> {
    let queue = queues.get(this.app.vault);
    if (!queue) queues.set(this.app.vault, queue = new Map<string, Promise<unknown>>());
    const next = (queue.get(path) ?? Promise.resolve()).catch(() => {}).then(action);
    queue.set(path, next);
    void next.finally(() => { if (queue.get(path) === next) queue.delete(path); }).catch(() => {});
    return next;
  }
  private write(note: QuadrantNote, transform: (content: string) => string): Promise<QuadrantNote> {
    const path = this.path(note.path);
    return this.enqueue(path, async () => {
      let file = this.file(path);
      if (note.file && file !== note.file) throw new Error("The task note was moved or deleted; reload before retrying.");
      let content: string;
      if (file) {
        content = await this.app.vault.process(file, latest => {
          const dirty = (this.app.workspace?.getLeavesOfType("markdown") ?? []).some(leaf =>
            leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.editor.getValue() !== latest);
          if (dirty) throw new Error("Save the open task note before retrying.");
          return transform(latest);
        });
      } else {
        content = transform("");
        // Do not auto-create directories or overwrite a concurrently created note.
        file = await this.app.vault.create(path, content);
      }
      return this.snapshot(path, file, content);
    });
  }
  add(note: QuadrantNote, text: string, quadrant: Quadrant, operation: string): Promise<QuadrantNote> {
    return this.write(note, content => appendTask(content, text, quadrant, operation));
  }
  edit(note: QuadrantNote, task: NoteTask, action: "complete" | "restore" | "delete"): Promise<QuadrantNote> {
    return this.write(note, content => editTask(content, task, action));
  }
  async migrate(path: string, tasks: QuadrantTask[]): Promise<QuadrantNote> {
    // A failed read never becomes an empty snapshot for a later write.
    return this.write(await this.read(path), content => importLegacy(content, tasks));
  }
}
