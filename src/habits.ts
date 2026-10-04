import { renderGauge } from "./gauge";
import { isComposingKey } from "./input-ui";
import { openFromHome } from "./open";
import { moment, normalizePath, Notice, Setting, TFile, setIcon, type App } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { cardAction } from "./card-ui";
import { L, t } from "./i18n";
import { moduleOptions } from "./settings";
import { dailyOptions, ensureTodayNote, todayPath } from "./today";

export const MAX_HABITS = 8;
const RESERVED = new Set(["__proto__", "constructor", "prototype", "tags", "aliases", "cssclasses", "position"]);

/** Habits are stored comma-separated in the card's `query` option, which older versions already used. "喝水:8" is a habit counted up to 8. */
export function habitSpecs(query: string | undefined): Array<{ name: string; target: number }> {
  const specs: Array<{ name: string; target: number }> = [];
  for (const entry of (query ?? "").split(/[,，\n]/)) {
    const match = /^(.*?)(?:\s*[:：]\s*(\d{1,3}))?$/.exec(entry.trim());
    const name = match?.[1].trim() ?? "";
    if (!name || RESERVED.has(name) || specs.some(spec => spec.name === name)) continue;
    const target = Math.min(99, Math.max(1, Number(match?.[2] ?? 1)));
    specs.push({ name, target });
  }
  return specs.slice(0, MAX_HABITS);
}
export function habitNames(query: string | undefined): string[] { return habitSpecs(query).map(spec => spec.name); }
const specText = (spec: { name: string; target: number }) => spec.target > 1 ? `${spec.name}:${spec.target}` : spec.name;
/** A day's value counts as done when it is true, or a number that reached the target. */
export function habitDone(value: unknown, target: number): boolean {
  return value === true || (typeof value === "number" && value >= target);
}

