import { vi } from 'vitest';
import { TFile } from 'obsidian';
import { QuadrantNoteStore } from '../src/quadrant-store';
export function vaultHarness(content: string | null = '---\ntitle: Keep\n---\nBody\n- [ ] Existing #q2\n') {
  let text = content, file = content === null ? null : Object.assign(new TFile(), { path: 'Tasks.md' });
  const leaves: unknown[] = [];
  const vault = {
    configDir: '.obsidian', on: vi.fn(),
    getAbstractFileByPath: vi.fn((path: string) => path === 'Tasks.md' ? file : null),
    read: vi.fn(async () => { if (text === null) throw Error('missing'); return text; }),
    process: vi.fn(async (_file: TFile, fn: (value: string) => string) => { if (text === null) throw Error('missing'); const next = fn(text); text = next; return next; }),
    create: vi.fn(async (path: string, value: string) => { if (file) throw Error('exists'); file = Object.assign(new TFile(), { path }); text = value; return file; }),
  };
  const app = { vault, workspace: { getLeavesOfType: (kind: string) => kind === 'markdown' ? leaves : [], on: vi.fn(), onLayoutReady: vi.fn() } };
  return { app, vault, store: new QuadrantNoteStore(app as never), content: () => text, external: (value: string | null) => { text = value; if (value === null) file = null; }, leaves };
}
