import { renderGauge } from "./gauge";
import { fillTemplate, templateFileName } from "./quick-tools";
import { cardAction, fieldRow } from "./card-ui";
import { renderHabitCard } from "./habits";
import { getAllTags, moment, Notice, TFile, setIcon } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { L, t } from "./i18n";
import { localDay, moduleOptions } from "./settings";
import { PRODUCTIVITY_MODULES, type ProductivityId } from "./productivity-catalog";
import { eligibleNote, focusRemaining, inFolder, taskProgress } from "./productivity-data";
import { dailyExcerpt } from "./home-native-modules";
import { dailyOptions, todayPath, ensureParent, ensureTodayNote } from "./today";
import { locateTodo, replaceTodo, taskDisplay } from "./todo-data";
import { editorFor, update } from "./todo-files";
import { completeWithUndo } from "./todo-ui";
import { todoTarget } from "./todo-carry";
import { completeTaskLine, daysBetween, isRecurring, rescheduleLine, taskBucket } from "./productivity-data";
import type { IndexedTask } from "./task-index";
import { FilePicker } from "./extra-ui";
import { bindOpen, openFromHome } from "./open";
import { readFocus } from "./daily-focus";
import { readTodos } from "./todo-data";
import { Modal, Setting } from "obsidian";


interface TasksApi { executeToggleTaskDoneCommand(line: string, path: string): string }
/** The Tasks plugin's public API: completes with ✅ date and creates the next copy of recurring tasks. */
function tasksApi(plugin: QiaomuHomePlugin): TasksApi | null {
  const api = (plugin.app as unknown as { plugins?: { plugins?: Record<string, { apiV1?: Partial<TasksApi> }> } }).plugins?.plugins?.["obsidian-tasks-plugin"]?.apiV1;
  return typeof api?.executeToggleTaskDoneCommand === "function" ? api as TasksApi : null;
}
/** Completed or moved tasks stay hidden until the note is saved and re-indexed. */
const handled = new Map<string, number>();
const taskKey = (task: IndexedTask) => `${task.path}\n${task.raw}`;
function forget(task: IndexedTask): void { handled.set(taskKey(task), Date.now()); }
function recentlyDone(task: IndexedTask): boolean {
  const at = handled.get(taskKey(task));
  if (at === undefined) return false;
  if (Date.now() - at < 10000) return true;
  handled.delete(taskKey(task)); return false;
}

