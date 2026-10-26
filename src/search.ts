import { prepareFuzzySearch } from "obsidian";

export interface NoteCandidate {
  path: string;
  basename: string;
  extension: string;
  aliases: string[];
  mtime: number;
}

export interface NoteMatch {
  path: string;
  title: string;
  folder: string;
  extension: string;
  /** Alias that matched when it scored better than the file name. */
  alias?: string;
  score: number;
}

/** Extensions Home can open as notes or documents. Attachments like images still show up; they open in Obsidian's viewer. */
export const SEARCHABLE = new Set(["md", "canvas", "base", "pdf", "png", "jpg", "jpeg", "webp", "gif", "svg", "mp3", "m4a", "mp4", "epub"]);

/**
 * Ranks vault files for a query. Name matches outrank path matches; recently opened files get a small boost;
 * an exact (case-insensitive) name match always ranks first.
 */
export function rankNotes(query: string, candidates: NoteCandidate[], recent: string[], limit: number): NoteMatch[] {
  const q = query.trim();
  if (!q) return [];
  const fuzzy = prepareFuzzySearch(q);
  const lower = q.toLowerCase();
  const recentRank = new Map(recent.map((path, index) => [path, index]));
  const matches: NoteMatch[] = [];
  for (const file of candidates) {
    if (!SEARCHABLE.has(file.extension)) continue;
    let best = -Infinity;
    let alias: string | undefined;
    const name = fuzzy(file.basename);
    if (name) best = name.score + 2;
    for (const candidate of file.aliases) {
      const hit = fuzzy(candidate);
      if (hit && hit.score + 1.5 > best) { best = hit.score + 1.5; alias = candidate; }
    }
    if (best === -Infinity) {
      const path = fuzzy(file.path);
      if (!path) continue;
      best = path.score;
    }
    if (file.basename.toLowerCase() === lower) best += 100;
    else if (file.basename.toLowerCase().startsWith(lower)) best += 1;
    const rank = recentRank.get(file.path);
    if (rank !== undefined) best += Math.max(0, 1 - rank / 20);
    if (file.extension === "md") best += 0.1;
    const slash = file.path.lastIndexOf("/");
    matches.push({
      path: file.path, title: file.basename, folder: slash > 0 ? file.path.slice(0, slash) : "",
      extension: file.extension, score: best, ...(alias && alias !== file.basename ? { alias } : {}),
    });
  }
  // A short query matches most of a large vault. Only scores that can reach the top `limit` need the
  // locale-aware sort; the order of what is returned is exactly that of sorting everything.
  if (matches.length > limit) {
    const scores = Float64Array.from(matches, (match) => match.score).sort();
    const cutoff = scores[scores.length - limit];
    return matches.filter((match) => match.score >= cutoff)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  }
  return matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/** Turns a free-text query into a safe note file name (no path separators or reserved characters). */
export function noteNameFromQuery(query: string): string {
  return query.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
