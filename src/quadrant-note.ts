import type { Quadrant, QuadrantTask } from "./quadrant-data";

export interface NoteTask {
  text: string;
  quadrant: Quadrant;
  completed: boolean;
  completedAt: number | null;
  tagged: boolean;
  source: string;
  raw: string;
  line: number;
  start: number;
  end: number;
  checkbox: number;
  indent: number;
}
interface Line { raw: string; eol: string; start: number; end: number }
const marker = /<!-- qh-quadrant-(?:op|migrated):[^\r\n]*? -->/g;
const visible = (text: string) => text.replace(marker, value => " ".repeat(value.length)).replace(/(`+)[\s\S]*?\1/g, value => " ".repeat(value.length));
function lines(content: string): Line[] {
  const result: Line[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (let m; (m = pattern.exec(content)) && m[0];) result.push({ raw: m[1], eol: m[2], start: m.index, end: pattern.lastIndex });
  return result;
}
function scan(content: string): { rows: Line[]; allowed: Set<number>; closed: boolean } {
  const rows = lines(content), allowed = new Set<number>();
  const listIndents: number[] = [];
  let yaml = false, fence = "", fenceLength = 0, comment = false;
  rows.forEach(({ raw }, i) => {
    if (i === 0 && raw.replace(/^\uFEFF/, "").trim() === "---") { yaml = true; return; }
    if (yaml) { if (/^(---|\.\.\.)\s*$/.test(raw)) yaml = false; return; }
    const delimiter = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { if (delimiter?.[1][0] === fence && delimiter[1].length >= fenceLength && /^\s*(`+|~+)\s*$/.test(raw)) fence = ""; return; }
    if (!comment && delimiter) { fence = delimiter[1][0]; fenceLength = delimiter[1].length; return; }
    const wasComment = comment;
    // Ignore multiline HTML comments, including apparent tasks within them.
    for (const token of raw.matchAll(/<!--|-->/g)) comment = token[0] === "<!--";
    if (!wasComment && !comment && !raw.trimStart().startsWith("<!--")) {
      const indent = raw.match(/^\s*/)![0].replace(/\t/g, "    ").length;
      if (raw.trim()) {
        while (listIndents.length && listIndents.at(-1)! >= indent) listIndents.pop();
        // A standalone indented code block is not a task; nested list tasks remain editable.
        if (indent >= 4 && !listIndents.length) return;
        if (/^\s*(?:[-*+]|\d+[.)])[ \t]+/.test(raw)) listIndents.push(indent);
      }
      allowed.add(i);
    }
  });
  return { rows, allowed, closed: !yaml && !fence && !comment };
}
function dateToken(raw: string): RegExpMatchArray | null {
  const match = visible(raw).match(/[ \t]+✅[ \t]+(\d{4}-\d{2}-\d{2})(?=[ \t]*(?:\^[\w-]+)?[ \t]*$)/);
  return match && dateValue(match[1]) !== null ? match : null;
}
function dateValue(value: string): number | null {
  const [y, m, d] = value.split("-").map(Number), date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date.getTime() : null;
}
export function localDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseTasks(content: string): NoteTask[] {
  const { rows, allowed } = scan(content);
  return rows.flatMap((row, line) => {
    if (!allowed.has(line)) return [];
    const match = row.raw.match(/^(\s*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]([ \t]+)(.*)$/);
    if (!match) return [];
    const tag = visible(match[4]).match(/(?:^|[ \t])(#q[1-4])(?=$|[ \t])/), date = dateToken(match[4]);
    let text = match[4];
    if (date) text = text.slice(0, date.index) + text.slice(date.index! + date[0].length);
    if (tag) { const at = tag.index! + tag[0].length - tag[1].length; text = text.slice(0, at) + text.slice(at + tag[1].length); }
    return [{ text: text.replace(marker, "").trim(), quadrant: (tag?.[1].slice(1) ?? "q1") as Quadrant, tagged: !!tag, completed: match[2] !== " ", completedAt: date ? dateValue(date[1]) : null,
      source: content, raw: row.raw, line, start: row.start, end: row.end, checkbox: match[1].length + 1, indent: row.raw.match(/^\s*/)![0].replace(/\t/g, "    ").length }];
  });
}
function locate(content: string, task: NoteTask): NoteTask {
  const candidates = parseTasks(content).filter(item => item.raw === task.raw);
  const found = content === task.source ? candidates.find(item => item.line === task.line) : candidates.length === 1 && parseTasks(task.source).filter(item => item.raw === task.raw).length === 1 ? candidates[0] : undefined;
  if (!found) throw new Error("Task changed or is ambiguous; reload the card before retrying.");
  return found;
}
export function editTask(content: string, selected: NoteTask, action: "complete" | "restore" | "delete", now = Date.now()): string {
  const task = locate(content, selected);
  let raw = task.raw;
  if (action === "delete") {
    const following = lines(content).slice(task.line + 1).find(line => line.raw.trim());
    const hasChildren = following && following.raw.match(/^\s*/)![0].replace(/\t/g, "    ").length > task.indent;
    // A parent becomes an ordinary list item: its descendants/prose retain their context.
    if (hasChildren) raw = raw.slice(0, task.checkbox - 1) + raw.slice(task.checkbox + 3);
    else return content.slice(0, task.start) + content.slice(task.end);
  } else {
    raw = raw.slice(0, task.checkbox) + (action === "complete" ? "x" : " ") + raw.slice(task.checkbox + 1);
    const date = dateToken(raw);
    if (action === "restore" && date) raw = raw.slice(0, date.index) + raw.slice(date.index! + date[0].length);
    if (action === "complete" && !date) {
      const suffix = raw.match(/(?:[ \t]+\^[\w-]+)?(?:[ \t]+<!-- qh-quadrant-(?:op|migrated):[^\r\n]*? -->)?[ \t]*$/)![0];
      raw = raw.slice(0, raw.length - suffix.length) + ` ✅ ${localDate(now)}` + suffix;
    }
  }
  return content.slice(0, task.start) + raw + content.slice(task.start + task.raw.length);
}
function appendLines(content: string, rows: string[]): string {
  if (!scan(content).closed) throw new Error("Close the note's frontmatter, code fence or comment before adding tasks.");
  const eol = content.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  return content + (content && !/[\r\n]$/.test(content) ? eol : "") + rows.join(eol) + eol;
}
export function appendTask(content: string, text: string, quadrant: Quadrant, operation: string): string {
  const token = `<!-- qh-quadrant-op:${encodeURIComponent(operation)} -->`;
  if (content.includes(token)) return content;
  if (!text.trim() || /[\r\n]/.test(text)) throw new Error("Enter a single-line task.");
  return appendLines(content, [`- [ ] ${text.trim()} #${quadrant} ${token}`]);
}
export function importLegacy(content: string, tasks: QuadrantTask[]): string {
  const rows: string[] = [];
  for (const task of tasks) {
    // Separate receipts survive task deletion and make interrupted migrations idempotent.
    const receipt = `<!-- qh-quadrant-migrated:${encodeURIComponent(task.id)} -->`;
    if (content.includes(receipt)) continue;
    if (/[\r\n]/.test(task.text)) throw new Error("A legacy task contains multiple lines; keep the backup and migrate it manually.");
    rows.push(receipt, `- [${task.completed ? "x" : " "}] ${task.text} #${task.quadrant}${task.completed && task.completedAt ? ` ✅ ${localDate(task.completedAt)}` : ""}`);
  }
  return rows.length ? appendLines(content, rows) : content;
}
