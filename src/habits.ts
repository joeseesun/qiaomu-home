import { moment, normalizePath, Notice, Setting, TFile, setIcon, type App } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { cardAction } from "./card-ui";
import { isChinese, t } from "./i18n";
import { moduleOptions } from "./settings";
import { dailyOptions, ensureTodayNote, todayPath } from "./today";

const L = (zh: string, en: string) => isChinese() ? zh : en;
export const MAX_HABITS = 8;
const RESERVED = new Set(["__proto__", "constructor", "prototype", "tags", "aliases", "cssclasses", "position"]);

/** Habits are stored comma-separated in the card's `query` option, which older versions already used. */
export function habitNames(query: string | undefined): string[] {
  return [...new Set((query ?? "").split(/[,，\n]/).map(name => name.trim()).filter(name => name && !RESERVED.has(name)))].slice(0, MAX_HABITS);
}

/** Why a new habit name cannot be used, or null when it is fine. */
export function habitProblem(name: string, existing: string[]): string | null {
  const value = name.trim();
  if (!value) return L("请输入习惯名称", "Enter a habit name");
  if (/[,，:#[\]{}|>]/.test(value) || value.length > 30) return L("名称不能包含逗号、冒号或 # 等符号，且不超过 30 字", "Avoid commas, colons or #, and keep it under 30 characters");
  if (RESERVED.has(value)) return L("这个名称被 Obsidian 保留", "That name is reserved by Obsidian");
  if (existing.includes(value)) return L("已经有这个习惯了", "You already track this habit");
  if (existing.length >= MAX_HABITS) return L(`最多 ${MAX_HABITS} 个习惯`, `Up to ${MAX_HABITS} habits`);
  return null;
}

export function suggestedHabits(): string[] {
  return isChinese() ? ["运动", "阅读", "冥想", "早睡", "喝水", "写作"] : ["Exercise", "Read", "Meditate", "Sleep early", "Water", "Write"];
}

/** Consecutive days ending yesterday (plus today when done) where the property is true in that day's daily note. */
export function habitStreak(done: (offset: number) => boolean | undefined, todayDone: boolean, limit = 365): number {
  let streak = todayDone ? 1 : 0;
  for (let offset = 1; offset <= limit && done(offset) === true; offset++) streak++;
  return streak;
}

async function dailyFrontmatter(app: App): Promise<(offset: number) => Record<string, unknown> | undefined> {
  const config = await dailyOptions(app);
  const format = config.format || "YYYY-MM-DD", folder = (config.folder ?? "").trim().replace(/\/$/, "");
  return offset => {
    const name = (moment as unknown as (date: Date) => { format(pattern: string): string })(new Date(Date.now() - offset * 86400000)).format(format);
    const file = app.vault.getAbstractFileByPath(normalizePath(`${folder ? `${folder}/` : ""}${name}.md`));
    return file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
  };
}

async function saveHabits(plugin: QiaomuHomePlugin, pageId: string, names: string[]): Promise<void> {
  const page = plugin.settings.pages.find(entry => entry.id === pageId);
  if (!page) return;
  const previous = page.moduleOptions["habit-checkin"];
  page.moduleOptions["habit-checkin"] = { ...moduleOptions(plugin.settings, "habit-checkin", pageId), query: names.join(", ") };
  try { await plugin.saveSettings(); }
  catch (error) { if (previous) page.moduleOptions["habit-checkin"] = previous; else delete page.moduleOptions["habit-checkin"]; throw error; }
}

export function renderHabitCard(body: HTMLElement, card: HTMLElement, plugin: QiaomuHomePlugin, pageId: string, configure: () => void): void {
  const app = plugin.app, names = habitNames(moduleOptions(plugin.settings, "habit-checkin", pageId).query);
  if (!names.length) {
    body.createDiv({ cls: "qh-card-empty", text: L("选几个每天想坚持的事，点一下就开始", "Pick a few daily habits to start tracking") });
    const chips = body.createDiv({ cls: "qh-discovery-sites" });
    for (const name of suggestedHabits()) {
      const chip = chips.createEl("button", { cls: "qh-discovery-site" });
      setIcon(chip.createSpan(), "plus");
      chip.createSpan({ text: name });
      chip.addEventListener("click", () => {
        chip.disabled = true;
        void saveHabits(plugin, pageId, [...habitNames(moduleOptions(plugin.settings, "habit-checkin", pageId).query), name])
          .catch(() => { chip.disabled = false; new Notice(t("layout.saveFailed")); });
      });
    }
    cardAction(body, L("自定义习惯", "Custom habits"), configure, "pencil");
    return;
  }
  const list = body.createDiv({ cls: "qh-habits" });
  list.setAttr("role", "group");
  list.setAttr("aria-label", L("今日习惯", "Today's habits"));
  const summary = body.createDiv({ cls: "qh-habit-summary" });
  const actions = body.createDiv({ cls: "qh-workflow-actions" });
  cardAction(actions, L("编辑习惯", "Edit habits"), configure, "pencil");
  const openToday = cardAction(actions, L("打开今日日记", "Open today's note"), () => void ensureTodayNote(app).then(file => app.workspace.getLeaf("tab").openFile(file))
    .catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))), "arrow-up-right");

  void (async () => {
    const path = await todayPath(app);
    const history = await dailyFrontmatter(app);
    if (!card.isConnected) return;
    const today = app.vault.getAbstractFileByPath(path);
    const data: Record<string, unknown> = today instanceof TFile ? app.metadataCache.getFileCache(today)?.frontmatter ?? {} : {};
    const state = new Map(names.map(name => [name, data[name] === true]));
    const paintSummary = () => {
      summary.empty();
      const done = [...state.values()].filter(Boolean).length;
      summary.createSpan({ text: done === names.length ? L("今天全部完成 🎉", "All done today 🎉") : L(`完成 ${done} / ${names.length}`, `${done} of ${names.length} done`) });
      const bar = summary.createEl("progress", { cls: "qh-goal-bar" }); bar.max = names.length; bar.value = done;
      bar.setAttr("aria-label", L(`已完成 ${done} 项`, `${done} done`));
    };
    for (const name of names) {
      const valid = data[name] === undefined || data[name] === null || typeof data[name] === "boolean";
      const pill = list.createEl("button", { cls: "qh-habit-pill" });
      pill.setAttr("role", "switch");
      const icon = pill.createSpan({ cls: "qh-habit-check" });
      pill.createSpan({ cls: "qh-habit-name", text: name });
      const streakEl = pill.createSpan({ cls: "qh-habit-streak" });
      const paint = () => {
        const on = state.get(name) === true;
        pill.setAttr("aria-checked", String(on));
        pill.toggleClass("is-done", on);
        icon.empty(); setIcon(icon, on ? "circle-check" : "circle");
        const streak = habitStreak(offset => history(offset)?.[name] === true, on);
        streakEl.setText(streak >= 2 ? L(`${streak} 天`, `${streak}d`) : "");
        pill.setAttr("aria-label", `${name}${streak >= 2 ? L(`，连续 ${streak} 天`, `, ${streak}-day streak`) : ""}`);
      };
      paint();
      if (!valid) {
        pill.disabled = true;
        pill.setAttr("title", L("今日日记里这个属性不是 true/false，已保留原值", "This property in today's note is not true/false; it was left unchanged"));
        continue;
      }
      pill.addEventListener("click", () => {
        const next = !(state.get(name) === true);
        state.set(name, next); paint(); paintSummary(); pill.disabled = true;
        void (async () => {
          const file = await ensureTodayNote(app);
          await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
            if (frontmatter[name] !== undefined && frontmatter[name] !== null && typeof frontmatter[name] !== "boolean") throw new Error("Property changed");
            frontmatter[name] = next;
          });
        })().catch((error: unknown) => {
          state.set(name, !next); paint(); paintSummary();
          new Notice(error instanceof Error && error.message !== "Property changed" ? error.message : L("未能保存打卡，原属性已保留", "Could not save the check-in; the property was left unchanged"));
        }).finally(() => { if (pill.isConnected) pill.disabled = false; });
      });
    }
    paintSummary();
    if (!(today instanceof TFile)) summary.createDiv({ cls: "qh-native-scope", text: L("第一次打卡时会按日记模板创建今天的日记", "The first check-in creates today's daily note from your template") });
  })().catch(() => {
    if (!card.isConnected) return;
    list.empty(); summary.empty(); openToday.remove();
    body.createDiv({ cls: "qh-card-empty", text: L("习惯记录在日记里，请先启用日记核心插件", "Habits live in daily notes; turn on the Daily notes core plugin") });
  });
}

