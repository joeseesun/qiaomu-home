import { describe, expect, it } from "vitest";
import { appendTask, editTask, importLegacy, parseTasks } from "../src/quadrant-note";

export const original = '\uFEFF---\r\ntitle: "我的项目"\r\naliases: [家]\r\n---\r\n# Project\r\n正文 **keep** [[Link]]\r\n\r\n- [ ] Parent #q2 ^parent\r\n  + [ ] 子任务 #q3\r\n    details: keep this indentation\r\n\r\n```md\r\n- [ ] code example #q4\r\n```\r\n<!--\r\n- [ ] hidden\r\n-->\r\n1. [X] Finished #q4 ✅ 2026-10-20\r\nFooter without final newline';

describe("quadrant note patches", () => {
  it("reads real tagged/untagged/nested tasks, skipping properties, fences and comments", () => {
    expect(parseTasks(original).map(t => [t.text, t.quadrant, t.completed])).toEqual([
      ["Parent  ^parent", "q2", false], ["子任务", "q3", false], ["Finished", "q4", true],
    ]);
    expect(parseTasks("- [ ] Untagged")[0]).toMatchObject({ quadrant: "q1", tagged: false });
    expect(parseTasks(original)[2].completedAt).toBe(new Date(2026, 9, 20).getTime());
  });
  it('skips standalone indented code while retaining nested task lists', () => {
    const text = 'Paragraph\n\n    - [ ] Code example\n\n- List parent\n    - [ ] Nested task\n';
    expect(parseTasks(text).map(t => t.text)).toEqual(['Nested task']);
  });
  it("appends without changing any original byte, preserving BOM, CRLF and absent final newline", () => {
    const added = appendTask(original, "New task", "q1", "one");
    expect(added.slice(0, original.length)).toBe(original);
    expect(added.slice(original.length)).toBe('\r\n- [ ] New task #q1 <!-- qh-quadrant-op:one -->\r\n');
    expect(appendTask(added, "New task", "q1", "one")).toBe(added);
  });
  it("completes/restores only the selected checkbox/date, retaining nested lines, tags and block IDs", () => {
    const done = editTask(original, parseTasks(original)[0], "complete", new Date(2026, 9, 21, 23, 30).getTime());
    expect(done).toBe(original.replace('- [ ] Parent #q2 ^parent', '- [x] Parent #q2 ✅ 2026-10-21 ^parent'));
    expect(editTask(done, parseTasks(done)[0], "restore")).toBe(original);
  });
  it("deleting a parent keeps its list text and all nested content; leaf deletion removes only that row", () => {
    const parentDeleted = editTask(original, parseTasks(original)[0], "delete");
    expect(parentDeleted).toBe(original.replace('- [ ] Parent', '- Parent'));
    const leafDeleted = editTask(original, parseTasks(original)[1], "delete");
    expect(leafDeleted).toBe(original.replace('  + [ ] 子任务', '  + 子任务')); // owns an indented prose line
    expect(editTask(original, parseTasks(original)[2], "delete")).toBe(original.replace('1. [X] Finished #q4 ✅ 2026-10-20\r\n', ''));
  });
  it("keeps untagged tasks untagged and preserves unusual spacing/bullets and EOF", () => {
    const before = '*  [ ]\tDo  it   ';
    const after = editTask(before, parseTasks(before)[0], 'complete', new Date(2026, 9, 21).getTime());
    expect(after).toBe('*  [x]\tDo  it ✅ 2026-10-21   ');
    expect(editTask(after, parseTasks(after)[0], 'restore')).toBe(before);
  });
  it("rejects changed/deleted or ambiguous targets instead of editing another task", () => {
    const before = '- [ ] Same\n- [ ] Same\n';
    expect(editTask(before, parseTasks(before)[1], 'delete')).toBe('- [ ] Same\n');
    expect(() => editTask('- [ ] Same\n', parseTasks(before)[0], 'complete')).toThrow('ambiguous');
    expect(() => editTask('prose\n' + before, parseTasks(before)[0], 'complete')).toThrow('ambiguous');
    expect(() => editTask('- [ ] Changed\n', parseTasks(before)[0], 'complete')).toThrow();
    expect(editTask('prose\n- [ ] Unique\n', parseTasks('- [ ] Unique\n')[0], 'delete')).toBe('prose\n');
  });
  it.each(['---\ntitle: unfinished', '```md\nexample', '<!-- unfinished'])('does not append into unclosed syntax: %s', source => {
    expect(() => appendTask(source, 'new', 'q1', 'id')).toThrow();
  });
  it("recognizes only complete quadrant tags outside inline code", () => {
    expect(parseTasks('- [ ] Keep #q12 #q1/child `#q2` #q3')[0]).toMatchObject({ text: 'Keep #q12 #q1/child `#q2`', quadrant: 'q3' });
  });
  it('does not remove a matching literal tag inside inline code', () => {
    expect(parseTasks('- [ ] Keep `#q2` #q2')[0].text).toBe('Keep `#q2`');
  });
  it('preserves literal invalid dates and edits metadata at the correct offset after hidden comments', () => {
    const before = '- [x] Text <!-- qh-quadrant-op:a --> more #q1 ✅ 2026-10-20';
    expect(editTask(before, parseTasks(before)[0], 'restore')).toBe('- [ ] Text <!-- qh-quadrant-op:a --> more #q1');
    const invalid = '- [x] Text ✅ 2026-99-99';
    expect(editTask(invalid, parseTasks(invalid)[0], 'restore')).toBe('- [ ] Text ✅ 2026-99-99');
  });
  it("keeps migration receipts after a task is deleted so cleanup retries cannot recreate it", () => {
    const legacy = [{ id: 'old 1', text: 'Legacy', quadrant: 'q2' as const, completed: false, createdAt: 0, completedAt: null }];
    const imported = importLegacy(original, legacy);
    expect(imported.startsWith(original)).toBe(true);
    expect(importLegacy(imported, legacy)).toBe(imported);
    const deleted = editTask(imported, parseTasks(imported).at(-1)!, 'delete');
    expect(importLegacy(deleted, legacy)).toBe(deleted);
  });
});
