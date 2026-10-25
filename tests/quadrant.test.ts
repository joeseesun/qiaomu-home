import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/view", () => ({ HOME_VIEW_TYPE: "qiaomu-home", HomeView: class {} }));
vi.mock("../src/settings-tab", () => ({ HomeSettingTab: class {} }));
vi.mock("../src/pane-dividers", () => ({ watchPaneDividers: () => {} }));
vi.mock("../src/wallpaper/service", () => ({ WallpaperService: class {} }));
vi.mock("obsidian", async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    SuggestModal: class {},
    Notice: vi.fn(),
    Plugin: class {
      constructor(public app: unknown, public manifest: unknown) {}
      register() {} registerEvent() {} registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {}
      registerInterval(timer: number) { window.clearInterval(timer); }
    },
    Modal: class {
      modalEl = document.createElement("div");
      contentEl = document.createElement("div");
      constructor(public app: unknown) {
        this.modalEl.className = "modal"; this.modalEl.append(this.contentEl);
        this.modalEl.addEventListener("keydown", event => { if (event.key === "Escape") this.close(); });
      }
      setTitle(title: string) { this.modalEl.setAttribute("aria-label", title); }
      open() { document.body.append(this.modalEl); this.onOpen(); }
      close() { this.onClose(); this.modalEl.remove(); }
      onOpen() {} onClose() {}
    },
  };
});

import { Notice } from "obsidian";
import QiaomuHomePlugin from "../src/main";
import { renderProductivity } from "../src/productivity-ui";
import { normalizeSettings } from "../src/settings";
import { setLanguage } from "../src/i18n";
import type { QuadrantTask } from "../src/quadrant-data";

// Obsidian's DOM helpers over real jsdom elements, so forms dispatch native events.
function installDomHelpers() {
  const methods = {
    createEl(this: HTMLElement, tag: string, options: Record<string, any> = {}) {
      const el = this.ownerDocument.createElement(tag);
      if (options.cls) el.className = options.cls;
      if (options.text) el.textContent = options.text;
      for (const key of ["type", "value", "placeholder"]) if (options[key] !== undefined) el.setAttribute(key, options[key]);
      for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
      this.append(el); return el;
    },
    createDiv(this: HTMLElement, options?: Record<string, unknown>) { return this.createEl("div", options); },
    createSpan(this: HTMLElement, options?: Record<string, unknown>) { return this.createEl("span", options); },
    empty(this: HTMLElement) { this.replaceChildren(); },
    addClass(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); },
    setAttr(this: HTMLElement, key: string, value: string) { this.setAttribute(key, value); },
  };
  for (const [key, value] of Object.entries(methods)) Object.defineProperty(HTMLElement.prototype, key, { value, configurable: true });
}

const task = (id: string, completed = false): QuadrantTask => ({ id, text: `Task ${id}`, quadrant: "q1", completed, createdAt: 100, completedAt: completed ? 200 : null });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