/** Why a new habit name cannot be used, or null when it is fine. */
export function habitProblem(name: string, existing: string[]): string | null {
  const value = name.trim();
  if (!value) return L("请输入习惯名称", "Enter a habit name");
  if (/[,，:：#[\]{}|>]/.test(value) || value.length > 30) return L("名称不能包含逗号、冒号或 # 等符号，且不超过 30 字", "Avoid commas, colons or #, and keep it under 30 characters");
  if (RESERVED.has(value)) return L("这个名称被 Obsidian 保留", "That name is reserved by Obsidian");
  if (existing.includes(value)) return L("已经有这个习惯了", "You already track this habit");
  if (existing.length >= MAX_HABITS) return L("最多 {MAX_HABITS} 个习惯", "Up to {MAX_HABITS} habits", { MAX_HABITS });
  return null;
}

export function suggestedHabits(): string[] {
  return [L("运动", "Exercise"), L("阅读", "Read"), L("冥想", "Meditate"), L("早睡", "Sleep early"), L("喝水", "Water"), L("写作", "Write")];
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
  // Calendar days, not 24-hour steps, so daylight-saving changes never skip or repeat a day.
  const day = moment as unknown as () => { subtract(n: number, unit: string): { format(pattern: string): string } };
  return offset => {
    const name = day().subtract(offset, "days").format(format);
    const file = app.vault.getAbstractFileByPath(normalizePath(`${folder ? `${folder}/` : ""}${name}.md`));
    return file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
  };
}

async function saveHabits(plugin: QiaomuHomePlugin, pageId: string, names: string[]): Promise<void> {
  const page = plugin.settings.pages.find(entry => entry.id === pageId);
  if (!page) return;
  // Keep each habit's target when the list is reordered or extended by name.
  const targets = new Map(habitSpecs(moduleOptions(plugin.settings, "habit-checkin", pageId).query).map(spec => [spec.name, spec.target]));
  const query = names.map(entry => {
    const [spec] = habitSpecs(entry);
    return spec ? specText({ name: spec.name, target: /[:：]\s*\d+$/.test(entry) ? spec.target : targets.get(spec.name) ?? 1 }) : "";
  }).filter(Boolean).join(", ");
  const previous = page.moduleOptions["habit-checkin"];
  page.moduleOptions["habit-checkin"] = { ...moduleOptions(plugin.settings, "habit-checkin", pageId), query };
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
  const specs = habitSpecs(moduleOptions(plugin.settings, "habit-checkin", pageId).query);
  const list = body.createDiv({ cls: "qh-habits" });
  list.setAttr("role", "group");
  list.setAttr("aria-label", L("今日习惯", "Today's habits"));
  const summary = body.createDiv({ cls: "qh-habit-summary" });
  const week = body.createDiv({ cls: "qh-habit-week" });
  const actions = body.createDiv({ cls: "qh-workflow-actions" });
  cardAction(actions, L("编辑习惯", "Edit habits"), configure, "pencil");
  const openToday = cardAction(actions, L("打开今日日记", "Open today's note"), () => void ensureTodayNote(app).then(file => openFromHome(plugin, card, file))
    .catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))), "arrow-up-right");

  void (async () => {
    const path = await todayPath(app);
    const history = await dailyFrontmatter(app);
    if (!card.isConnected) return;
    const today = app.vault.getAbstractFileByPath(path);
    const data: Record<string, unknown> = today instanceof TFile ? app.metadataCache.getFileCache(today)?.frontmatter ?? {} : {};
    const state = new Map<string, number | boolean>(specs.map(spec => [spec.name, typeof data[spec.name] === "number" ? data[spec.name] as number : data[spec.name] === true]));
    const doneToday = (spec: { name: string; target: number }) => habitDone(state.get(spec.name), spec.target);
    const paintSummary = () => {
      summary.empty();
      const done = specs.filter(doneToday).length;
      const metric = summary.createDiv({ cls: "qh-habit-gauge" });
      renderGauge(metric, done / specs.length, L("已完成 {done} 项", "{done} done", { done }), `${done}/${specs.length}`, true);
      summary.createSpan({ text: done === specs.length ? L("今天全部完成", "All done today") : L("完成 {done} / {length}", "{done} of {length} done", { done, length: specs.length }) });
    };
    // Last seven days, oldest first; today reflects taps made on the card.
    const paintWeek = () => {
      week.empty();
      const grid = week.createDiv({ cls: "qh-habit-grid" });
      for (const spec of specs) {
        const row = grid.createDiv({ cls: "qh-habit-grid-row" });
        row.createSpan({ cls: "qh-habit-grid-name", text: spec.name });
        const dots = row.createDiv({ cls: "qh-habit-dots" });
        let count = 0;
        for (let offset = 6; offset >= 0; offset--) {
          const done = offset === 0 ? doneToday(spec) : habitDone(history(offset)?.[spec.name], spec.target);
          if (done) count++;
          dots.createSpan({ cls: `qh-habit-dot${done ? " is-done" : ""}${offset === 0 ? " is-today" : ""}` });
        }
        row.createSpan({ cls: "qh-sr-only", text: L("{name}：最近 7 天完成 {count} 天", "{name}: {count} of the last 7 days", { name: spec.name, count }) });
      }
    };
    const write = async (name: string, value: number | boolean) => {
      const file = await ensureTodayNote(app);
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        const existing = frontmatter[name];
        if (existing !== undefined && existing !== null && typeof existing !== "boolean" && typeof existing !== "number") throw new Error("Property changed");
        frontmatter[name] = value;
      });
    };
    for (const spec of specs) {
      const { name, target } = spec;
      const raw = data[name];
      const valid = raw === undefined || raw === null || typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw));
      const pill = list.createEl("button", { cls: "qh-habit-pill" });
      pill.setAttr("role", target > 1 ? "button" : "switch");
      const icon = pill.createSpan({ cls: "qh-habit-check" });
      pill.createSpan({ cls: "qh-habit-name", text: name });
      const countEl = pill.createSpan({ cls: "qh-habit-count" });
      const streakEl = pill.createSpan({ cls: "qh-habit-streak" });
      const paint = () => {
        const on = doneToday(spec), value = state.get(name);
        const count = typeof value === "number" ? value : value === true ? target : 0;
        if (target > 1) countEl.setText(`${Math.min(count, 99)}/${target}`);
        else pill.setAttr("aria-checked", String(on));
        pill.toggleClass("is-done", on);
        icon.empty(); setIcon(icon, on ? "circle-check" : target > 1 && count > 0 ? "circle-dot" : "circle");
        const streak = habitStreak(offset => habitDone(history(offset)?.[name], target), on);
        streakEl.setText(streak >= 2 ? L("{streak} 天", "{streak}d", { streak }) : "");
        pill.setAttr("aria-label", `${name}${target > 1 ? ` ${count}/${target}` : ""}${streak >= 2 ? L("，连续 {streak} 天", ", {streak}-day streak", { streak }) : ""}`);
      };
      paint();
      if (!valid) {
        pill.disabled = true;
        pill.addClass("is-invalid");
        continue;
      }
      const change = (next: number | boolean) => {
        const previous = state.get(name) ?? false;
        state.set(name, next); paint(); paintSummary(); paintWeek(); pill.disabled = true;
        void write(name, next).catch((error: unknown) => {
          state.set(name, previous); paint(); paintSummary(); paintWeek();
          new Notice(error instanceof Error && error.message !== "Property changed" ? error.message : L("未能保存打卡，原属性已保留", "Could not save the check-in; the property was left unchanged"));
        }).finally(() => { if (pill.isConnected) pill.disabled = false; });
      };
      const current = () => { const value = state.get(name); return typeof value === "number" ? value : value === true ? target : 0; };
      // A counted habit goes up by one per tap and wraps to zero after the target; right-click takes one off.
      pill.addEventListener("click", () => change(target > 1 ? (current() >= target ? 0 : current() + 1) : !(state.get(name) === true)));
      if (target > 1) pill.addEventListener("contextmenu", event => { event.preventDefault(); if (current() > 0) change(current() - 1); });
    }
    paintSummary();
    paintWeek();
    if (specs.some(spec => spec.target > 1)) summary.createDiv({ cls: "qh-native-scope", text: L("计次习惯：点一下加一，右键减一", "Counted habits: tap to add one, right-click to remove one") });
    if (specs.some(spec => { const raw = data[spec.name]; return !(raw === undefined || raw === null || typeof raw === "boolean" || typeof raw === "number"); }))
      summary.createDiv({ cls: "qh-native-scope", text: L("灰色的习惯在今日日记里不是 true/false 或数字，已保留原值", "Greyed-out habits hold other values in today's note and were left unchanged") });
    if (!(today instanceof TFile)) summary.createDiv({ cls: "qh-native-scope", text: L("第一次打卡时会按日记模板创建今天的日记", "The first check-in creates today's daily note from your template") });
  })().catch(() => {
    if (!card.isConnected) return;
    list.empty(); summary.empty(); week.empty(); openToday.remove();
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
    new Setting(root).setHeading().setName(L("我的习惯（{length}/{MAX_HABITS}）", "My habits ({length}/{MAX_HABITS})", { length: names.length, MAX_HABITS }));
    if (!names.length) root.createDiv({ cls: "setting-item-description", text: L("还没有习惯，从下面添加一个。", "No habits yet; add one below.") });
    const targets = new Map(habitSpecs(moduleOptions(plugin.settings, "habit-checkin", pageId).query).map(spec => [spec.name, spec.target]));
    names.forEach((name, index) => {
      const row = new Setting(root).setName(name);
      row.addDropdown(dropdown => dropdown.addOptions(Object.fromEntries([1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => [String(n), n === 1 ? L("打卡", "Check off") : L("每天 {n} 次", "{n} times a day", { n })])))
        .setValue(String(targets.get(name) ?? 1)).onChange(value => void save(names.map(entry => entry === name ? `${name}:${value}` : entry))));
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
      input.addEventListener("keydown", event => { if (event.key === "Enter" && !isComposingKey(event)) { event.preventDefault(); submit(); } });
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
