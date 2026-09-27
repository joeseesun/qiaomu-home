import { fillTemplate, templateFileName } from "./quick-tools";
import { cardAction, fieldRow } from "./card-ui";
import { renderHabitCard } from "./habits";
import { getAllTags, moment, Notice, TFile, setIcon } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { isChinese, t } from "./i18n";
import { localDay, moduleOptions } from "./settings";
import { PRODUCTIVITY_MODULES, type ProductivityId } from "./productivity-catalog";
import { eligibleNote, focusRemaining, inFolder, taskProgress } from "./productivity-data";
import { dailyExcerpt } from "./home-native-modules";
import { dailyOptions, todayPath, ensureParent, ensureTodayNote } from "./today";
import { completeTodo } from "./todo-data";
import { editorFor, update } from "./todo-files";

const L = (zh: string, en: string) => isChinese() ? zh : en;
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
  const open = (file: TFile, line?: number) => void app.workspace.getLeaf("tab").openFile(file, { eState: line === undefined ? undefined : { line } });
  const note = (file: TFile, text = file.basename, detail = file.path, line?: number) => {
    const row = body.createEl("button", { cls: "qh-workflow-row" });
    row.createSpan({ cls: "qh-workflow-title", text });
    row.createSpan({ cls: "qh-item-sub", text: detail });
    row.addEventListener("click", () => open(file, line)); return row;
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
      let tasks = (await plugin.taskIndex.read(options.folder)).filter(task => inFolder(task.path, options.folder));
      const today = localDay();
      if (id === "due-today") tasks = tasks.filter(task => task.due === today);
      else if (id === "overdue") tasks = tasks.filter(task => task.due !== null && task.due < today);
      else if (id === "milestones") tasks = tasks.filter(task => task.due !== null && task.due > today);
      else { const seen = new Set<string>(); tasks = tasks.filter(task => { if (seen.has(task.path)) return false; seen.add(task.path); return true; }); }
      if (id !== "project-next") tasks.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || a.path.localeCompare(b.path));
      if (!card.isConnected) return;
      body.empty();
      if (!tasks.length) message(L("没有符合条件的任务", "No matching tasks"));
      for (const task of tasks.slice(0, options.limit)) {
        const file = app.vault.getAbstractFileByPath(task.path); if (!(file instanceof TFile)) continue;
        const row = body.createDiv({ cls: "qh-workflow-task" });
        const checkboxLabel = row.createEl("label", { cls: "qh-task-check" });
        checkboxLabel.createSpan({ cls: "qh-sr-only", text: L(`完成 ${task.text}`, `Complete ${task.text}`) });
        const checkbox = checkboxLabel.createEl("input", { type: "checkbox" });
        const item = note(file, task.text.replace(/(?:📅\s*\d{4}-\d{2}-\d{2}|\[due::\s*\d{4}-\d{2}-\d{2}\])/gu, "").trim(), [task.name, task.due].filter(Boolean).join(" · "), task.line); row.appendChild(item);
        checkbox.addEventListener("change", () => {
          checkbox.disabled = true;
          void (async () => {
            const snapshot = editorFor(app, file)?.getValue() ?? await app.vault.read(file);
            await update(app, file, current => completeTodo(current, snapshot, task));
            plugin.taskIndex.clear(); plugin.eachView(view => view.render());
          })().catch(() => { checkbox.checked = false; checkbox.disabled = false; new Notice(L("任务已变化，请刷新后再试", "Task changed. Refresh and try again.")); });
        });
      }
    }); return;
  }
  if (id === "template-create") {
    if (!options.path) { message(L("选择一个 Markdown 模板开始", "Choose a Markdown template to begin")); button(body, L("选择模板", "Choose template"), configure, "settings-2", true); return; }
    const template = app.vault.getAbstractFileByPath(options.path);
    if (!(template instanceof TFile)) { message(L("模板已移动或不存在", "Template is missing")); button(body, L("重新选择模板", "Choose template"), configure, "settings-2", true); return; }
    body.createDiv({ cls: "qh-native-scope", text: L(`模板：${template.basename}`, `Template: ${template.basename}`) });
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
        input.value = ""; await app.workspace.getLeaf("tab").openFile(file);
      })().catch(error => new Notice(error instanceof Error ? error.message : L("创建失败", "Could not create note"))).finally(() => { create.disabled = false; });
    } });
    return;
  }
  if (id === "working-set") {
    const paths = options.paths ?? [];
    if (!paths.length) message(L("保存当前打开的 Markdown 笔记，最多 20 篇", "Save up to 20 currently open Markdown notes"));
    for (const path of paths.slice(0, 6)) {
      const file = app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) note(file);
      else message(L(`找不到：${path}`, `Missing: ${path}`));
    }
    const actions = body.createDiv({ cls: "qh-workflow-actions" });
    if (paths.length) button(actions, L(`恢复 ${paths.length} 篇`, `Restore ${paths.length} notes`), () => {
      const existing = new Set(openNotePaths(plugin));
      void (async () => {
        for (const path of paths) {
          if (existing.has(path)) continue;
          const file = app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) { await app.workspace.getLeaf("tab").openFile(file, { active: false }); existing.add(path); }
        }
      })().catch(() => new Notice(L("部分笔记未能打开", "Some notes could not be opened")));
    }, "panels-top-left", true);
    button(actions, L("保存当前笔记组", "Save open notes"), () => {
      const captured = [...new Set(openNotePaths(plugin))].slice(0, 20);
      if (!captured.length) { new Notice(L("先打开几篇 Markdown 笔记", "Open some Markdown notes first")); return; }
      const page = plugin.settings.pages.find(page => page.id === pageId); if (!page) return;
      const previous = page.moduleOptions[id]; page.moduleOptions[id] = { ...options, paths: captured };
      void plugin.saveSettings().catch(() => { if (previous) page.moduleOptions[id] = previous; else delete page.moduleOptions[id]; new Notice(t("layout.saveFailed")); });
    }, "save"); return;
  }
  if (id === "habit-checkin") { renderHabitCard(body, card, plugin, pageId, configure); return; }
  if (id === "focus-timer") {
    const save = (previous: typeof plugin.settings.focusSession) => void plugin.saveSettings().catch(() => { plugin.settings.focusSession = previous; new Notice(t("layout.saveFailed")); plugin.eachView(view => view.render()); });
    const dial = body.createDiv({ cls: "qh-focus-dial" });
    const svg = dial.createSvg("svg", { attr: { viewBox: "0 0 120 120", "aria-hidden": "true" } });
    svg.createSvg("circle", { cls: "qh-focus-track", attr: { cx: "60", cy: "60", r: "52" } });
    svg.createSvg("circle", { cls: "qh-focus-arc", attr: { cx: "60", cy: "60", r: "52", "data-focus-arc": "true", transform: "rotate(-90 60 60)" } });
    const center = dial.createDiv({ cls: "qh-focus-center" });
    const clock = center.createDiv({ cls: "qh-focus-clock" }); clock.dataset.focusClock = "true";
    const status = center.createDiv({ cls: "qh-focus-status" }); status.dataset.focusStatus = "true";
    status.setAttr("aria-live", "polite");
    const presets = body.createDiv({ cls: "qh-focus-presets" }); presets.dataset.focusPresets = "true";
    presets.setAttr("role", "group"); presets.setAttr("aria-label", L("专注时长", "Session length"));
    for (const minutes of [15, 25, 45, 60]) {
      const chip = presets.createEl("button", { cls: "qh-discovery-site", text: L(`${minutes} 分`, `${minutes}m`) });
      chip.dataset.minutes = String(minutes);
      chip.addEventListener("click", () => {
        const previous = { ...plugin.settings.focusSession };
        if (previous.endAt) return;
        plugin.settings.focusSession = { durationMinutes: minutes, remainingMs: minutes * 60000, endAt: 0 };
        paintFocus(card, plugin); save(previous);
      });
    }
    const actions = body.createDiv({ cls: "qh-workflow-actions qh-focus-actions" });
    const toggle = actions.createEl("button", { cls: "qh-native-open is-primary qh-focus-toggle" });
    toggle.addEventListener("click", () => {
      const previous = { ...plugin.settings.focusSession };
      const remaining = focusRemaining(previous);
      plugin.settings.focusSession = { ...previous, endAt: previous.endAt && remaining > 0 ? 0 : Date.now() + (remaining || previous.durationMinutes * 60000), remainingMs: remaining || previous.durationMinutes * 60000 };
      paintFocus(card, plugin); save(previous);
    }); toggle.dataset.focusToggle = "true";
    const reset = button(actions, L("重置", "Reset"), () => {
      const previous = { ...plugin.settings.focusSession };
      plugin.settings.focusSession = { ...previous, endAt: 0, remainingMs: previous.durationMinutes * 60000 };
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
          body.createDiv({ cls: "qh-native-count", text: `${progress.done} / ${progress.total}` });
          const bar = body.createEl("progress", { cls: "qh-goal-bar" }); bar.max = progress.total; bar.value = progress.done;
          bar.setAttr("aria-labelledby", `${pageId}-goal-${crypto.randomUUID()}`);
          const label = body.createSpan({ cls: "qh-sr-only", text: L("目标完成进度", "Goal completion") }); label.id = bar.getAttr("aria-labelledby")!;
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
  root.querySelectorAll<HTMLElement>("[data-focus-clock]").forEach(el => el.setText(`${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`));
  root.querySelectorAll<HTMLElement>("[data-focus-status]").forEach(el => el.setText(remaining === 0 ? L("完成，休息一下", "Done — take a break") : running ? L("专注中", "Focusing") : paused ? L("已暂停", "Paused") : L(`${session.durationMinutes} 分钟`, `${session.durationMinutes} min`)));
  const state = running ? "running" : remaining === 0 ? "done" : paused ? "paused" : "idle";
  root.querySelectorAll<HTMLElement>("[data-focus-toggle]").forEach(el => {
    if (el.dataset.state === state) return;
    el.dataset.state = state;
    el.empty();
    setIcon(el.createSpan({ cls: "qh-action-icon" }), running ? "pause" : remaining === 0 ? "rotate-cw" : "play");
    el.createSpan({ text: running ? L("暂停", "Pause") : remaining === 0 ? L("再来一次", "Again") : paused ? L("继续", "Resume") : L("开始专注", "Start") });
  });
  const circumference = 2 * Math.PI * 52;
  root.querySelectorAll<SVGCircleElement>("[data-focus-arc]").forEach(el => {
    el.setAttribute("stroke-dasharray", String(circumference));
    el.setAttribute("stroke-dashoffset", String(circumference * (total ? remaining / total : 0)));
  });
  root.querySelectorAll<HTMLElement>(".qh-focus-dial").forEach(el => { el.toggleClass("is-running", running); el.toggleClass("is-done", remaining === 0); });
  root.querySelectorAll<HTMLElement>("[data-focus-presets]").forEach(el => {
    el.toggleClass("is-hidden", !idle && remaining !== 0);
    el.querySelectorAll<HTMLElement>("[data-minutes]").forEach(chip => chip.setAttr("aria-pressed", String(Number(chip.dataset.minutes) === session.durationMinutes)));
  });
  root.querySelectorAll<HTMLElement>("[data-focus-reset]").forEach(el => el.toggleClass("is-hidden", idle));
  const stats = plugin.settings.focusStats, todayStats = stats.day === localDay() ? stats : { count: 0, minutes: 0 };
  root.querySelectorAll<HTMLElement>("[data-focus-today]").forEach(el => el.setText(todayStats.count
    ? L(`今天已专注 ${todayStats.count} 次 · ${todayStats.minutes} 分钟`, `Today: ${todayStats.count} sessions · ${todayStats.minutes} min`)
    : L("今天还没有完成专注", "No sessions finished today")));
}