import { vaultHarness } from './quadrant-harness';
import { parseTasks } from '../src/quadrant-note';
async function harness(initial: unknown = null, content: string | null = '') {
  let stored = copy(initial);
  const h = vaultHarness(content);
  const create = async () => {
    const plugin = new QiaomuHomePlugin(h.app as never, { id: "qiaomu-home", name: "Qiaomu Home", version: "0.9.1" } as never);
    plugin.loadData = vi.fn(async () => copy(stored));
    plugin.saveData = vi.fn(async data => { stored = copy(data); });
    await plugin.onload();
    for (const page of plugin.settings.pages) page.moduleOptions.quadrant = { path: 'Tasks.md' };
    return plugin;
  };
  const plugin = await create();
  return { ...h, plugin, restart: create, stored: () => copy(stored) as ReturnType<typeof normalizeSettings> };
}
async function render(plugin: QiaomuHomePlugin): Promise<HTMLElement> {
  const parent = document.createElement('section'); document.body.append(parent);
  renderProductivity(parent, plugin, 'quadrant', 'home', () => {});
  await vi.waitFor(() => expect(parent.textContent).not.toMatch(/Loading…|正在读取/));
  return parent;
}
function submit(parent: HTMLElement, text: string, quadrant = 'q1') {
  const input = parent.querySelector<HTMLInputElement>('input[type="text"]')!; input.value = text;
  const select = parent.querySelector<HTMLSelectElement>('select')!; select.value = quadrant; select.dispatchEvent(new Event('change'));
  parent.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
const done = async (body: HTMLElement) => { await vi.waitFor(() => expect(body.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)); };
beforeEach(() => { installDomHelpers(); setLanguage('en'); vi.mocked(Notice).mockClear(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('quadrant card integration', () => {
  it('renders the actual dispatcher, adds a task, changes ordinary settings and survives restart', async () => {
    const h = await harness(), body = await render(h.plugin);
    expect(body.querySelectorAll('.qh-q-cell')).toHaveLength(4);
    submit(body, 'Ship milestone', 'q2'); await done(body);
    h.plugin.settings.customHeadline = 'My desk'; h.plugin.settings.openOnStartup = false;
    await h.plugin.saveSettings();
    const restarted = await h.restart();
    expect(restarted.settings.customHeadline).toBe('My desk');
    expect(restarted.settings.openOnStartup).toBe(false);
    expect((await render(restarted)).querySelector('.qh-q-cell-q2')?.textContent).toContain('Ship milestone');
  });
  it('reports read failure with retry and never offers an empty writable form', async () => {
    const h = await harness(); h.vault.read.mockRejectedValueOnce(Error('read denied'));
    const body = await render(h.plugin);
    expect(body.querySelector('form')).toBeNull();
    expect(h.vault.process).not.toHaveBeenCalled();
    body.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(body.querySelector('form')).not.toBeNull());
  });
  it('preserves input and persisted state on failure; repeated submit and retry add only once', async () => {
    const h = await harness(), body = await render(h.plugin);
    h.vault.process.mockRejectedValueOnce(Error('disk full'));
    submit(body, 'Keep draft'); submit(body, 'Keep draft'); await done(body);
    expect(Notice).toHaveBeenCalled(); expect(h.content()).toBe('');
    expect(body.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('Keep draft');
    submit(body, 'Keep draft'); await done(body);
    expect(parseTasks(h.content()!).map(t => t.text)).toEqual(['Keep draft']);
    expect(body.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('');
  });
  it('completes, cancels history, restores and deletes across restarts', async () => {
    const h = await harness(null, '- [ ] One #q1\n'); let body = await render(h.plugin);
    body.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await done(body);
    expect(parseTasks(h.content()!)[0].completed).toBe(true);
    body.querySelector<HTMLButtonElement>('.qh-q-footer-btn')!.click();
    document.querySelector('.modal')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(h.vault.process).toHaveBeenCalledTimes(1);
    body = await render(await h.restart());
    body.querySelector<HTMLButtonElement>('.qh-q-footer-btn')!.click();
    document.querySelector<HTMLButtonElement>('.modal button')!.click();
    await vi.waitFor(() => expect(document.querySelector('.modal')).toBeNull());
    expect(parseTasks(h.content()!)[0].completed).toBe(false);
    body.querySelector<HTMLButtonElement>('.qh-q-del-btn')!.click(); await done(body);
    expect((await render(await h.restart())).querySelectorAll('.qh-q-item')).toHaveLength(0);
  });
  it('keeps tasks/checkbox/history intact when completion, deletion and restoration fail', async () => {
    const initial = '- [ ] Open #q1\n- [x] Done #q2\n';
    const h = await harness(null, initial), body = await render(h.plugin);
    h.vault.process.mockRejectedValueOnce(Error('fail'));
    const box = body.querySelector<HTMLInputElement>('input[type="checkbox"]')!; box.click(); await done(body);
    expect(box.checked).toBe(false);
    h.vault.process.mockRejectedValueOnce(Error('fail'));
    body.querySelector<HTMLButtonElement>('.qh-q-del-btn')!.click(); await done(body);
    body.querySelector<HTMLButtonElement>('.qh-q-footer-btn')!.click();
    h.vault.process.mockRejectedValueOnce(Error('fail'));
    const restore = document.querySelector<HTMLButtonElement>('.modal button')!; restore.click();
    await vi.waitFor(() => expect(restore.disabled).toBe(false));
    expect(document.querySelector('.modal')).not.toBeNull(); expect(h.content()).toBe(initial);
    restore.click(); await vi.waitFor(() => expect(document.querySelector('.modal')).toBeNull());
  });
  it('does not write blank/canceled drafts or IME candidate confirmation', async () => {
    const h = await harness(), body = await render(h.plugin); submit(body, '  ');
    body.querySelector('input')!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    submit(body, '候选词'); body.remove(); await Promise.resolve();
    expect(h.vault.process).not.toHaveBeenCalled(); expect(h.content()).toBe('');
  });
  it('persists once if a card closes while a repeated submit is pending', async () => {
    const h = await harness(), body = await render(h.plugin), process = h.vault.process.getMockImplementation()!;
    let release!: () => void;
    h.vault.process.mockImplementationOnce(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return process(...args); });
    submit(body, 'Once'); submit(body, 'Once');
    await vi.waitFor(() => expect(release).toBeDefined()); body.remove(); release();
    await vi.waitFor(() => expect(parseTasks(h.content()!)).toHaveLength(1));
    expect((await render(await h.restart())).textContent).toContain('Once');
  });
  it('keeps concurrent cards and different vaults independent without document click listeners', async () => {
    const a = await harness(), b = await harness(); const listener = vi.spyOn(document, 'addEventListener');
    const first = await render(a.plugin), second = await render(a.plugin), other = await render(b.plugin);
    submit(first, 'A'); submit(second, 'B'); await done(first); await done(second);
    expect(parseTasks(a.content()!).map(t => t.text)).toEqual(['A', 'B']); expect(b.content()).toBe('');
    expect(other.querySelectorAll('.qh-q-item')).toHaveLength(0);
    expect(listener.mock.calls.filter(([type]) => type === 'click')).toHaveLength(0);
  });
  it('ships responsive styles for the rendered grid', () => {
    expect(readFileSync('styles.css', 'utf8')).toContain('@container (max-width: 270px)');
  });
});

describe('durable legacy migration', () => {
  it('keeps old tasks across ordinary settings saves, with no automatic note writes', async () => {
    const h = await harness({ quadrant: { tasks: [task('old')] } });
    const body = await render(h.plugin); expect(body.querySelector('.qh-q-migrate')).not.toBeNull();
    h.plugin.settings.customHeadline = 'Changed'; await h.plugin.saveSettings();
    expect((await h.restart()).settings.quadrant.tasks).toEqual([task('old')]);
    expect(h.vault.process).not.toHaveBeenCalled();
  });
  it('retains the legacy backup on reservation and note failures, then retries', async () => {
    const h = await harness({ quadrant: { tasks: [task('old')] } });
    vi.mocked(h.plugin.saveData).mockRejectedValueOnce(Error('settings disk full'));
    await expect(h.plugin.migrateQuadrantTasks('Tasks.md')).rejects.toThrow();
    expect(h.vault.process).not.toHaveBeenCalled();
    h.vault.process.mockRejectedValueOnce(Error('note disk full'));
    await expect(h.plugin.migrateQuadrantTasks('Tasks.md')).rejects.toThrow();
    expect((await h.restart()).settings.quadrant.tasks).toEqual([task('old')]);
    await h.plugin.migrateQuadrantTasks('Tasks.md');
    expect((await h.restart()).settings.quadrant.tasks).toEqual([]);
    expect(parseTasks(h.content()!).map(t => t.text)).toEqual(['Task old']);
  });
  it('retries safely when the note reached disk but its completion was interrupted', async () => {
    const h = await harness({ quadrant: { tasks: [task('old')] } });
    const process = h.vault.process.getMockImplementation()!;
    h.vault.process.mockImplementationOnce(async (...args) => { await process(...args); throw Error('interrupted'); });
    await expect(h.plugin.migrateQuadrantTasks('Tasks.md')).rejects.toThrow('interrupted');
    const restarted = await h.restart(); expect(restarted.settings.quadrant.tasks).toHaveLength(1);
    await restarted.migrateQuadrantTasks('Tasks.md');
    expect(parseTasks(h.content()!)).toHaveLength(1); expect((await h.restart()).settings.quadrant.tasks).toEqual([]);
  });
  it('survives cleanup failure + restart without duplicate import or changing the original text', async () => {
    const original = '---\ntitle: Keep\n---\nMy prose\n';
    const h = await harness({ quadrant: { tasks: [task('old'), task('done', true)] } }, original);
    const save = vi.mocked(h.plugin.saveData).getMockImplementation()!;
    vi.mocked(h.plugin.saveData).mockImplementationOnce(save).mockRejectedValueOnce(Error('cleanup interrupted'));
    await expect(h.plugin.migrateQuadrantTasks('Tasks.md')).rejects.toThrow();
    const beforeRetry = h.content(); expect(beforeRetry!.startsWith(original)).toBe(true);
    const restarted = await h.restart();
    expect(restarted.settings.quadrant.tasks).toHaveLength(2);
    await expect(restarted.migrateQuadrantTasks('Other.md')).rejects.toThrow('Finish importing');
    await restarted.migrateQuadrantTasks('Tasks.md');
    expect(h.content()).toBe(beforeRetry); expect((await h.restart()).settings.quadrant.tasks).toEqual([]);
  });
  it('serializes migration with queued ordinary settings so stale snapshots cannot resurrect legacy tasks', async () => {
    const h = await harness({ quadrant: { tasks: [task('old')] } });
    const migrate = h.plugin.migrateQuadrantTasks('Tasks.md');
    h.plugin.settings.customHeadline = 'Latest'; const settings = h.plugin.saveSettings();
    await Promise.all([migrate, settings, h.plugin.migrateQuadrantTasks('Tasks.md')]);
    const restarted = await h.restart(); expect(restarted.settings.quadrant.tasks).toEqual([]);
    expect(restarted.settings.customHeadline).toBe('Latest'); expect(parseTasks(h.content()!)).toHaveLength(1);
  });
  it('reloads both note and ordinary settings from isolated real disk files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qh-quadrant-')), file = join(directory, 'data.json'), note = join(directory, 'Tasks.md');
    try {
      const h = await harness({ quadrant: { tasks: [task('old')] } }, 'Body\n');
      await writeFile(note, 'Body\n');
      h.plugin.saveData = vi.fn(async data => { await writeFile(file, JSON.stringify(data)); });
      h.vault.read.mockImplementation(async () => readFile(note, 'utf8'));
      h.vault.process.mockImplementation(async (_, transform) => { const next = transform(await readFile(note, 'utf8')); await writeFile(note, next); return next; });
      await h.plugin.migrateQuadrantTasks('Tasks.md');
      const body = await render(h.plugin); submit(body, 'After migration', 'q3'); await done(body);
      h.plugin.settings.customHeadline = 'Disk settings'; await h.plugin.saveSettings(); h.plugin.onunload();
      const restarted = await harness(JSON.parse(await readFile(file, 'utf8')), await readFile(note, 'utf8'));
      expect(restarted.plugin.settings.customHeadline).toBe('Disk settings'); expect(restarted.plugin.settings.quadrant.tasks).toEqual([]);
      expect(parseTasks(restarted.content()!).map(t => t.text)).toEqual(['Task old', 'After migration']);
      expect(restarted.content()).toMatch(/^Body\n/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