class ConfirmModal extends Modal {
  constructor(app: QiaomuHomePlugin["app"], private title: string, private text: string, private action: string, private run: () => void) { super(app); this.modalEl.addClass("qh-ui"); }
  onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl("p", { text: this.text });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText(L("取消", "Cancel")).onClick(() => this.close()))
      .addButton(button => button.setButtonText(this.action).setCta().onClick(() => { this.close(); this.run(); }));
  }
  onClose(): void { this.contentEl.empty(); }
}
function openNotePaths(plugin: QiaomuHomePlugin): string[] {
  return plugin.app.workspace.getLeavesOfType("markdown").flatMap(leaf => {
    const path = (leaf.getViewState().state as { file?: unknown } | undefined)?.file;
    return typeof path === "string" && path.endsWith(".md") ? [path] : [];
  });
}
export function openSavedSearch(plugin: QiaomuHomePlugin, query: string): void {
  window.open(`obsidian://search?vault=${encodeURIComponent(plugin.app.vault.getName())}&query=${encodeURIComponent(query)}`);
}
export function renderProductivity(parent: HTMLElement, plugin: QiaomuHomePlugin, id: ProductivityId, pageId: string, configure: () => void): void {
  const config = PRODUCTIVITY_MODULES[id], options = moduleOptions(plugin.settings, id, pageId), app = plugin.app;
  const card = parent.createDiv({ cls: "qh-card" }); card.dataset.module = id;
  const head = card.createDiv({ cls: "qh-card-head" });
  setIcon(head.createSpan({ cls: "qh-card-icon" }), config.icon);
  head.createSpan({ cls: "qh-card-title", text: L(config.zh, config.en) });
  const body = card.createDiv({ cls: "qh-native-preview" });
  const message = (text: string) => body.createDiv({ cls: "qh-card-empty", text });
  const button = (parent: HTMLElement, text: string, run: () => void, icon?: string, primary = false) => cardAction(parent, text, run, icon, primary);
  const open = (file: TFile, line?: number, event?: MouseEvent | KeyboardEvent) => void openFromHome(plugin, card, file, event, line);
  const note = (file: TFile, text = file.basename, detail = file.path, line?: number) => {
    const row = body.createEl("button", { cls: "qh-workflow-row" });
    row.createSpan({ cls: "qh-workflow-title", text });
    row.createSpan({ cls: "qh-item-sub", text: detail });
    bindOpen(row, event => open(file, line, event)); return row;
  };
  const run = (action: () => Promise<void>) => {
    message(L("正在读取…", "Loading…"));
    void action().catch(() => { if (card.isConnected) { body.empty(); message(L("暂时无法读取，点击重试", "Could not load this card")); button(body, L("重试", "Retry"), () => { body.empty(); run(action); }, "refresh-cw"); } });
  };
  if (config.folder && options.folder) card.createDiv({ cls: "qh-native-scope", text: options.folder });
  const files = () => app.vault.getMarkdownFiles().filter(file => eligibleNote(file.path) && inFolder(file.path, options.folder));
  if (["due-today", "overdue", "project-next", "milestones"].includes(id)) {
    if (id === "project-next" && !options.folder) { message(L("先选择项目笔记所在文件夹", "Choose the folder containing project notes")); button(body, L("选择文件夹", "Choose folder"), configure, "settings-2", true); return; }
    run(async () => {
      const today = localDay();
      let tasks = (await plugin.taskIndex.read(options.folder)).filter(task => inFolder(task.path, options.folder) && !recentlyDone(task));
      const withOverdue = id === "due-today" && (options.includeOverdue ?? !moduleOptions(plugin.settings, "overdue", pageId).visible);
      // Tasks already listed on the Todo card of this page are not repeated here.
      const shownByTodo = (id === "due-today" || id === "overdue") && moduleOptions(plugin.settings, "todo", pageId).visible
        ? await todoTarget(plugin).catch(() => "") : "";
      if (shownByTodo) tasks = tasks.filter(task => task.path !== shownByTodo);
      const bucket = (task: IndexedTask) => taskBucket(task, today);
      if (id === "due-today") tasks = tasks.filter(task => bucket(task) === "today" || (withOverdue && bucket(task) === "overdue"));
      else if (id === "overdue") tasks = tasks.filter(task => bucket(task) === "overdue");
      else if (id === "milestones") tasks = tasks.filter(task => task.due !== null && task.due > today);
      else { const seen = new Set<string>(); tasks = tasks.filter(task => { if (seen.has(task.path)) return false; seen.add(task.path); return true; }); }
      const when = (task: IndexedTask) => task.due ?? task.scheduled ?? "";
      if (id !== "project-next") tasks.sort((a, b) => when(a).localeCompare(when(b)) || a.path.localeCompare(b.path));
      if (!card.isConnected) return;
      body.empty();
      if (!tasks.length) message(id === "due-today" ? L("今天没有到期任务", "Nothing due today") : id === "overdue" ? L("没有逾期任务", "No overdue tasks") : L("没有符合条件的任务", "No matching tasks"));
      for (const task of tasks.slice(0, options.limit)) {
        const file = app.vault.getAbstractFileByPath(task.path); if (!(file instanceof TFile)) continue;
        const late = bucket(task) === "overdue" ? daysBetween(when(task), today) : 0;
        const row = body.createDiv({ cls: "qh-workflow-task" });
        if (late) row.addClass("is-overdue");
        const checkboxLabel = row.createEl("label", { cls: "qh-task-check" });
        checkboxLabel.createSpan({ cls: "qh-sr-only", text: L("完成 {v}", "Complete {v}", { v: taskDisplay(task.text) }) });
        const checkbox = checkboxLabel.createEl("input", { type: "checkbox" });
        const date = late ? L("逾期 {late} 天", late > 1 ? "{late} days overdue" : "{late} day overdue", { late })
          : id === "milestones" ? task.due : task.due === today ? "" : task.scheduled === today ? L("计划今天", "Scheduled today") : when(task);
        const item = note(file, taskDisplay(task.text), [task.name, date].filter(Boolean).join(" · "), task.line); row.appendChild(item);
        if (late) {
          const move = row.createEl("button", { cls: "qh-icon-button qh-task-move" });
          setIcon(move, "calendar-check"); move.createSpan({ cls: "qh-sr-only", text: L("改到今天", "Move to today") });
          move.addEventListener("click", () => {
            move.disabled = true;
            void update(app, file, current => replaceTodo(current, task, rescheduleLine(current.split("\n")[locateTodo(current, task)].replace(/\r$/, ""), today)).text)
              .then(() => { forget(task); row.remove(); new Notice(L("已改到今天", "Moved to today")); })
              .catch(() => { move.disabled = false; new Notice(L("任务已变化，请刷新后再试", "Task changed. Refresh and try again.")); });
          });
        }
        checkbox.addEventListener("change", () => {
          checkbox.disabled = true;
          const api = tasksApi(plugin);
          void completeWithUndo(plugin, file, task, current => {
            const raw = current.split("\n")[locateTodo(current, task)].replace(/\r$/, "");
            const done = api ? api.executeToggleTaskDoneCommand(raw, task.path) : completeTaskLine(raw, today);
            return { text: replaceTodo(current, task, done).text, done };
          }).then(() => {
            forget(task); row.remove();
            if (!api && isRecurring(task.text)) new Notice(L("这是重复任务：启用 Tasks 插件后，勾选时才会自动生成下一次。", "Recurring task: turn on the Tasks plugin to create the next occurrence when completing."));
          }).catch(() => { checkbox.checked = false; checkbox.disabled = false; new Notice(L("任务已变化，请刷新后再试", "Task changed. Refresh and try again.")); });
        });
      }
    }); return;
  }
  if (id === "template-create") {
    if (!options.path) { message(L("选择一个 Markdown 模板开始", "Choose a Markdown template to begin")); button(body, L("选择模板", "Choose template"), configure, "settings-2", true); return; }
    const template = app.vault.getAbstractFileByPath(options.path);
    if (!(template instanceof TFile)) { message(L("模板已移动或不存在", "Template is missing")); button(body, L("重新选择模板", "Choose template"), configure, "settings-2", true); return; }
    body.createDiv({ cls: "qh-native-scope", text: L("模板：{basename}", "Template: {basename}", { basename: template.basename }) });
    const { input, submit: create } = fieldRow(body, { placeholder: L("新笔记名称", "New note name"), label: L("新笔记名称", "New note name"), icon: "plus", action: L("创建笔记", "Create note"), onSubmit: () => {
      create.disabled = true;
      void (async () => {
        const name = templateFileName(input.value);
        const folder = options.folder || plugin.settings.createFolder || app.fileManager.getNewFileParent("").path;
        if (folder !== "/" && (folder.startsWith("/") || folder.includes("\\") || folder.split("/").includes("..") || folder === app.vault.configDir || folder.startsWith(`${app.vault.configDir}/`))) throw new Error(L("请选择库内的普通笔记文件夹", "Choose a note folder inside the vault"));
        const path = `${folder && folder !== "/" ? `${folder}/` : ""}${name}`;
        if (app.vault.getAbstractFileByPath(path)) throw new Error(L("同名笔记已存在，请换个名称", "A note with this name already exists"));
        const source = await app.vault.read(template);
        const now = (moment as unknown as () => { format(pattern: string): string })();
        const content = fillTemplate(source, name.slice(0, -3), pattern => now.format(pattern));
        await ensureParent(app, path);
        const file = await app.vault.create(path, content);
        input.value = ""; await openFromHome(plugin, card, file);
      })().catch(error => new Notice(error instanceof Error ? error.message : L("创建失败", "Could not create note"))).finally(() => { create.disabled = false; });
    } });
    return;
  }
  if (id === "working-set") {
    const paths = options.paths ?? [];
    const page = () => plugin.settings.pages.find(entry => entry.id === pageId);
    const store = (next: string[]) => {
      const target = page(); if (!target) return;
      const previous = target.moduleOptions[id];
      target.moduleOptions[id] = { ...moduleOptions(plugin.settings, id, pageId), paths: next.slice(0, 20) };
      void plugin.saveSettings().catch(() => { if (previous) target.moduleOptions[id] = previous; else delete target.moduleOptions[id]; new Notice(t("layout.saveFailed")); });
    };
    const existing = paths.filter(path => app.vault.getAbstractFileByPath(path) instanceof TFile);
    if (!paths.length) message(L("保存当前打开的笔记，或逐篇添加，最多 20 篇", "Save the notes you have open, or add them one by one (up to 20)"));
    const shown = 8;
    const rows: HTMLElement[] = [];
    for (const [index, path] of paths.entries()) {
      const file = app.vault.getAbstractFileByPath(path);
      const row = body.createDiv({ cls: "qh-working-row" });
      row.hidden = index >= shown;
      rows.push(row);
      if (file instanceof TFile) row.appendChild(note(file, file.basename, file.parent && !file.parent.isRoot() ? file.parent.path : ""));
      else row.createDiv({ cls: "qh-card-empty", text: L("找不到：{path}", "Missing: {path}", { path }) });
      const remove = row.createEl("button", { cls: "qh-icon-button" });
      setIcon(remove, "x"); remove.createSpan({ cls: "qh-sr-only", text: L("从笔记组移除", "Remove from set") });
      remove.addEventListener("click", () => store(paths.filter(entry => entry !== path)));
    }
    if (paths.length > shown) {
      let expanded = false;
      const toggle = body.createEl("button", { cls: "qh-working-toggle", text: L("展开其余 {v} 篇", "Show {v} more", { v: paths.length - shown }), attr: { "aria-expanded": "false" } });
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        rows.forEach((row, index) => { row.hidden = !expanded && index >= shown; });
        toggle.setAttr("aria-expanded", String(expanded));
        toggle.setText(expanded ? L("收起", "Show less") : L("展开其余 {v} 篇", "Show {v} more", { v: paths.length - shown }));
      });
    }
    const actions = body.createDiv({ cls: "qh-workflow-actions" });
    if (existing.length) button(actions, L("打开这 {length} 篇", "Open {length} notes", { length: existing.length }), () => {
      const opened = new Set(openNotePaths(plugin));
      void (async () => {
        for (const path of existing) {
          if (opened.has(path)) continue;
          const file = app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) { await app.workspace.getLeaf("tab").openFile(file, { active: false }); opened.add(path); }
        }
      })().catch(() => new Notice(L("部分笔记未能打开", "Some notes could not be opened")));
    }, "panels-top-left", true);
    button(actions, L("添加笔记", "Add note"), () => new FilePicker(plugin, ["md"], file => {
      if (paths.includes(file.path)) return;
      if (paths.length >= 20) { new Notice(L("最多 20 篇", "Up to 20 notes")); return; }
      store([...paths, file.path]);
    }).open(), "plus");
    button(actions, L("保存当前打开的", "Save open notes"), () => {
      const captured = [...new Set(openNotePaths(plugin))].slice(0, 20);
      if (!captured.length) { new Notice(L("先打开几篇 Markdown 笔记", "Open some Markdown notes first")); return; }
      if (paths.length && paths.join("\n") !== captured.join("\n")) new ConfirmModal(app, L("替换笔记组？", "Replace this set?"),
        L("当前笔记组的 {length} 篇会被替换为正在打开的 {length2} 篇。", "The {length} saved notes will be replaced by the {length2} notes you have open.", { length: paths.length, length2: captured.length }),
        L("替换", "Replace"), () => store(captured)).open();
      else store(captured);
    }, "save"); return;
  }
  if (id === "habit-checkin") { renderHabitCard(body, card, plugin, pageId, configure); return; }
  if (id === "focus-timer") {
    // Timer state is repainted every second by paintFocus; saving never needs to rebuild the page.
    const save = (previous: typeof plugin.settings.focusSession) => void plugin.saveSettings({ rerender: false }).catch(() => { plugin.settings.focusSession = previous; new Notice(t("layout.saveFailed")); paintFocus(card, plugin); });
    const dial = body.createDiv({ cls: "qh-focus-dial" });
    const svg = dial.createSvg("svg", { attr: { viewBox: "0 0 120 120", "aria-hidden": "true" } });
    svg.createSvg("circle", { cls: "qh-focus-track", attr: { cx: "60", cy: "60", r: "52" } });
    for (let index = 0; index < 12; index++) {
      const angle = index * Math.PI / 6;
      svg.createSvg("line", { cls: "qh-gauge-tick", attr: { x1: String(60 + Math.sin(angle) * 43), y1: String(60 - Math.cos(angle) * 43), x2: String(60 + Math.sin(angle) * 46), y2: String(60 - Math.cos(angle) * 46) } });
    }
    svg.createSvg("circle", { cls: "qh-focus-arc", attr: { cx: "60", cy: "60", r: "52", "data-focus-arc": "true", transform: "rotate(-90 60 60)" } });
    const center = dial.createDiv({ cls: "qh-focus-center" });
    const clock = center.createDiv({ cls: "qh-focus-clock" }); clock.dataset.focusClock = "true";
    const status = center.createDiv({ cls: "qh-focus-status" }); status.dataset.focusStatus = "true";
    status.setAttr("aria-live", "polite");
    const label = body.createDiv({ cls: "qh-native-scope qh-focus-label" }); label.dataset.focusLabel = "true";
    const presets = body.createDiv({ cls: "qh-focus-presets" }); presets.dataset.focusPresets = "true";
    presets.setAttr("role", "group"); presets.setAttr("aria-label", L("专注时长", "Session length"));
    for (const minutes of [15, 25, 45, 60]) {
      const chip = presets.createEl("button", { cls: "qh-discovery-site", text: L("{minutes} 分", "{minutes}m", { minutes }) });
      chip.dataset.minutes = String(minutes);
      chip.addEventListener("click", () => {
        const previous = { ...plugin.settings.focusSession };
        if (previous.endAt) return;
        plugin.settings.focusSession = { ...previous, kind: "focus", durationMinutes: minutes, focusMinutes: minutes, remainingMs: minutes * 60000, endAt: 0 };
        paintFocus(card, plugin); save(previous);
      });
    }
    // What this session is for: today's focus or an open task. Loaded after render; the choice is kept on the session.
    const target = body.createEl("select", { cls: "dropdown qh-focus-target" }); target.dataset.focusTarget = "true";
    const targetName = body.createSpan({ cls: "qh-sr-only", text: L("专注于", "Focus on") });
    targetName.id = `qh-focus-target-${crypto.randomUUID()}`; target.setAttr("aria-labelledby", targetName.id);
    target.createEl("option", { value: "", text: L("专注于…（可选）", "Focus on… (optional)") });
    void (async () => {
      const labels: string[] = [];
      const focus = await readFocus(plugin).catch(() => null);
      for (const item of focus?.items ?? []) if (!item.done) labels.push(item.text);
      const path = await todoTarget(plugin).catch(() => "");
      const file = path ? app.vault.getAbstractFileByPath(path) : null;
      if (file instanceof TFile) for (const task of readTodos(editorFor(app, file)?.getValue() ?? await app.vault.cachedRead(file)).slice(0, 10)) labels.push(taskDisplay(task.text));
      const current = plugin.settings.focusSession.label;
      if (current && !labels.includes(current)) labels.unshift(current);
      if (!card.isConnected) return;
      for (const text of [...new Set(labels)]) target.createEl("option", { value: text, text: text.length > 40 ? `${text.slice(0, 40)}…` : text });
      target.value = current;
    })();
    target.addEventListener("change", () => {
      const previous = { ...plugin.settings.focusSession };
      plugin.settings.focusSession = { ...previous, label: target.value };
      paintFocus(card, plugin); save(previous);
    });
    const actions = body.createDiv({ cls: "qh-workflow-actions qh-focus-actions" });
    const toggle = actions.createEl("button", { cls: "qh-native-open is-primary qh-focus-toggle" });
    toggle.addEventListener("click", () => {
      const previous = { ...plugin.settings.focusSession };
      const remaining = focusRemaining(previous);
      // After a finished break, "again" starts a new focus session of the chosen length.
      const restart = remaining === 0 ? { kind: "focus" as const, durationMinutes: previous.focusMinutes } : {};
      const length = (remaining === 0 ? previous.focusMinutes : previous.durationMinutes) * 60000;
      plugin.settings.focusSession = { ...previous, ...restart, endAt: previous.endAt && remaining > 0 ? 0 : Date.now() + (remaining || length), remainingMs: remaining || length };
      paintFocus(card, plugin); save(previous);
    }); toggle.dataset.focusToggle = "true";
    const rest = button(actions, L("休息 5 分钟", "Break 5 min"), () => {
      const previous = { ...plugin.settings.focusSession };
      plugin.settings.focusSession = { ...previous, kind: "break", durationMinutes: 5, remainingMs: 5 * 60000, endAt: Date.now() + 5 * 60000 };
      paintFocus(card, plugin); save(previous);
    }, "coffee");
    rest.dataset.focusBreak = "true";
    const reset = button(actions, L("重置", "Reset"), () => {
      const previous = { ...plugin.settings.focusSession };
      plugin.settings.focusSession = { ...previous, kind: "focus", durationMinutes: previous.focusMinutes, endAt: 0, remainingMs: previous.focusMinutes * 60000 };
      paintFocus(card, plugin); save(previous);
    }, "rotate-ccw");
    reset.dataset.focusReset = "true";
    const today = body.createDiv({ cls: "qh-native-scope qh-focus-today" }); today.dataset.focusToday = "true";
    paintFocus(card, plugin); return;
  }
  if (id === "saved-search") {
    if (!options.query?.trim()) { message(L("保存常用搜索条件，下次一键打开", "Save a query to open it in one click")); button(body, L("设置查询", "Set query"), configure, "settings-2", true); }
    else { body.createDiv({ cls: "qh-native-line", text: options.query }); button(body, L("搜索笔记", "Search notes"), () => openSavedSearch(plugin, options.query!), "search", true); }
    return;
  }
  if (id === "daily-calendar") {
    run(async () => {
      const config = await dailyOptions(app); if (!card.isConnected) return;
      body.empty(); const strip = body.createDiv({ cls: "qh-calendar-strip" });
      for (let offset = -6; offset <= 0; offset++) {
        const date = new Date(); date.setDate(date.getDate() + offset);
        const name = (moment as unknown as (date: Date) => { format(pattern: string): string })(date).format(config.format || "YYYY-MM-DD");
        const path = `${config.folder ? `${config.folder.replace(/\/$/, "")}/` : ""}${name}.md`;
        const file = app.vault.getAbstractFileByPath(path);
        const label = strip.createEl("button", { cls: "qh-calendar-day", text: `${date.getMonth() + 1}/${date.getDate()}` });
        label.disabled = !(file instanceof TFile);
        if (offset === 0) label.setAttr("aria-current", "date");
        label.addEventListener("click", () => { if (file instanceof TFile) open(file); });
      }
      message(L("浅色日期尚无日记", "Dimmed dates have no daily note"));
    }); return;
  }
  if (["note-preview", "goal-progress", "daily-timeline"].includes(id)) {
    if (config.path && !options.path) { message(L("选择要展示的 Markdown 笔记", "Choose a Markdown note")); button(body, L("选择笔记", "Choose note"), configure, "settings-2", true); return; }
    run(async () => {
      const path = id === "daily-timeline" ? await todayPath(app) : options.path!;
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        if (!card.isConnected) return;
        body.empty();
        if (id === "daily-timeline") {
          message(L("今天还没有日记。写下「09:30 开会」这样带时间的行，就会出现在这里。", "No daily note yet. Lines like “09:30 meeting” will appear here."));
          button(body, L("创建今日日记", "Create today's note"), () => void ensureTodayNote(app).then(created => open(created)).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))), "plus", true);
        } else { message(L("选择的笔记已移动或删除", "The chosen note was moved or deleted")); button(body, L("重新选择", "Choose again"), configure, "settings-2", true); }
        return;
      }
      const content = editorFor(app, file)?.getValue() ?? await app.vault.cachedRead(file);
      if (!card.isConnected) return; body.empty();
      if (id === "goal-progress") {
        const progress = taskProgress(content);
        if (!progress.total) message(L("这篇笔记没有 Markdown 任务", "This note has no Markdown tasks"));
        else {
          const metric = body.createDiv({ cls: "qh-goal-gauge" });
          renderGauge(metric, progress.done / progress.total, L("目标完成进度", "Goal completion"));
          metric.createDiv({ cls: "qh-native-scope", text: L("完成 {done} / {length}", "{done} of {length} done", { done: progress.done, length: progress.total }) });
        }
      } else {
        const lines = id === "daily-timeline" ? dailyExcerpt(content, 10000).filter(line => /(?:^|\s)(?:[01]\d|2[0-3]):[0-5]\d(?:\s|$)/.test(line)).slice(-options.limit) : dailyExcerpt(content, options.limit);
        if (!lines.length) message(L("还没有可展示的内容", "No content to show yet"));
        for (const line of lines) body.createDiv({ cls: "qh-native-line", text: line });
      }
      button(body, L("打开笔记", "Open note"), () => open(file), "arrow-up-right");
    }); return;
  }
  if (id === "tag-cloud") {
    const counts = new Map<string, number>();
    for (const file of files()) for (const tag of new Set(getAllTags(app.metadataCache.getFileCache(file) ?? {}) ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, options.limit);
    if (!tags.length) message(L("当前范围没有标签", "No tags in this scope"));
    const list = body.createDiv({ cls: "qh-discovery-sites" });
    for (const [tag, count] of tags) {
      const chip = list.createEl("button", { cls: "qh-discovery-site" });
      chip.createSpan({ text: tag });
      chip.createSpan({ cls: "qh-chip-count", text: String(count) });
      chip.addEventListener("click", () => openSavedSearch(plugin, `tag:${tag}`));
    }
    return;
  }
  if (id === "broken-links") {
    let count = 0;
    for (const file of files()) {
      for (const [target, uses] of Object.entries(app.metadataCache.unresolvedLinks[file.path] ?? {})) {
        if (count++ < options.limit) note(file, target, `${file.basename} · ${uses}`);
      }
    }
    if (!count) message(L("当前范围没有待补全链接", "No unresolved links in this scope")); return;
  }
  if (id === "orphan-notes") {
    const connected = new Set<string>();
    for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) for (const target of Object.keys(targets)) if (source !== target) { connected.add(source); connected.add(target); }
    const orphans = files().filter(file => !connected.has(file.path)).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, options.limit);
    if (!orphans.length) message(L("当前范围的笔记都有连接", "All notes in this scope have links"));
    for (const file of orphans) note(file);
  }
}
export function paintFocus(root: HTMLElement, plugin: QiaomuHomePlugin): void {
  const session = plugin.settings.focusSession, remaining = focusRemaining(session);
  const total = session.durationMinutes * 60000;
  const seconds = Math.ceil(remaining / 1000), running = session.endAt > 0 && remaining > 0;
  const paused = !running && remaining > 0 && remaining < total;
  const idle = !running && !paused && remaining > 0;
  const onBreak = session.kind === "break";
  root.querySelectorAll<HTMLElement>("[data-focus-clock]").forEach(el => el.setText(`${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`));
  root.querySelectorAll<HTMLElement>("[data-focus-status]").forEach(el => el.setText(remaining === 0 ? (onBreak ? L("休息结束", "Break over") : L("完成，休息一下", "Done — take a break"))
    : running ? (onBreak ? L("休息中", "On a break") : L("专注中", "Focusing")) : paused ? L("已暂停", "Paused") : L("{durationMinutes} 分钟", "{durationMinutes} min", { durationMinutes: session.durationMinutes })));
  root.querySelectorAll<HTMLElement>("[data-focus-label]").forEach(el => { el.setText(session.label && !onBreak && (running || paused) ? session.label : ""); el.toggleClass("is-hidden", !(session.label && !onBreak && (running || paused))); });
  root.querySelectorAll<HTMLSelectElement>("[data-focus-target]").forEach(el => { el.toggleClass("is-hidden", !idle && !(remaining === 0 && onBreak)); if (el.value !== session.label && [...el.options].some(option => option.value === session.label)) el.value = session.label; });
  const state = running ? "running" : remaining === 0 ? "done" : paused ? "paused" : "idle";
  root.querySelectorAll<HTMLElement>("[data-focus-toggle]").forEach(el => {
    const key = `${state}:${session.kind}`;
    if (el.dataset.state === key) return;
    el.dataset.state = key;
    el.empty();
    setIcon(el.createSpan({ cls: "qh-action-icon" }), running ? "pause" : remaining === 0 ? (onBreak ? "play" : "rotate-cw") : "play");
    el.createSpan({ text: running ? L("暂停", "Pause") : remaining === 0 ? (onBreak ? L("开始专注", "Start focus") : L("再来一次", "Again")) : paused ? L("继续", "Resume") : L("开始专注", "Start") });
  });
  const circumference = 2 * Math.PI * 52;
  root.querySelectorAll<SVGCircleElement>("[data-focus-arc]").forEach(el => {
    el.setAttribute("stroke-dasharray", String(circumference));
    el.setAttribute("stroke-dashoffset", String(circumference * (total ? remaining / total : 0)));
  });
  root.querySelectorAll<HTMLElement>(".qh-focus-dial").forEach(el => { el.toggleClass("is-running", running); el.toggleClass("is-done", remaining === 0); el.toggleClass("is-break", onBreak); });
  root.querySelectorAll<HTMLElement>("[data-focus-presets]").forEach(el => {
    el.toggleClass("is-hidden", !idle && !(remaining === 0 && onBreak));
    el.querySelectorAll<HTMLElement>("[data-minutes]").forEach(chip => chip.setAttr("aria-pressed", String(Number(chip.dataset.minutes) === session.focusMinutes)));
  });
  root.querySelectorAll<HTMLElement>("[data-focus-break]").forEach(el => el.toggleClass("is-hidden", !(remaining === 0 && !onBreak)));
  root.querySelectorAll<HTMLElement>("[data-focus-reset]").forEach(el => el.toggleClass("is-hidden", idle));
  const stats = plugin.settings.focusStats, todayStats = stats.day === localDay() ? stats : { count: 0, minutes: 0 };
  root.querySelectorAll<HTMLElement>("[data-focus-today]").forEach(el => el.setText(todayStats.count
    ? L("今天已专注 {count} 次 · {minutes} 分钟", "Today: {count} sessions · {minutes} min", { count: todayStats.count, minutes: todayStats.minutes })
    : L("今天还没有完成专注", "No sessions finished today")));
}