/** Settings for the habit card: every change applies immediately and the card behind updates live. */
export function renderHabitEditor(contentEl: HTMLElement, plugin: QiaomuHomePlugin, pageId: string): void {
  const root = contentEl.createDiv({ cls: "qh-habit-editor" });
  const current = () => habitNames(moduleOptions(plugin.settings, "habit-checkin", pageId).query);
  const save = (names: string[]) => saveHabits(plugin, pageId, names).then(() => paint()).catch(() => new Notice(t("layout.saveFailed")));
  const paint = () => {
    root.empty();
    const names = current();
    new Setting(root).setHeading().setName(L(`我的习惯（${names.length}/${MAX_HABITS}）`, `My habits (${names.length}/${MAX_HABITS})`));
    if (!names.length) root.createDiv({ cls: "setting-item-description", text: L("还没有习惯，从下面添加一个。", "No habits yet; add one below.") });
    names.forEach((name, index) => {
      const row = new Setting(root).setName(name);
      row.addExtraButton(button => button.setIcon("arrow-up").setTooltip(L("上移", "Move up")).setDisabled(index === 0).onClick(() => {
        const next = [...names]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void save(next);
      }));
      row.addExtraButton(button => button.setIcon("x").setTooltip(L("移除（日记里的记录会保留）", "Remove (past records stay in your notes)")).onClick(() => void save(names.filter(entry => entry !== name))));
    });
    const add = new Setting(root).setName(L("添加习惯", "Add a habit"));
    const error = add.descEl.createDiv({ cls: "qh-save-state" });
    let input!: HTMLInputElement;
    const submit = () => {
      const problem = habitProblem(input.value, current());
      if (problem) { error.setText(problem); error.addClass("is-error"); input.addClass("is-invalid"); input.focus(); return; }
      const value = input.value.trim();
      void save([...current(), value]).then(() => root.querySelector<HTMLInputElement>(".qh-habit-add input")?.focus());
    };
    add.settingEl.addClass("qh-habit-add");
    add.addText(text => {
      input = text.inputEl;
      text.setPlaceholder(L("例如：跑步 30 分钟", "e.g. Run 30 minutes"));
      input.addEventListener("input", () => { error.setText(""); error.removeClass("is-error"); input.removeClass("is-invalid"); });
      input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submit(); } });
    });
    add.addButton(button => button.setButtonText(L("添加", "Add")).setCta().setDisabled(names.length >= MAX_HABITS).onClick(submit));
    const ideas = suggestedHabits().filter(name => !names.includes(name));
    if (ideas.length && names.length < MAX_HABITS) {
      const chips = root.createDiv({ cls: "qh-habit-ideas" });
      chips.createSpan({ cls: "setting-item-description", text: L("常用：", "Ideas: ") });
      for (const name of ideas) {
        const chip = chips.createEl("button", { cls: "qh-idea-chip", text: `+ ${name}` });
        chip.addEventListener("click", () => void save([...current(), name]));
      }
    }
    root.createEl("p", { cls: "setting-item-description qh-habit-note", text: L("打卡会在今日日记的属性里写入 true / false，名称即属性名；没有今日日记时会先按日记模板创建。移除习惯不会删除日记里的记录。", "Check-ins write true/false properties named after each habit in today's daily note, creating it from your template if needed. Removing a habit keeps past records.") });
  };
  paint();
  window.setTimeout(() => root.querySelector<HTMLInputElement>(".qh-habit-add input")?.focus());
}
