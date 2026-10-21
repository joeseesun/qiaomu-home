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
      constructor(public app: unknown) {}
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

async function harness(initial: unknown = null) {
  let stored = copy(initial);
  const app = { workspace: { on: vi.fn(), onLayoutReady: vi.fn(), getLeavesOfType: () => [] }, vault: { on: vi.fn() } };
  const create = async () => {
    const plugin = new QiaomuHomePlugin(app as never, {} as never);
    plugin.loadData = vi.fn(async () => copy(stored));
    plugin.saveData = vi.fn(async data => { stored = copy(data); });
    await plugin.onload();
    return plugin;
  };
  const plugin = await create();
  return { plugin, restart: create, stored: () => copy(stored) as ReturnType<typeof normalizeSettings> };
}
function render(plugin: QiaomuHomePlugin): HTMLElement {
  const parent = document.createElement("section"); document.body.append(parent);
  renderProductivity(parent, plugin, "quadrant", "home", () => {});
  return parent;
}
function submit(parent: HTMLElement, text: string, quadrant = "q1") {
  const input = parent.querySelector<HTMLInputElement>('input[type="text"]')!;
  input.value = text;
  const select = parent.querySelector<HTMLSelectElement>("select");
  if (select) { select.value = quadrant; select.dispatchEvent(new Event("change")); }
  parent.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function saved(plugin: QiaomuHomePlugin, count = 1) {
  await vi.waitFor(() => expect(plugin.saveData).toHaveBeenCalledTimes(count));
  await Promise.resolve(); await Promise.resolve();
}

beforeEach(() => { installDomHelpers(); setLanguage("en"); vi.mocked(Notice).mockClear(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("quadrant card integration", () => {
  it("renders all four quadrants through the production dispatcher", async () => {
    const { plugin } = await harness();
    const parent = render(plugin);
    expect(parent.querySelectorAll(".qh-q-cell")).toHaveLength(4);
    expect(parent.querySelector('form input[type="text"]')).not.toBeNull();
    expect(parent.querySelectorAll("select option")).toHaveLength(4);
  });

  it("adds a task, changes ordinary settings, and restores both after restart", async () => {
    const h = await harness();
    const parent = render(h.plugin);
    submit(parent, "  Ship the milestone  ", "q2"); await saved(h.plugin);
    expect(h.stored().quadrant.tasks[0]).toMatchObject({ text: "Ship the milestone", quadrant: "q2", completed: false });
    expect(parent.querySelector(".qh-q-cell-q2")?.textContent).toContain("Ship the milestone");
    h.plugin.settings.customHeadline = "My desk";
    h.plugin.settings.openOnStartup = false;
    await h.plugin.saveSettings();
    const restarted = await h.restart();
    expect(restarted.settings.customHeadline).toBe("My desk");
    expect(restarted.settings.openOnStartup).toBe(false);
    expect(restarted.settings.quadrant.tasks).toEqual(h.stored().quadrant.tasks);
    expect(render(restarted).textContent).toContain("Ship the milestone");
  });

  it("preserves legacy tasks when saving settings and restarting", async () => {
    const tasks = [task("open"), task("done", true)];
    const h = await harness({ quadrant: { tasks } });
    h.plugin.settings.customHeadline = "Changed";
    await h.plugin.saveSettings();
    expect(h.stored().quadrant.tasks).toEqual(tasks);
    expect((await h.restart()).settings.quadrant.tasks).toEqual(tasks);
  });

  it("completes, cancels history without changes, restores and deletes across restarts", async () => {
    const h = await harness({ quadrant: { tasks: [task("one")] } });
    const parent = render(h.plugin);
    const checkbox = parent.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true; checkbox.dispatchEvent(new Event("change")); await saved(h.plugin);
    expect(h.stored().quadrant.tasks[0].completedAt).toBeGreaterThan(200);
    parent.querySelector<HTMLButtonElement>(".qh-q-footer-btn")!.click();
    // Closing the history without Restore must not mutate storage.
    document.querySelector(".modal")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".modal")).toBeNull();
    expect(h.plugin.saveData).toHaveBeenCalledTimes(1);
    const restarted = await h.restart();
    const next = render(restarted);
    next.querySelector<HTMLButtonElement>(".qh-q-footer-btn")!.click();
    document.querySelector<HTMLButtonElement>(".modal button")!.click(); await saved(restarted);
    expect(h.stored().quadrant.tasks[0]).toMatchObject({ completed: false, completedAt: null });
    next.querySelector<HTMLButtonElement>(".qh-q-del-btn")!.click(); await saved(restarted, 2);
    expect((await h.restart()).settings.quadrant.tasks).toEqual([]);
  });

  it("expands hidden tasks and can delete the third task", async () => {
    const h = await harness({ quadrant: { tasks: [task("one"), task("two"), task("three")] } });
    const parent = render(h.plugin);
    expect(parent.querySelectorAll(".qh-q-item")).toHaveLength(2);
    parent.querySelector<HTMLInputElement>('input[type="text"]')!.value = "Unsubmitted draft";
    parent.querySelector<HTMLButtonElement>(".qh-q-more")!.click();
    expect(parent.querySelectorAll(".qh-q-item")).toHaveLength(3);
    expect(parent.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe("Unsubmitted draft");
    parent.querySelectorAll<HTMLButtonElement>(".qh-q-del-btn")[2].click(); await saved(h.plugin);
    expect(h.stored().quadrant.tasks.map(t => t.id)).toEqual(["one", "two"]);
  });

  it("does not save blank drafts, canceled drafts or IME candidate confirmation", async () => {
    const h = await harness(); const parent = render(h.plugin);
    submit(parent, "   ");
    const input = parent.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    submit(parent, "候选词");
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    parent.remove();
    await Promise.resolve();
    expect(h.plugin.saveData).not.toHaveBeenCalled();
    expect((await h.restart()).settings.quadrant.tasks).toEqual([]);
  });

  it("reports a failed write, keeps the draft, and retries without duplicate submission", async () => {
    const h = await harness(); const parent = render(h.plugin);
    vi.mocked(h.plugin.saveData).mockRejectedValueOnce(new Error("disk full"));
    submit(parent, "Keep this draft"); submit(parent, "Keep this draft");
    await vi.waitFor(() => expect(Notice).toHaveBeenCalled());
    expect(h.plugin.settings.quadrant.tasks).toEqual([]);
    expect(parent.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe("Keep this draft");
    submit(parent, "Keep this draft"); await saved(h.plugin, 2);
    expect((await h.restart()).settings.quadrant.tasks.map(t => t.text)).toEqual(["Keep this draft"]);
  });

  it("saves once on repeated submit even if the card closes during the pending write", async () => {
    const h = await harness(); const parent = render(h.plugin);
    const persist = vi.mocked(h.plugin.saveData).getMockImplementation()!;
    let release!: () => void;
    vi.mocked(h.plugin.saveData).mockImplementationOnce(async data => {
      await new Promise<void>(resolve => { release = resolve; }); await persist(data);
    });
    submit(parent, "One task"); submit(parent, "One task");
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(h.plugin.saveData).toHaveBeenCalledTimes(1);
    parent.remove(); release();
    await vi.waitFor(() => expect(h.plugin.settings.quadrant.tasks).toHaveLength(1));
    expect((await h.restart()).settings.quadrant.tasks.map(t => t.text)).toEqual(["One task"]);
  });

  it("keeps persisted state when completion, deletion or restoration fails", async () => {
    const h = await harness({ quadrant: { tasks: [task("open"), task("done", true)] } });
    const parent = render(h.plugin);
    vi.mocked(h.plugin.saveData).mockRejectedValueOnce(new Error("disk full"));
    const checkbox = parent.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(Notice).toHaveBeenCalledTimes(1));
    expect(checkbox.checked).toBe(false);
    vi.mocked(h.plugin.saveData).mockRejectedValueOnce(new Error("disk full"));
    parent.querySelector<HTMLButtonElement>(".qh-q-del-btn")!.click();
    await vi.waitFor(() => expect(Notice).toHaveBeenCalledTimes(2));
    parent.querySelector<HTMLButtonElement>(".qh-q-footer-btn")!.click();
    vi.mocked(h.plugin.saveData).mockRejectedValueOnce(new Error("disk full"));
    document.querySelector<HTMLButtonElement>(".modal button")!.click();
    await vi.waitFor(() => expect(Notice).toHaveBeenCalledTimes(3));
    expect(document.querySelector(".modal")).not.toBeNull();
    expect((await h.restart()).settings.quadrant.tasks).toEqual([task("open"), task("done", true)]);
  });

  it("keeps cards and vaults independent without accumulating document click handlers", async () => {
    const a = await harness({ quadrant: { tasks: [task("a")] } }), b = await harness();
    const listener = vi.spyOn(document, "addEventListener");
    const first = render(a.plugin); const second = render(a.plugin); const other = render(b.plugin);
    submit(first, "From first card"); submit(second, "From second card");
    await saved(a.plugin, 2);
    expect(a.stored().quadrant.tasks.map(t => t.text)).toEqual(["From second card", "From first card", "Task a"]);
    expect(other.querySelectorAll(".qh-q-item")).toHaveLength(0);
    expect(b.plugin.settings.quadrant.tasks).toEqual([]);
    expect(listener.mock.calls.filter(([type]) => type === "click")).toHaveLength(0);
  });

  it("ships a responsive grid and styles for the actual rendered classes", () => {
    const css = readFileSync("styles.css", "utf8");
    expect(css).toMatch(/\.qh-quadrant \.qh-q-grid\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toContain("@container (max-width: 270px)");
  });
});

describe("shared persistence queue", () => {
  it("reloads an added task and ordinary settings from a real JSON file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qh-quadrant-"));
    const file = join(directory, "data.json");
    try {
      const h = await harness();
      h.plugin.saveData = vi.fn(async data => { await writeFile(file, JSON.stringify(data)); });
      submit(render(h.plugin), "Survives disk reload", "q3");
      await vi.waitFor(() => expect(h.plugin.settings.quadrant.tasks).toHaveLength(1));
      h.plugin.settings.customHeadline = "Disk settings";
      await h.plugin.saveSettings();
      h.plugin.onunload();
      const restarted = await harness(JSON.parse(await readFile(file, "utf8")));
      expect(restarted.plugin.settings.customHeadline).toBe("Disk settings");
      expect(restarted.plugin.settings.quadrant.tasks[0]).toMatchObject({ text: "Survives disk reload", quadrant: "q3" });
      expect(render(restarted.plugin).textContent).toContain("Survives disk reload");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("serializes settings before and after concurrent task edits without stale overwrite", async () => {
    const h = await harness();
    const write = vi.mocked(h.plugin.saveData).getMockImplementation()!;
    let release!: () => void;
    vi.mocked(h.plugin.saveData).mockImplementationOnce(async data => { await new Promise<void>(resolve => { release = resolve; }); await write(data); });
    h.plugin.settings.customHeadline = "First";
    const first = h.plugin.saveSettings({ rerender: false });
    await vi.waitFor(() => expect(release).toBeDefined());
    const addA = h.plugin.updateQuadrantTasks(tasks => [task("a"), ...tasks]);
    h.plugin.settings.customHeadline = "Latest";
    const settings = h.plugin.saveSettings({ rerender: false });
    const addB = h.plugin.updateQuadrantTasks(tasks => [task("b"), ...tasks]);
    const stale = h.plugin.saveSettings({ rerender: false });
    release(); await Promise.all([first, addA, settings, addB, stale]);
    const restarted = await h.restart();
    expect(restarted.settings.quadrant.tasks.map(t => t.id)).toEqual(["b", "a"]);
    expect(restarted.settings.customHeadline).toBe("Latest");
  });

  it("does not publish an interrupted task write and recovers its queue after failure", async () => {
    const h = await harness({ quadrant: { tasks: [task("old")] } });
    let fail!: (error: Error) => void;
    vi.mocked(h.plugin.saveData).mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    const write = h.plugin.updateQuadrantTasks(tasks => [task("new"), ...tasks]);
    const rejection = expect(write).rejects.toThrow("interrupted");
    await vi.waitFor(() => expect(fail).toBeDefined());
    expect((await h.restart()).settings.quadrant.tasks.map(t => t.id)).toEqual(["old"]);
    h.plugin.settings.customHeadline = "After interruption";
    const next = h.plugin.saveSettings();
    fail(new Error("interrupted")); await rejection; await next;
    expect((await h.restart()).settings.quadrant.tasks.map(t => t.id)).toEqual(["old"]);
    await h.plugin.updateQuadrantTasks(tasks => [task("retry"), ...tasks]);
    expect((await h.restart()).settings.quadrant.tasks.map(t => t.id)).toEqual(["retry", "old"]);
  });

  it("does not resurrect a deleted task from a stale completion callback", async () => {
    const h = await harness({ quadrant: { tasks: [task("one"), task("two")] } });
    await Promise.all([
      h.plugin.updateQuadrantTasks(tasks => tasks.filter(t => t.id !== "one")),
      h.plugin.updateQuadrantTasks(tasks => tasks.map(t => t.id === "one" ? { ...t, completed: true, completedAt: 300 } : t)),
    ]);
    expect((await h.restart()).settings.quadrant.tasks.map(t => t.id)).toEqual(["two"]);
  });

  it("normalizes malformed data without dropping other valid tasks or leaking references", () => {
    const legacy = { quadrant: { tasks: [null, {}, task("one"), task("one"), { ...task("bad"), quadrant: "q5" }, { ...task("array"), quadrant: ["q1"] }, { ...task("done", true), completedAt: null }] } };
    const a = normalizeSettings(legacy), b = normalizeSettings(null);
    expect(a.quadrant.tasks.map(t => t.id)).toEqual(["one", "done"]);
    expect(a.quadrant.tasks[1].completedAt).toBe(100);
    a.quadrant.tasks[0].text = "Changed";
    expect((legacy.quadrant.tasks[2] as QuadrantTask).text).toBe("Task one");
    expect(b.quadrant.tasks).toEqual([]);
  });
});
