import { Modal, setIcon, Notice, TFile } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { L } from "./i18n";

type Quadrant = "q1" | "q2" | "q3" | "q4";

interface Task {
  id: string;
  text: string;
  quadrant: Quadrant;
  completed: boolean;
  createdAt: number;
  completedAt: number | null;
  /** False for checkbox lines that were already in the note without a #q tag: saving keeps them tag-free. */
  tagged: boolean;
}

const QUADRANT_META: Record<Quadrant, { zh: string; en: string; icon: string; color: string }> = {
  q1: { zh: "重要紧急", en: "Urgent & Important", icon: "siren", color: "#e74c3c" },
  q2: { zh: "重要不紧急", en: "Important", icon: "target", color: "#3498db" },
  q3: { zh: "紧急不重要", en: "Urgent", icon: "alarm-clock", color: "#f39c12" },
  q4: { zh: "不重要不紧急", en: "Not urgent", icon: "circle", color: "#95a5a6" },
};

/** Expanded quadrants, remembered per note so saving a task (which re-renders the card) does not collapse them. */
const expandedByPath = new Map<string, Set<Quadrant>>();

/** One document listener closes every open quadrant dropdown: bound once per plugin, not once per render. */
const dismissBound = new WeakSet<QiaomuHomePlugin>();
function bindDropdownDismiss(plugin: QiaomuHomePlugin): void {
  if (dismissBound.has(plugin)) return;
  dismissBound.add(plugin);
  plugin.registerDomEvent(document, "click", () => {
    document.querySelectorAll<HTMLElement>(".qh-q-dropdown").forEach(dropdown => dropdown.removeClass("is-open"));
  });
}

