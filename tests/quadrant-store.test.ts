import { describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile, TFolder } from 'obsidian';
import { QuadrantNoteStore, validateQuadrantPath } from '../src/quadrant-store';
import { parseTasks } from '../src/quadrant-note';

import { vaultHarness } from './quadrant-harness';

describe('quadrant note storage', () => {
  it('rebases concurrent cards onto the latest raw content and retains external edits', async () => {
    const h = vaultHarness(), a = await h.store.read('Tasks.md'), b = await h.store.read('Tasks.md');
    h.external(h.content() + 'External prose\n');
    await Promise.all([h.store.add(a, 'A', 'q1', 'a'), h.store.add(b, 'B', 'q3', 'b')]);
    expect(parseTasks(h.content()!).map(t => t.text)).toEqual(['Existing', 'A', 'B']);
    expect(h.content()).toContain('External prose\n');
    expect(h.content()).toMatch(/^---\ntitle: Keep\n---\nBody/);
  });
  it('read failure prevents migration writes; rejected writes recover without stale snapshots', async () => {
    const h = vaultHarness();
    h.vault.read.mockRejectedValueOnce(Error('read failed'));
    await expect(h.store.migrate('Tasks.md', [])).rejects.toThrow('read failed');
    expect(h.vault.process).not.toHaveBeenCalled();
    const note = await h.store.read('Tasks.md'), before = h.content();
    h.vault.process.mockRejectedValueOnce(Error('disk full'));
    await expect(h.store.add(note, 'A', 'q1', 'a')).rejects.toThrow('disk full');
    expect(h.content()).toBe(before);
    await h.store.add(note, 'A', 'q1', 'a');
    expect(parseTasks(h.content()!)).toHaveLength(2);
  });
  it('retries an uncertain add result without duplicating a write that reached disk', async () => {
    const h = vaultHarness(), note = await h.store.read('Tasks.md');
    const process = h.vault.process.getMockImplementation()!;
    h.vault.process.mockImplementationOnce(async (...args) => { await process(...args); throw Error('interrupted after write'); });
    await expect(h.store.add(note, 'A', 'q1', 'a')).rejects.toThrow();
    await h.store.add(note, 'A', 'q1', 'a');
    expect(parseTasks(h.content()!).filter(t => t.text === 'A')).toHaveLength(1);
  });
  it('does not resurrect deleted tasks or a note removed while a card was open', async () => {
    const h = vaultHarness(), note = await h.store.read('Tasks.md');
    await h.store.edit(note, note.tasks[0], 'delete');
    await expect(h.store.edit(note, note.tasks[0], 'complete')).rejects.toThrow();
    h.external(null);
    await expect(h.store.add(note, 'A', 'q1', 'a')).rejects.toThrow('moved or deleted');
    expect(h.vault.create).not.toHaveBeenCalled();
  });
  it('uses an existing concurrently created note instead of overwriting it', async () => {
    const h = vaultHarness(null), a = await h.store.read('Tasks.md'), b = await h.store.read('Tasks.md');
    await Promise.all([h.store.add(a, 'A', 'q1', 'a'), h.store.add(b, 'B', 'q1', 'b')]);
    expect(parseTasks(h.content()!).map(t => t.text)).toEqual(['A', 'B']);
    expect(h.vault.create).toHaveBeenCalledTimes(1);
  });
  it('refuses to overwrite any unsaved Markdown editor', async () => {
    const h = vaultHarness(), note = await h.store.read('Tasks.md'), before = h.content();
    h.leaves.push({ view: Object.assign(new MarkdownView(), { file: note.file, editor: { getValue: () => before + 'Unsaved' } }) });
    await expect(h.store.add(note, 'A', 'q1', 'a')).rejects.toThrow('Save the open');
    expect(h.content()).toBe(before);
    h.leaves.length = 0;
    await h.store.add(note, 'A', 'q1', 'a');
  });
  it('rejects a folder at the note path', async () => {
    const h = vaultHarness(); h.vault.getAbstractFileByPath.mockReturnValue(new TFolder() as never);
    await expect(h.store.read('Tasks.md')).rejects.toThrow('folder');
  });
  it.each(['/tmp/x.md', '../x.md', 'a/../x.md', 'a//x.md', './x.md', 'C:\\x.md', '.obsidian/x.md', 'x.md\n', 'x.txt', 'file:x.md'])('rejects unsafe path %s', path => {
    expect(() => validateQuadrantPath(path, ".obsidian")).toThrow();
  });
});
