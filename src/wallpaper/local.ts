import { TFile, TFolder, type App } from "obsidian";
import { isImagePath } from "./wallpaper";

/** Traverse only the selected folder; do not enumerate the whole vault for rotation. */
export function folderImages(app: App, path: string, recursive: boolean): TFile[] {
  const folder = app.vault.getAbstractFileByPath(path);
  if (!(folder instanceof TFolder)) return [];
  const files: TFile[] = [];
  const pending = [folder];
  while (pending.length) {
    for (const child of pending.pop()!.children) {
      if (child instanceof TFile && isImagePath(child.path)) files.push(child);
      else if (recursive && child instanceof TFolder) pending.push(child);
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Persist the visited set across restarts; new files join the current cycle. */
export function nextLocal(paths: string[], current: string, seen: string[], random = Math.random): { current: string; seen: string[] } {
  const available = new Set(paths);
  let visited = [...new Set(seen)].filter(path => available.has(path));
  let pool = paths.filter(path => !visited.includes(path));
  if (!pool.length) { visited = []; pool = [...paths]; }
  if (pool.length > 1) pool = pool.filter(path => path !== current);
  const next = pool[Math.floor(random() * pool.length)];
  return next ? { current: next, seen: [...visited, next] } : { current: "", seen: [] };
}