function newId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** `2026-10-21` in the local time zone; toISOString would report the previous day before 08:00 at +08:00. */
function localDate(time: number): string {
  const date = new Date(time);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Reads the checkbox lines of the note. Lines without a #q tag are kept as they are (they stay untagged when saved)
 * instead of being claimed as quadrant tasks.
 */
export function parseTasks(content: string): Task[] {
  const tasks: Task[] = [];

  for (const line of content.split("\n")) {
    const match = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (!match) continue;

    const completed = match[1].toLowerCase() === "x";
    let text = match[2];

    // 提取象限标签 #q1 #q2 #q3 #q4
    const quadrantMatch = /#q([1-4])\b/.exec(text);
    const quadrant = (quadrantMatch ? `q${quadrantMatch[1]}` : "q1") as Quadrant;
    text = text.replace(/#q[1-4]\b/g, "").trim();

    // 提取完成日期 ✅ 2024-01-15
    const completedAtMatch = /✅\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    const completedAt = completedAtMatch ? new Date(`${completedAtMatch[1]}T00:00:00`).getTime() : null;
    text = text.replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "").trim();

    tasks.push({
      id: newId(),
      text,
      quadrant,
      completed,
      createdAt: Date.now(),
      completedAt,
      tagged: quadrantMatch !== null,
    });
  }

  return tasks;
}

/** Writes the note back: tagged tasks carry their quadrant, untagged ones are left without a tag. */
export function serializeTasks(tasks: Task[]): string {
  const lines: string[] = ["# 任务四象限", ""];
  const row = (task: Task): string => {
    const tag = task.tagged ? ` #${task.quadrant}` : "";
    if (!task.completed) return `- [ ] ${task.text}${tag}`;
    return `- [x] ${task.text}${tag} ✅ ${localDate(task.completedAt ?? Date.now())}`;
  };
  const section = (title: string, empty: string, rows: Task[]): void => {
    lines.push(`## ${title}`, "");
    if (rows.length === 0) lines.push(empty, "");
    else { rows.forEach(task => lines.push(row(task))); lines.push(""); }
  };

  section("未完成", "*暂无任务*", tasks.filter(task => !task.completed));
  section("已完成", "*暂无已完成任务*", tasks.filter(task => task.completed));
  return lines.join("\n");
}

async function loadTasksFromFile(plugin: QiaomuHomePlugin, path: string): Promise<Task[]> {
  try {
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    return parseTasks(await plugin.app.vault.cachedRead(file));
  } catch {
    return [];
  }
}

async function saveTasksToFile(plugin: QiaomuHomePlugin, path: string, tasks: Task[]): Promise<boolean> {
  try {
    const file = plugin.app.vault.getAbstractFileByPath(path);
    const content = serializeTasks(tasks);
    if (file instanceof TFile) {
      await plugin.app.vault.modify(file, content);
    } else {
      await plugin.app.vault.create(path, content);
      new Notice(L("已创建四象限任务笔记", "Quadrant note created"));
    }
    return true;
  } catch {
    new Notice(L("保存失败", "Save failed"));
    return false;
  }
}

/** Moves tasks left in data.json by the first quadrant build into the note, once. */
async function migrateLegacyTasks(plugin: QiaomuHomePlugin, path: string, tasks: Task[]): Promise<Task[]> {
  const legacy = plugin.legacyQuadrantTasks;
  if (legacy.length === 0) return tasks;

  const known: Quadrant[] = ["q1", "q2", "q3", "q4"];
  const incoming: Task[] = legacy.map(task => ({
    id: newId(),
    text: task.text,
    quadrant: known.includes(task.quadrant as Quadrant) ? task.quadrant as Quadrant : "q1",
    completed: task.completed,
    createdAt: Date.now(),
    completedAt: task.completedAt,
    tagged: true,
  }));
  const merged = [...incoming, ...tasks];
  if (!await saveTasksToFile(plugin, path, merged)) return tasks;
  plugin.legacyQuadrantTasks = [];
  new Notice(L("已迁移 {v} 个旧四象限任务", "Migrated {v} old quadrant tasks", { v: incoming.length }));
  return merged;
}

class QuadrantHistoryModal extends Modal {
  constructor(private plugin: QiaomuHomePlugin, private tasks: Task[], private path: string, private refresh: () => void) {
    super(plugin.app);
    this.modalEl.addClass("qh-ui");
  }

  async onOpen(): Promise<void> {
    this.setTitle(L("已完成任务", "Completed tasks"));
    const { contentEl } = this;
    contentEl.empty();

    const completed = this.tasks.filter(t => t.completed);
    if (completed.length === 0) {
      contentEl.createDiv({ cls: "qh-empty", text: L("暂无已完成任务", "No completed tasks") });
      return;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekStart = today - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000;

    const groups: [string, Task[]][] = [
      [L("今天", "Today"), []],
      [L("昨天", "Yesterday"), []],
      [L("本周", "This week"), []],
      [L("更早", "Earlier"), []],
    ];

    completed.forEach(t => {
      if (!t.completedAt) return;
      if (t.completedAt >= today) groups[0][1].push(t);
      else if (t.completedAt >= yesterday) groups[1][1].push(t);
      else if (t.completedAt >= weekStart) groups[2][1].push(t);
      else groups[3][1].push(t);
    });

    groups.forEach(([label, gTasks]) => {
      if (gTasks.length === 0) return;
      contentEl.createEl("h3", { cls: "qh-history-group-title", text: `${label} (${gTasks.length})` });
      gTasks.forEach(task => {
        const row = contentEl.createDiv({ cls: "qh-history-row" });
        row.createSpan({ cls: "qh-history-text", text: task.text });
        const restoreBtn = row.createEl("button", { cls: "qh-icon-button", attr: { "aria-label": L("恢复", "Restore") } });
        setIcon(restoreBtn, "rotate-ccw");
        restoreBtn.onclick = () => { void (async () => {
          task.completed = false;
          task.completedAt = null;
          await saveTasksToFile(this.plugin, this.path, this.tasks);
          this.refresh();
          this.close();
        })(); };
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export function renderQuadrantBody(body: HTMLElement, plugin: QiaomuHomePlugin, path: string): void {
  bindDropdownDismiss(plugin);
  let currentQuad: Quadrant = "q1";
  let tasks: Task[] = [];
  /** Resolves once the note has been read (and legacy tasks migrated); adding waits for it so it cannot overwrite. */
  let ready: Promise<void> = Promise.resolve();
  const expanded = path ? expandedByPath.get(path) ?? new Set<Quadrant>() : new Set<Quadrant>();
  if (path) expandedByPath.set(path, expanded);

  function renderAll(): void {
    // 卡片 body 只放这个模块，整体清空即可；设置入口统一走卡片右上角的 ⋯ 菜单。
    body.empty();

    // 没有配置路径时，提示去 ⋯ 菜单里选笔记
    if (!path) {
      body.createDiv({ cls: "qh-card-empty", text: L("点击卡片右上角 ⋯ → 组件设置，选择保存任务的笔记", "Click ⋯ → Card settings to choose a note") });
      return;
    }
    buildForm();
    renderGrid();
  }

  function buildForm(): void {
    const form = body.createEl("form", { cls: "qh-q-add-form" });
    const input = form.createEl("input", {
      attr: { type: "text", placeholder: L("添加任务…", "Add task…") },
    });
    // 自定义下拉组件
    const selectWrapper = form.createDiv({ cls: "qh-q-select-wrapper" });
    const selectBtn = selectWrapper.createEl("button", { cls: "qh-q-select-btn", type: "button" });
    selectBtn.textContent = L(QUADRANT_META[currentQuad].zh, QUADRANT_META[currentQuad].en);
    const dropdown = selectWrapper.createDiv({ cls: "qh-q-dropdown" });
    (Object.keys(QUADRANT_META) as Quadrant[]).forEach(q => {
      const item = dropdown.createDiv({ cls: "qh-q-dropdown-item" });
      item.textContent = L(QUADRANT_META[q].zh, QUADRANT_META[q].en);
      item.addEventListener("click", () => {
        currentQuad = q;
        selectBtn.textContent = L(QUADRANT_META[q].zh, QUADRANT_META[q].en);
        dropdown.removeClass("is-open");
      });
    });
    selectBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropdown.toggleClass("is-open", !dropdown.hasClass("is-open"));
    });

    const submit = form.createEl("button", { type: "submit", cls: "qh-q-add-btn", attr: { "aria-label": L("添加", "Add") } });
    setIcon(submit, "plus");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void addTask(input);
    });
  }

  async function addTask(input: HTMLInputElement): Promise<void> {
    const text = input.value.trim();
    if (!text) return;
    await ready;
    tasks.unshift({
      id: newId(),
      text,
      quadrant: currentQuad,
      completed: false,
      createdAt: Date.now(),
      completedAt: null,
      tagged: true,
    });
    await saveTasksToFile(plugin, path, tasks);
    input.value = "";
    renderAll();
  }

  async function toggleTask(task: Task, checked: boolean): Promise<void> {
    task.completed = checked;
    task.completedAt = checked ? Date.now() : null;
    await saveTasksToFile(plugin, path, tasks);
    renderAll();
  }

  async function deleteTask(task: Task): Promise<void> {
    tasks = tasks.filter(entry => entry.id !== task.id);
    await saveTasksToFile(plugin, path, tasks);
    renderAll();
  }

  function appendTask(list: HTMLElement, task: Task): void {
    const item = list.createDiv({ cls: "qh-q-item" });
    const checkbox = item.createEl("input", { attr: { type: "checkbox" } });
    checkbox.addEventListener("change", () => { void toggleTask(task, checkbox.checked); });
    item.createSpan({ cls: "qh-q-item-text", text: task.text });
    const delBtn = item.createEl("button", { cls: "qh-q-del-btn", attr: { "aria-label": L("删除", "Delete") } });
    setIcon(delBtn, "trash");
    delBtn.addEventListener("click", () => { void deleteTask(task); });
  }

  function renderGrid(): void {
    body.querySelectorAll(".qh-q-grid, .qh-q-footer").forEach(element => element.remove());
    const grid = body.createDiv({ cls: "qh-q-grid" });

    (["q1", "q2", "q3", "q4"] as Quadrant[]).forEach((q) => {
      const meta = QUADRANT_META[q];
      const open = tasks.filter(task => !task.completed && task.quadrant === q);
      const isOpen = expanded.has(q);

      const cell = grid.createDiv({ cls: `qh-q-cell qh-q-cell-${q}` });
      const qHead = cell.createDiv({ cls: "qh-q-head" });
      setIcon(qHead.createSpan({ cls: "qh-q-dot" }), meta.icon);
      qHead.createSpan({ cls: "qh-q-label", text: L(meta.zh, meta.en) });
      if (open.length > 0) qHead.createSpan({ cls: "qh-q-count", text: String(open.length) });

      const list = cell.createDiv({ cls: "qh-q-list" });
      (isOpen ? open : open.slice(0, 2)).forEach(task => appendTask(list, task));

      if (open.length === 0) {
        list.createDiv({ cls: "qh-q-empty", text: L("暂无", "—") });
      } else if (open.length > 2) {
        // A plain element, not a <button>: Obsidian's button rule (button:not(.clickable-icon)) outranks a single-class
        // card rule and would paint a filled pill here, while this should read as a quiet text link.
        const more = list.createDiv({
          cls: "qh-q-more",
          text: isOpen ? L("收起", "Show less") : L("再看 {v} 项", "Show {v} more", { v: open.length - 2 }),
        });
        more.setAttr("role", "button");
        more.setAttr("tabindex", "0");
        more.setAttr("aria-expanded", String(isOpen));
        const toggle = (): void => {
          if (isOpen) expanded.delete(q);
          else expanded.add(q);
          renderGrid();
        };
        more.addEventListener("click", toggle);
        more.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        });
      }
    });

    renderFooter();
  }

  function renderFooter(): void {
    const completedCount = tasks.filter(task => task.completed).length;
    if (completedCount === 0) return;
    const footer = body.createDiv({ cls: "qh-q-footer" });
    const viewBtn = footer.createEl("button", { cls: "qh-q-footer-btn", text: L(`已完成 ${completedCount} 项`, `${completedCount} done`) });
    viewBtn.onclick = () => new QuadrantHistoryModal(plugin, tasks, path, renderAll).open();
  }

  renderAll();
  if (path) {
    ready = loadTasksFromFile(plugin, path).then(async loaded => {
      tasks = await migrateLegacyTasks(plugin, path, loaded);
      renderAll();
    });
  }
}
