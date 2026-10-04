import { renderGauge, renderClockFace } from "./gauge";
import { coordinateLocation, searchWeatherPlaces, WEATHER_COUNTRIES } from "./weather-location";
import { isComposingKey } from "./input-ui";
import { openFromHome } from "./open";
import { FuzzySuggestModal, moment, normalizePath, Notice, requestUrl, Setting, TFile, TFolder, setIcon, setTooltip } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { askAgent, canAsk } from "./agent-bridge";
import { cardAction } from "./card-ui";
import type { NoiseKind } from "./ambient";
import { EXTRA_MODULES, type ExtraId } from "./extra-catalog";
import {
  BUILTIN_QUOTES, activityDays, activityStreak, agenda, calendarUrl, clockMinutes, dailyIndex, defaultZones, forecastUrl, heatLevel, parseFlashcards,
  parseForecast, parseIcs, parseQuotes, parseSnippets, parseVideoUrl, parseZones, timeProgress, videoNote, weatherLabel,
  zoneLines, zoneTime, type Forecast,
} from "./extra-data";
import { L, currentLanguage, dateLocale, isChinese, t } from "./i18n";
import { eligibleNote, inFolder } from "./productivity-data";
import { fillTemplate, templateFileName } from "./quick-tools";
import { localDay, moduleOptions, type ModuleOptions } from "./settings";
import { dailyExcerpt } from "./home-native-modules";
import { captureNote, dailyOptions, ensureParent } from "./today";
import { SYNTAX_EXAMPLES, autoSave } from "./option-fields";

interface Day { format(pattern?: string): string; clone(): Day; startOf(unit: string): Day; endOf(unit: string): Day; diff(other: Day, unit: string): number }
const mo = moment as unknown as (input?: string | Date, format?: string) => Day;
/** Mon / Wed / Fri labels for the heatmap rows, in the Home language. */
function weekdayLabels(): string[] {
  // 2024-01-01 was a Monday.
  const name = (day: number) => new Date(2024, 0, day).toLocaleDateString(dateLocale(), { weekday: "short" });
  return isChinese() ? ["一", "", "三", "", "五", "", ""] : [name(1), "", name(3), "", name(5), "", ""];
}
/** "YYYY-MM-DD" or a Date, read as a local calendar day. */
function localDate(day: string | Date): Date {
  if (day instanceof Date) return day;
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, date);
}
function shortWeekday(day: string): string {
  return localDate(day).toLocaleDateString(dateLocale(), { weekday: "short" });
}
function shortDate(day: string | Date): string {
  return isChinese() ? mo(day, typeof day === "string" ? "YYYY-MM-DD" : undefined).format("M月D日 ddd")
    : localDate(day).toLocaleDateString(dateLocale(), { weekday: "short", month: "short", day: "numeric" });
}
function monthLabel(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return isChinese() ? `${month}月` : new Date(year, month - 1, 1).toLocaleDateString(dateLocale(), { month: "short" });
}

/** Remote text shared by every Home tab; failures are not cached. */
const remote = new Map<string, { at: number; value: Promise<string> }>();
function fetchText(url: string, ttlMs: number): Promise<string> {
  const hit = remote.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = requestUrl({ url, throw: false }).then(response => {
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    return response.text;
  });
  remote.set(url, { at: Date.now(), value });
  value.catch(() => { if (remote.get(url)?.value === value) remote.delete(url); });
  return value;
}

/** Per-session UI state (which quote or card is showing) so re-renders do not reshuffle. */
const offsets = new Map<string, number>();
const revealed = new Set<string>();
const captureDrafts = new WeakMap<QiaomuHomePlugin, string>();
const capturePending = new WeakSet<QiaomuHomePlugin>();

interface WeekPaths { path: string; template: string; label: string; range: string; daysLeft: number; periodic: boolean }
export function weeklyNote(plugin: QiaomuHomePlugin, options: ModuleOptions): WeekPaths {
  const app = plugin.app;
  const periodic = (app as unknown as { plugins?: { plugins?: Record<string, { settings?: { weekly?: { enabled?: boolean; folder?: string; format?: string; template?: string } } }> } })
    .plugins?.plugins?.["periodic-notes"]?.settings?.weekly;
  const use = periodic?.enabled === true;
  const format = (use ? periodic?.format : options.format) || "gggg-[W]ww";
  const folder = ((use ? periodic?.folder : options.folder || plugin.settings.createFolder) ?? "").trim().replace(/^\/+|\/+$/g, "");
  const now = mo();
  const path = normalizePath(`${folder ? `${folder}/` : ""}${now.format(format)}.md`);
  if (path.includes("\\") || path.split("/").includes("..") || path === app.vault.configDir || path.startsWith(`${app.vault.configDir}/`)) throw new Error(L("周记路径无效", "Invalid weekly note path"));
  const start = now.clone().startOf("week"), end = now.clone().endOf("week");
  return {
    path, periodic: use, label: now.format(format),
    template: ((use ? periodic?.template : options.path) ?? "").trim(),
    range: `${start.format("M/D")} – ${end.format("M/D")}`,
    daysLeft: Math.max(0, end.clone().startOf("day").diff(now.clone().startOf("day"), "days")),
  };
}

export function renderExtra(parent: HTMLElement, plugin: QiaomuHomePlugin, id: ExtraId, pageId: string, configure: () => void): void {
  const app = plugin.app, config = EXTRA_MODULES[id], options = moduleOptions(plugin.settings, id, pageId);
  const card = parent.createDiv({ cls: "qh-card" }); card.dataset.module = id;
  const head = card.createDiv({ cls: "qh-card-head" });
  setIcon(head.createSpan({ cls: "qh-card-icon" }), config.icon);
  head.createSpan({ cls: "qh-card-title", text: L(config.zh, config.en) });
  const body = card.createDiv({ cls: "qh-native-preview" });
  const message = (text: string, into = body) => into.createDiv({ cls: "qh-card-empty", text });
  const button = (into: HTMLElement, text: string, run: () => void, icon?: string, primary = false) => cardAction(into, text, run, icon, primary);
  const open = (file: TFile, line?: number) => void openFromHome(plugin, card, file, null, line);
  const setup = (text: string, label: string) => { message(text); button(body, label, configure, "settings-2", true); };
  const run = (action: () => Promise<void>) => {
    message(L("正在读取…", "Loading…"));
    void action().catch((error: unknown) => {
      if (!card.isConnected) return;
      body.empty(); message(`${L("暂时无法读取", "Could not load")}${error instanceof Error && error.message ? `：${error.message}` : ""}`);
      button(body, L("重试", "Retry"), () => { body.empty(); run(action); }, "refresh-cw");
    });
  };
  const noteSource = (): TFile | null => {
    const file = options.path ? app.vault.getAbstractFileByPath(options.path) : null;
    return file instanceof TFile ? file : null;
  };
  const minuteTick = (paint: () => void) => { card.dataset.tick = "minute"; card.addEventListener("qh-minute", paint); paint(); };
  const input = (placeholder: string, label: string, type = "text") => {
    const el = body.createEl("input", { cls: "qh-discovery-input", type, placeholder });
    el.id = `qh-${id}-${crypto.randomUUID()}`;
    body.createEl("label", { cls: "qh-sr-only", text: label, attr: { for: el.id } });
    return el;
  };
  const onEnter = (el: HTMLInputElement, action: () => void) => el.addEventListener("keydown", event => {
    if (event.key === "Enter" && !isComposingKey(event)) { event.preventDefault(); action(); }
  });

  if (id === "quick-capture") {
    const daily = plugin.settings.captureTarget === "daily";
    const status = createDiv({ cls: "qh-native-scope", text: daily ? L("写入今日日记 · 回车保存", "Goes to today's daily note · Enter to save") : L("写入 {captureInboxPath} · 回车保存", "Goes to {captureInboxPath} · Enter to save", { captureInboxPath: plugin.settings.captureInboxPath }) });
    status.setAttr("aria-live", "polite");
    // A textarea so pasted or Shift+Enter lines are kept; Enter saves. Extra lines are indented under the first.
    const row = body.createDiv({ cls: "qh-field-row qh-capture-row" });
    const field = row.createEl("textarea", { cls: "qh-discovery-input qh-capture-input", attr: { rows: "1", placeholder: L("记下一句话…（⇧↵ 换行）", "Write a line… (⇧↵ for a new line)"), maxlength: "2000" } });
    field.value = captureDrafts.get(plugin) ?? "";
    const fieldName = row.createSpan({ cls: "qh-sr-only", text: L("快速记录", "Quick capture") });
    fieldName.id = `qh-capture-${crypto.randomUUID()}`; field.setAttr("aria-labelledby", fieldName.id);
    const submit = row.createEl("button", { cls: "qh-field-submit" });
    submit.disabled = capturePending.has(plugin);
    setIcon(submit, "corner-down-left"); submit.createSpan({ cls: "qh-sr-only", text: L("记下", "Save") });
    const grow = () => { field.setCssProps({ height: "auto" }); field.setCssProps({ height: `${Math.min(field.scrollHeight, 160)}px` }); };
    const save = () => {
      if (capturePending.has(plugin)) return;
      if (!field.value.trim()) { field.focus(); return; }
      const text = field.value;
      capturePending.add(plugin);
      submit.disabled = true;
      void captureNote(app, plugin.settings, text).then(path => {
        if (captureDrafts.get(plugin) === text) captureDrafts.delete(plugin);
        if (field.value === text) field.value = "";
        grow(); status.setText(L("已记下 · {path}", "Saved · {path}", { path }));
        if (field.ownerDocument.activeElement === submit) field.focus();
      }).catch((error: unknown) => new Notice(t("capture.failed", { message: error instanceof Error ? error.message : String(error) })))
        .finally(() => {
          capturePending.delete(plugin); submit.disabled = false;
          if (!card.isConnected) plugin.eachView(view => view.requestRefresh());
        });
    };
    field.addEventListener("input", () => { captureDrafts.set(plugin, field.value); grow(); });
    field.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !isComposingKey(event) && !submit.disabled) { event.preventDefault(); save(); } });
    submit.addEventListener("click", save);
    body.appendChild(status);
    return;
  }

  if (id === "weekly-review") {
    let week: WeekPaths;
    try { week = weeklyNote(plugin, options); } catch (error) { setup(error instanceof Error ? error.message : String(error), L("修改设置", "Settings")); return; }
    card.insertBefore(createDiv({ cls: "qh-native-scope", text: `${week.label} · ${week.range} · ${week.daysLeft ? L("本周还剩 {daysLeft} 天", "{daysLeft} days left", { daysLeft: week.daysLeft }) : L("本周最后一天", "Last day of the week")}` }), body);
    const file = app.vault.getAbstractFileByPath(week.path);
    if (file instanceof TFile) {
      run(async () => {
        const lines = dailyExcerpt(await app.vault.cachedRead(file), options.limit);
        if (!card.isConnected) return; body.empty();
        if (!lines.length) message(L("本周周记还没有正文", "This week's note is empty"));
        for (const line of lines) body.createDiv({ cls: "qh-native-line", text: line });
        button(body, L("打开本周回顾", "Open weekly review"), () => open(file), "arrow-up-right");
      });
      return;
    }
    message(L("本周还没有周记", "No weekly note yet"));
    const create: HTMLButtonElement = button(body, L("创建本周回顾", "Create weekly review"), () => {
      create.disabled = true;
      void (async () => {
        const template = week.template ? app.vault.getAbstractFileByPath(normalizePath(week.template.endsWith(".md") ? week.template : `${week.template}.md`)) : null;
        const content = template instanceof TFile ? fillTemplate(await app.vault.read(template), week.label, pattern => mo().format(pattern))
          : L("## 本周完成\n- \n\n## 值得记住\n- \n\n## 下周重点\n- \n", "## Done this week\n- \n\n## Worth remembering\n- \n\n## Next week\n- \n");
        await ensureParent(app, week.path);
        const existing = app.vault.getAbstractFileByPath(week.path);
        const created = existing instanceof TFile ? existing : await app.vault.create(week.path, content);
        await openFromHome(plugin, card, created);
      })().catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))).finally(() => { create.disabled = false; });
    }, "plus", true);
    return;
  }

  if (id === "day-progress") {
    const start = options.start ?? "09:00", end = options.end ?? "18:00";
    minuteTick(() => {
      body.empty();
      const progress = timeProgress(new Date(), start, end);
      const rings = body.createDiv({ cls: "qh-time-gauges" });
      const row = (label: string, value: number, note?: string) => {
        const metric = rings.createDiv({ cls: "qh-time-gauge" });
        renderGauge(metric, value, label, undefined, true);
        if (note) metric.createDiv({ cls: "qh-native-scope", text: note });
      };
      if (progress.work !== null) {
        const left = progress.workLeft;
        row(L("工作", "Work"), progress.work,
          progress.workState === "before" ? start : progress.workState === "after" ? L("已结束", "Done") : L("剩 {v}:{v2}", "{v}:{v2} left", { v: Math.floor(left / 60), v2: String(left % 60).padStart(2, "0") }));
      }
      row(L("今天", "Today"), progress.day);
      row(L("本周", "Week"), progress.week);
      row(L("本月", "Month"), progress.month);
      row(L("今年", "Year"), progress.year);
    });
    return;
  }

  if (id === "world-clock") {
    const zones = options.zones?.length ? options.zones : defaultZones(isChinese());
    minuteTick(() => {
      body.empty();
      for (const zone of zones) {
        const row = body.createDiv({ cls: "qh-clock-row" });
        let value: { time: string; offset: number };
        try { value = zoneTime(new Date(), zone.zone); } catch { continue; }
        renderClockFace(row, value.time);
        const name = row.createDiv({ cls: "qh-clock-name" });
        name.createSpan({ cls: "qh-clock-label", text: zone.label });
        const hour = Number(value.time.slice(0, 2));
        const dayState = name.createSpan({ cls: "qh-clock-day-state" });
        setIcon(dayState.createSpan(), hour >= 6 && hour < 18 ? "sun" : "moon");
        dayState.createSpan({ text: hour >= 6 && hour < 18 ? L("白天", "Daytime") : L("夜间", "Nighttime") });
        row.createSpan({ cls: "qh-clock-offset", text: value.offset > 0 ? L("明天", "Tomorrow") : value.offset < 0 ? L("昨天", "Yesterday") : "" });
        row.createSpan({ cls: "qh-clock-time", text: value.time });
      }
    });
    if (!options.zones?.length) button(card, L("选择城市", "Choose cities"), configure, "settings-2");
    return;
  }

  if (id === "weather") {
    const location = options.location;
    if (!location) { setup(L("选择城市后显示天气。城市坐标会发送给 Open-Meteo。", "Choose a city to show weather. Its coordinates are sent to Open-Meteo."), L("选择城市", "Choose city")); return; }
    const unit = options.unit ?? "c";
    run(async () => {
      const forecast: Forecast = parseForecast(JSON.parse(await fetchText(forecastUrl(location, unit), 30 * 60000)));
      if (!card.isConnected) return; body.empty();
      const now = weatherLabel(forecast.current.code);
      const top = body.createDiv({ cls: "qh-weather-now" });
      const temp = top.createDiv({ cls: "qh-weather-temperature" });
      temp.createSpan({ cls: "qh-native-count", text: `${Math.round(forecast.current.temperature)}°` });
      temp.createSpan({ cls: "qh-weather-unit", text: unit === "f" ? "F" : "C" });
      const overview = top.createDiv({ cls: "qh-weather-overview" });
      overview.createDiv({ cls: "qh-weather-city", text: location.name });
      const condition = overview.createDiv({ cls: "qh-weather-condition" });
      setIcon(condition.createSpan({ cls: "qh-weather-icon" }), now.icon);
      condition.createSpan({ text: now.text });
      overview.createDiv({ cls: "qh-native-scope", text: `${L("体感", "feels")} ${Math.round(forecast.current.feels)}°` });
      const details = body.createDiv({ cls: "qh-weather-details" });
      if (forecast.current.humidity !== null) details.createSpan({ text: `${L("湿度", "Humidity")} ${Math.round(forecast.current.humidity)}%` });
      if (forecast.current.wind !== null) details.createSpan({ text: `${L("风速", "Wind speed")} ${Math.round(forecast.current.wind)} km/h` });
      const first = forecast.days[0];
      if (first?.sunrise && first.sunset) details.createSpan({ text: `${L("日出／日落", "Sunrise / sunset")} ${first.sunrise.slice(11, 16)} / ${first.sunset.slice(11, 16)}` });
      if (forecast.hours.length) {
        const heading = body.createDiv({ cls: "qh-native-scope", text: L("未来八小时", "Next eight hours") });
        heading.id = `qh-hourly-${crypto.randomUUID()}`;
        const hours = body.createDiv({ cls: "qh-weather-hours" }); hours.setAttr("role", "list"); hours.setAttr("aria-labelledby", heading.id);
        for (const hour of forecast.hours) {
          const item = hours.createDiv({ cls: "qh-weather-hour" }); item.setAttr("role", "listitem");
          item.createSpan({ cls: "qh-weather-hour-time", text: hour.time.slice(11, 16) });
          const label = weatherLabel(hour.code);
          setIcon(item.createSpan({ cls: "qh-weather-icon" }), label.icon);
          item.createSpan({ cls: "qh-sr-only", text: label.text });
          item.createSpan({ cls: "qh-weather-temp", text: `${Math.round(hour.temperature)}°` });
          if (hour.rain !== null) item.createSpan({ cls: "qh-weather-hour-rain", text: `${Math.round(hour.rain)}%` });
        }
      }
      const days = body.createDiv({ cls: "qh-weather-days" });
      forecast.days.forEach((day, index) => {
        const label = weatherLabel(day.code);
        const row = days.createDiv({ cls: "qh-weather-day" });
        row.createSpan({ text: index === 0 ? L("今天", "Today") : index === 1 ? L("明天", "Tomorrow") : shortWeekday(day.day) });
        setIcon(row.createSpan({ cls: "qh-weather-icon" }), label.icon);
        row.createSpan({ text: label.text });
        row.createSpan({ cls: "qh-weather-temp", text: `${Math.round(day.min)}° / ${Math.round(day.max)}°${day.rain !== null ? ` · ${day.rain}%` : ""}` });
      });
      const credit = body.createEl("a", { cls: "qh-native-scope", text: L("天气数据：Open-Meteo.com", "Weather data by Open-Meteo.com"), href: "https://open-meteo.com/" });
      credit.setAttr("target", "_blank"); credit.setAttr("rel", "noopener noreferrer");
    });
    return;
  }

  if (id === "daily-quote") {
    const key = `${pageId}:${id}`;
    const paint = (quotes: string[], file: TFile | null) => {
      body.empty();
      if (!quotes.length) { message(L("这篇笔记里还没有可用的句子", "No lines to show in this note")); button(body, L("更换来源", "Change source"), configure, "settings-2"); return; }
      const index = dailyIndex(localDay(), quotes.length, offsets.get(key) ?? 0);
      body.createDiv({ cls: "qh-quote", text: quotes[index] });
      const actions = body.createDiv({ cls: "qh-workflow-actions" });
      button(actions, L("换一句", "Another"), () => { offsets.set(key, (offsets.get(key) ?? 0) + 1); paint(quotes, file); body.querySelector<HTMLButtonElement>(".qh-workflow-actions button")?.focus(); }, "shuffle");
      button(actions, L("复制", "Copy"), () => void navigator.clipboard.writeText(quotes[index]).then(() => new Notice(L("已复制", "Copied"))), "copy");
      if (file) button(actions, L("出处", "Source"), () => open(file), "arrow-up-right");
    };
    const file = noteSource();
    if (options.path && !file) { setup(L("摘录笔记已移动或不存在", "The quotes note is missing"), L("重新选择", "Choose again")); return; }
    if (!file) { paint(BUILTIN_QUOTES[isChinese() ? "zh" : "en"], null); return; }
    run(async () => { const quotes = parseQuotes(await app.vault.cachedRead(file)); if (card.isConnected) paint(quotes, file); });
    return;
  }

  if (id === "flashcards") {
    const file = noteSource();
    if (!file) { setup(options.path ? L("卡片笔记已移动或不存在", "The card note is missing") : L("选择一篇写有「问题 :: 答案」的笔记", "Choose a note with “question :: answer” lines"), L("选择笔记", "Choose note")); return; }
    const key = `${pageId}:${id}`;
    run(async () => {
      const cards = parseFlashcards(await app.vault.cachedRead(file));
      if (!card.isConnected) return;
      const paint = () => {
        body.empty();
        if (!cards.length) { message(L("这篇笔记没有「问题 :: 答案」格式的行", "No “question :: answer” lines in this note")); button(body, L("打开笔记", "Open note"), () => open(file), "arrow-up-right"); return; }
        const index = dailyIndex(localDay(), cards.length, offsets.get(key) ?? 0), item = cards[index];
        const shown = revealed.has(`${key}:${index}`);
        body.createDiv({ cls: "qh-native-scope", text: L("第 {v} / {length} 张", "Card {v} of {length}", { v: index + 1, length: cards.length }) });
        body.createDiv({ cls: "qh-flash-question", text: item.question });
        const answer = body.createDiv({ cls: "qh-flash-answer", text: shown ? item.answer : "" });
        answer.setAttr("aria-live", "polite");
        const actions = body.createDiv({ cls: "qh-workflow-actions" });
        // Keep keyboard focus inside the card as its buttons are rebuilt.
        const focusFirst = () => body.querySelector<HTMLButtonElement>(".qh-workflow-actions button")?.focus();
        if (!shown) button(actions, L("显示答案", "Show answer"), () => { revealed.add(`${key}:${index}`); paint(); focusFirst(); }, "eye", true);
        button(actions, L("下一张", "Next card"), () => { offsets.set(key, (offsets.get(key) ?? 0) + 1); paint(); focusFirst(); }, "arrow-right");
        button(actions, L("原文", "Source"), () => open(file, item.line), "arrow-up-right");
      };
      paint();
    });
    return;
  }

  if (id === "prompt-snippets") {
    const file = noteSource();
    if (!file) { setup(options.path ? L("片段笔记已移动或不存在", "The snippets note is missing") : L("选择一篇笔记，每个标题下的内容是一段片段", "Choose a note; each heading section becomes a snippet"), L("选择笔记", "Choose note")); return; }
    run(async () => {
      const snippets = parseSnippets(await app.vault.cachedRead(file));
      if (!card.isConnected) return; body.empty();
      if (!snippets.length) message(L("这篇笔记还没有「标题 + 正文」段落", "No heading sections in this note"));
      const agent = canAsk(app);
      for (const snippet of snippets.slice(0, options.limit)) {
        const row = body.createDiv({ cls: "qh-snippet-row" });
        const copy = row.createEl("button", { cls: "qh-workflow-row" });
        copy.createSpan({ cls: "qh-workflow-title", text: snippet.title });
        copy.createSpan({ cls: "qh-item-sub", text: snippet.body.split("\n").find(line => line.trim())?.slice(0, 80) ?? "" });
        copy.setAttr("aria-label", L("复制 {title}", "Copy {title}", { title: snippet.title }));
        copy.addEventListener("click", () => void navigator.clipboard.writeText(snippet.body).then(() => new Notice(L("已复制「{title}」", "Copied “{title}”", { title: snippet.title }))));
        if (agent) {
          const send = row.createEl("button", { cls: "qh-icon-button qh-item-action" });
          setIcon(send, "bot"); send.setAttr("aria-label", L("交给 Agent", "Send to Agent"));
          send.addEventListener("click", () => void askAgent(app, snippet.body).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))));
        }
      }
      button(body, L("编辑片段", "Edit snippets"), () => open(file), "pencil");
    });
    return;
  }

  if (id === "video-notes") {
    const url = input(L("粘贴 YouTube 或 B 站链接", "Paste a YouTube or Bilibili link"), L("视频链接", "Video link"), "url");
    const title = input(L("笔记标题（可选）", "Note title (optional)"), L("笔记标题", "Note title"));
    const actions = body.createDiv({ cls: "qh-workflow-actions" });
    const create: HTMLButtonElement = button(actions, L("创建视频笔记", "Create video note"), () => {
      const video = parseVideoUrl(url.value);
      if (!video) { new Notice(L("请粘贴完整的 YouTube 或 B 站视频链接", "Paste a full YouTube or Bilibili video link")); url.focus(); return; }
      create.disabled = true;
      void (async () => {
        const name = templateFileName(title.value.trim() || `${video.platform} ${video.id}`);
        const folder = options.folder || plugin.settings.createFolder || app.fileManager.getNewFileParent("").path;
        const path = normalizePath(`${folder && folder !== "/" ? `${folder}/` : ""}${name}`);
        if (path.split("/").includes("..") || path.startsWith(`${app.vault.configDir}/`)) throw new Error(L("请选择库内的普通笔记文件夹", "Choose a note folder inside the vault"));
        await ensureParent(app, path);
        const existing = app.vault.getAbstractFileByPath(path);
        const file = existing instanceof TFile ? existing : await app.vault.create(path, videoNote(video, localDay()));
        url.value = ""; title.value = "";
        await openFromHome(plugin, card, file);
      })().catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))).finally(() => { create.disabled = false; });
    }, "plus", true);
    if (canAsk(app)) button(actions, L("交给 Agent 总结", "Summarize with Agent"), () => {
      const video = parseVideoUrl(url.value);
      if (!video) { new Notice(L("请先粘贴视频链接", "Paste a video link first")); url.focus(); return; }
      void askAgent(app, L("请总结这个视频的要点，并按时间戳列出值得记住的片段：{url}", "Summarize this video and list memorable moments with timestamps: {url}", { url: video.url }));
    }, "bot");
    onEnter(url, () => create.click()); onEnter(title, () => create.click());
    if (options.folder) card.createDiv({ cls: "qh-native-scope", text: options.folder });
    return;
  }

  if (id === "calendar-next") {
    const file = noteSource();
    if (!file && !options.url) { setup(L("选择库里的 .ics 文件，或填写日历订阅地址", "Choose an .ics file in your vault or a calendar subscription URL"), L("设置日历", "Set calendar")); return; }
    run(async () => {
      const text = file ? await app.vault.cachedRead(file) : await fetchText(options.url!, 15 * 60000);
      const events = agenda(parseIcs(text), new Date(), 7, options.limit);
      if (!card.isConnected) return; body.empty();
      if (!events.length) message(L("未来 7 天没有安排", "Nothing in the next 7 days"));
      const today = localDay(), tomorrow = localDay(new Date(Date.now() + 86400000));
      let group = "";
      for (const event of events) {
        const day = localDay(event.start);
        if (day !== group) {
          group = day;
          body.createDiv({ cls: "qh-agenda-day", text: day === today ? L("今天", "Today") : day === tomorrow ? L("明天", "Tomorrow") : shortDate(event.start) });
        }
        const row = body.createDiv({ cls: "qh-agenda-row" });
        const time = (date: Date) => mo(date).format("HH:mm");
        row.createSpan({ cls: "qh-agenda-time", text: event.allDay ? L("全天", "All day") : `${time(event.start)}${event.end > event.start ? `–${time(event.end)}` : ""}` });
        const text = row.createDiv({ cls: "qh-agenda-text" });
        text.createDiv({ cls: "qh-workflow-title", text: event.title });
        if (event.location) text.createDiv({ cls: "qh-item-sub", text: event.location });
      }
      if (file) button(body, L("打开日历文件", "Open calendar file"), () => open(file), "arrow-up-right");
    });
    return;
  }

  if (id === "ambient-sound") {
    const player = plugin.ambient;
    const kinds: Array<[NoiseKind, string, string]> = /* i18n */ [["white", "白噪音", "White"], ["pink", "粉红噪音", "Pink"], ["brown", "棕噪音", "Brown"]];
    const paint = () => {
      body.empty();
      const choice = body.createDiv({ cls: "qh-discovery-sites" });
      choice.setAttr("role", "group"); choice.setAttr("aria-label", L("声音类型", "Sound type"));
      for (const [kind, zh, en] of kinds) {
        const option = choice.createEl("button", { cls: "qh-discovery-site", text: L(zh, en) });
        option.setAttr("aria-pressed", String(plugin.settings.ambient.kind === kind));
        option.addEventListener("click", () => {
          plugin.settings.ambient = { ...plugin.settings.ambient, kind };
          void plugin.saveSettings({ rerender: false }).catch(() => new Notice(t("layout.saveFailed")));
          if (player.playing) void player.play(kind, plugin.settings.ambient.volume); else paint();
        });
      }
      const controls = body.createDiv({ cls: "qh-workflow-actions" });
      const toggle = button(controls, player.playing ? L("停止", "Stop") : L("播放", "Play"), () => {
        if (player.playing) player.stop();
        else void player.play(plugin.settings.ambient.kind, plugin.settings.ambient.volume).catch(() => new Notice(L("无法播放声音", "Could not play sound")));
        // The card repaints on player changes; keep keyboard focus on the toggle.
        window.setTimeout(() => card.querySelector<HTMLButtonElement>(".qh-native-open.is-primary")?.focus());
      }, player.playing ? "square" : "play", true);
      toggle.setAttr("aria-pressed", String(player.playing));
      const volume = controls.createEl("input", { type: "range", cls: "qh-volume" });
      volume.min = "0"; volume.max = "1"; volume.step = "0.05"; volume.value = String(plugin.settings.ambient.volume);
      volume.setAttr("aria-label", L("音量", "Volume"));
      volume.addEventListener("input", () => player.setVolume(Number(volume.value)));
      volume.addEventListener("change", () => {
        plugin.settings.ambient = { ...plugin.settings.ambient, volume: Number(volume.value) };
        void plugin.saveSettings({ rerender: false }).catch(() => new Notice(t("layout.saveFailed")));
      });
      body.createDiv({ cls: "qh-native-scope", text: player.playing ? L("正在播放 · 关闭 Obsidian 或停用插件时停止", "Playing · stops when Obsidian closes") : L("本地生成，无需联网", "Generated locally, no network") });
    };
    const unsubscribe = player.onChange(() => { if (card.isConnected) paint(); else unsubscribe(); });
    paint();
    return;
  }

  if (id === "activity-heatmap") {
    const files = app.vault.getMarkdownFiles().filter(file => eligibleNote(file.path) && inFolder(file.path, options.folder));
    const today = new Date(), todayKey = localDay(today);
    const created = files.filter(file => localDay(new Date(file.stat.ctime)) === todayKey).length;
    const edited = files.filter(file => localDay(new Date(file.stat.mtime)) === todayKey).length;
    const year = activityDays(files.map(file => file.stat), 371, today);
    const streak = activityStreak(year);
    const tiles = body.createDiv({ cls: "qh-stat-tiles" });
    const tile = (value: string, label: string) => { const el = tiles.createDiv({ cls: "qh-stat-tile" }); el.createDiv({ cls: "qh-stat-value", text: value }); el.createDiv({ cls: "qh-stat-label", text: label }); };
    tile(String(created), L("今天新建", "created today"));
    tile(String(edited), L("今天编辑", "edited today"));
    tile(String(streak), L("连续记录天", "day streak"));
    const heat = body.createDiv({ cls: "qh-heat" });
    const dailyPaths = new Map<string, string>();
    void dailyOptions(app).then(config => {
      for (const day of year) {
        const name = mo(day.day, "YYYY-MM-DD").format(config.format || "YYYY-MM-DD");
        const path = normalizePath(`${config.folder ? `${config.folder.replace(/\/$/, "")}/` : ""}${name}.md`);
        if (app.vault.getAbstractFileByPath(path) instanceof TFile) dailyPaths.set(day.day, path);
      }
      if (card.isConnected) paint(true);
    }).catch(() => {});
    let columns = 0;
    const paint = (force = false) => {
      const width = heat.clientWidth || card.clientWidth - 40;
      const next = Math.max(8, Math.min(53, Math.floor((width - 22) / 15)));
      if (next === columns && !force) return;
      columns = next;
      heat.empty();
      const weekday = (today.getDay() + 6) % 7; // Monday = 0
      const shown = year.slice(-(columns - 1) * 7 - weekday - 1);
      const max = Math.max(1, ...shown.map(day => day.count));
      const active = shown.filter(day => day.count > 0).length;
      const months = heat.createDiv({ cls: "qh-heat-months" });
      months.style.gridTemplateColumns = `repeat(${columns}, 12px)`;
      let lastMonth = -1;
      for (let column = 0; column < columns; column++) {
        const first = shown[column * 7];
        const month = first ? Number(first.day.slice(5, 7)) : -1;
        months.createSpan({ text: first && month !== lastMonth && column < columns - 1 ? monthLabel(first.day) : "" });
        if (first) lastMonth = month;
      }
      const frame = heat.createDiv({ cls: "qh-heat-frame" });
      const days = frame.createDiv({ cls: "qh-heat-weekdays", attr: { "aria-hidden": "true" } });
      for (const label of weekdayLabels()) days.createSpan({ text: label });
      const grid = frame.createDiv({ cls: "qh-heatmap" });
      grid.style.gridTemplateColumns = `repeat(${columns}, 12px)`;
      grid.setAttr("role", "img");
      grid.setAttr("aria-label", L("最近 {columns} 周有 {active} 天在写，最多一天 {max} 篇", "{active} active days in {columns} weeks, up to {max} notes a day", { active, columns, max }));
      for (const day of shown) {
        const level = heatLevel(day.count, max);
        const path = dailyPaths.get(day.day);
        const cell = grid.createDiv({ cls: `qh-heat-cell qh-heat-${level}${day.day === todayKey ? " is-today" : ""}${path ? " has-note" : ""}` });
        setTooltip(cell, `${shortDate(day.day)} · ${day.count ? L("{count} 篇", "{count} notes", { count: day.count }) : L("没有记录", "No activity")}${path ? L(" · 点击打开日记", " · click to open") : ""}`, { delay: 150 });
        if (path) cell.addEventListener("click", () => { const file = app.vault.getAbstractFileByPath(path); if (file instanceof TFile) open(file); });
      }
      const foot = heat.createDiv({ cls: "qh-heat-foot" });
      foot.createSpan({ text: L("近 {columns} 周 · 活跃 {active} 天", "{columns} weeks · {active} active days", { columns, active }) });
      const legend = foot.createDiv({ cls: "qh-heat-legend", attr: { "aria-hidden": "true" } });
      legend.createSpan({ text: L("少", "Less") });
      for (let level = 0; level <= 4; level++) legend.createDiv({ cls: `qh-heat-cell qh-heat-${level}` });
      legend.createSpan({ text: L("多", "More") });
    };
    const observer = new ResizeObserver(() => { if (!card.isConnected) { observer.disconnect(); return; } paint(); });
    observer.observe(heat);
    paint();
    if (options.folder) card.createDiv({ cls: "qh-native-scope", text: options.folder });
    return;
  }
}

// Settings ---------------------------------------------------------------------

export class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(private plugin: QiaomuHomePlugin, private extensions: string[], private choose: (file: TFile) => void) { super(plugin.app); }
  getItems(): TFile[] { return this.plugin.app.vault.getFiles().filter(file => this.extensions.includes(file.extension.toLowerCase())); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.choose(file); }
}

export class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(private plugin: QiaomuHomePlugin, private choose: (folder: TFolder) => void) { super(plugin.app); this.setPlaceholder(L("输入文件夹名称…", "Type a folder name…")); }
  getItems(): TFolder[] {
    const config = this.plugin.app.vault.configDir;
    return this.plugin.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && file.path !== config && !file.path.startsWith(`${config}/`))
      .sort((a, b) => (a.isRoot() ? -1 : b.isRoot() ? 1 : a.path.localeCompare(b.path)));
  }
  getItemText(folder: TFolder): string { return folder.isRoot() ? "/" : folder.path; }
  onChooseItem(folder: TFolder): void { this.choose(folder); }
}

/** A folder setting that scales to large vaults: searchable picker plus a one-click reset to the default. */
export function folderDropdown(contentEl: HTMLElement, plugin: QiaomuHomePlugin, name: string, empty: string, value: string, save: (value: string) => void): Setting {
  const setting = new Setting(contentEl).setName(name);
  const describe = (current: string) => {
    setting.descEl.empty();
    const chip = setting.descEl.createSpan({ cls: "qh-path-chip" });
    setIcon(chip.createSpan(), current ? "folder" : "folder-open");
    chip.createSpan({ text: current || empty });
  };
  let current = value;
  describe(current);
  setting.addButton(button => button.setButtonText(L("选择文件夹", "Choose folder")).onClick(() => new FolderPicker(plugin, folder => {
    current = folder.isRoot() ? "" : folder.path; describe(current); save(current);
  }).open()));
  setting.addExtraButton(button => button.setIcon("rotate-ccw").setTooltip(L("恢复默认", "Reset to default")).onClick(() => { current = ""; describe(current); save(""); }));
  return setting;
}

type Persist = (change: Partial<ModuleOptions>) => Promise<boolean | undefined>;
export function renderExtraOptions(contentEl: HTMLElement, plugin: QiaomuHomePlugin, pageId: string, id: ExtraId, persist: Persist): void {
  const options = moduleOptions(plugin.settings, id, pageId);
  const current = () => moduleOptions(plugin.settings, id, pageId);
  /** Applies a change to global settings and rolls it back if saving fails; errors surface in the field. */
  const commitGlobal = async (apply: () => void) => {
    const snapshot = structuredClone(plugin.settings);
    apply();
    try { await plugin.saveSettings(); } catch (error) { Object.assign(plugin.settings, snapshot); throw error; }
  };
  const saveGlobal = async (apply: () => void, undo: () => void) => {
    apply();
    try { await plugin.saveSettings(); } catch { undo(); new Notice(t("layout.saveFailed")); }
  };
  const notePicker = (name: string, extensions: string[], desc: string, optional = false) => {
    const setting = new Setting(contentEl).setName(name);
    const describe = (path: string | undefined) => {
      setting.descEl.empty();
      if (path) { const chip = setting.descEl.createSpan({ cls: "qh-path-chip" }); setIcon(chip.createSpan(), "file-text"); chip.createSpan({ text: path }); }
      setting.descEl.createDiv({ text: desc });
    };
    describe(options.path);
    setting.addButton(button => button.setButtonText(options.path ? L("更换", "Change") : L("选择文件", "Choose file")).onClick(() => new FilePicker(plugin, extensions, file => {
      void persist({ path: file.path }).then(() => { describe(current().path); button.setButtonText(L("更换", "Change")); });
    }).open()));
    if (optional) setting.addExtraButton(button => button.setIcon("x").setTooltip(L("清除", "Clear")).onClick(() => {
      void persist({ path: undefined }).then(() => describe(undefined));
    }));
  };
  const count = () => new Setting(contentEl).setName(t("layout.count")).addDropdown(dropdown => dropdown
    .addOptions(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])))
    .setValue(String(current().limit)).onChange(value => { void persist({ limit: Number(value) }); }));

  if (id === "quick-capture") {
    new Setting(contentEl).setName(L("记录格式", "Line format")).setDesc(L("与搜索框 ⇧↵ 共用。", "Shared with ⇧↵ in the search box."))
      .addDropdown(dropdown => dropdown.addOptions({ plain: L("普通列表 - 内容", "List item - text"), time: L("带时间 - 14:30 内容", "With time - 14:30 text"), task: L("待办 - [ ] 内容", "Task - [ ] text") })
        .setValue(plugin.settings.captureFormat).onChange(value => {
          const previous = plugin.settings.captureFormat;
          void saveGlobal(() => { plugin.settings.captureFormat = value as "plain" | "time" | "task"; }, () => { plugin.settings.captureFormat = previous; });
        }));
    new Setting(contentEl).setName(L("写入位置", "Save to")).setDesc(L("与首页搜索框的「记下」共用这个设置。", "Shared with capture from the Home search box."))
      .addDropdown(dropdown => dropdown.addOptions({ inbox: L("收件箱笔记", "Inbox note"), daily: L("今日日记", "Today's daily note") })
        .setValue(plugin.settings.captureTarget).onChange(value => {
          const previous = plugin.settings.captureTarget;
          void saveGlobal(() => { plugin.settings.captureTarget = value as "inbox" | "daily"; }, () => { plugin.settings.captureTarget = previous; });
        }));
    const inbox = new Setting(contentEl).setName(L("收件箱笔记", "Inbox note")).setDesc(L("库内 Markdown 路径，例如 Inbox.md 或 Inbox/速记.md。", "A Markdown path in the vault, e.g. Inbox.md."));
    inbox.addText(input => { input.setValue(plugin.settings.captureInboxPath);
      autoSave(contentEl, inbox, input.inputEl, value => {
        const next = value.trim();
        if (!next.toLowerCase().endsWith(".md") || next.startsWith("/") || next.split("/").includes("..")) throw new Error(t("capture.badPath"));
        return commitGlobal(() => { plugin.settings.captureInboxPath = next; });
      });
      inbox.addButton(button => button.setButtonText(L("选择", "Choose")).onClick(() => new FilePicker(plugin, ["md"], file => { input.setValue(file.path); input.inputEl.dispatchEvent(new Event("change")); }).open()));
    });
    return;
  }
  if (id === "weekly-review") {
    let week: WeekPaths | null = null;
    try { week = weeklyNote(plugin, options); } catch { /* shown below */ }
    if (week?.periodic) { contentEl.createEl("p", { text: L("正在使用 Periodic Notes 的周记设置：{path}", "Using Periodic Notes weekly settings: {path}", { path: week.path }) }); count(); return; }
    folderDropdown(contentEl, plugin, L("周记文件夹", "Weekly note folder"), defaultFolderLabel(plugin), options.folder ?? "", value => { void persist({ folder: value }); });
    const preview = new Setting(contentEl).setName(L("文件名格式", "File name format"));
    const sample = preview.descEl.createDiv({ text: `${L("本周", "This week")}：${mo().format(options.format ?? "gggg-[W]ww")}.md` });
    preview.addText(input => { input.inputEl.placeholder = SYNTAX_EXAMPLES.weekly; input.setValue(options.format ?? "gggg-[W]ww");
      input.inputEl.addEventListener("input", () => sample.setText(`${L("本周", "This week")}：${mo().format(input.getValue() || "gggg-[W]ww")}.md`));
      autoSave(contentEl, preview, input.inputEl, value => {
        if (/[\\:*?"<>|]/.test(mo().format(value || "gggg-[W]ww"))) throw new Error(L("格式会生成无效的文件名", "This format produces an invalid file name"));
        return persist({ format: value.trim() || undefined });
      }); });
    notePicker(L("周记模板（可选）", "Template (optional)"), ["md"], L("未选择时使用简洁的三段式结构", "Without one, a simple three-part outline is used"), true);
    count(); return;
  }
  if (id === "day-progress") {
    const hours = new Setting(contentEl).setName(L("工作时段", "Work hours")).setDesc(L("开始 — 结束，改完即保存。", "Start — end; saved as you change them."));
    const check = (start: string, end: string) => {
      const from = clockMinutes(start), to = clockMinutes(end);
      if (from === null || to === null || to <= from) throw new Error(L("结束时间需晚于开始时间", "End must be later than start"));
    };
    hours.addText(input => { input.inputEl.type = "time"; input.setValue(options.start ?? "09:00");
      autoSave(contentEl, hours, input.inputEl, value => { check(value, current().end ?? "18:00"); return persist({ start: value }); }); });
    hours.addText(input => { input.inputEl.type = "time"; input.setValue(options.end ?? "18:00");
      autoSave(contentEl, hours, input.inputEl, value => { check(current().start ?? "09:00", value); return persist({ end: value }); }); });
    return;
  }
  if (id === "world-clock") {
    const zones = new Setting(contentEl).setName(L("城市与时区", "Cities and time zones"))
      .setDesc(L("每行一个，最多八个：名称 | 时区，例如 东京 | Asia/Tokyo。离开输入框或按 ⌘↵ 保存。", "One per line, up to eight: Name | Zone, e.g. Tokyo | Asia/Tokyo. Saves when you leave the field or press ⌘↵."));
    zones.addTextArea(input => { input.inputEl.rows = 5; input.setValue(zoneLines(options.zones?.length ? options.zones : defaultZones(isChinese())));
      autoSave(contentEl, zones, input.inputEl, value => persist({ zones: parseZones(value) })); });
    return;
  }
  if (id === "weather") {
    contentEl.createEl("p", { cls: "qh-native-scope", text: L("中国城市与区县优先本地查找，支持简称、全称和拼音；其他地点向 Open-Meteo 查询。天气只发送坐标，缓存 30 分钟。", "Chinese cities and counties are searched locally by short name, full name or pinyin; other locations use Open-Meteo. Weather requests send only coordinates and are cached for 30 minutes.") });
    const chosen = new Setting(contentEl).setName(L("当前城市", "Current city")).setDesc(options.location?.name ?? L("尚未选择", "Not selected"));
    let query = options.location?.name ?? "", countryCode = options.countryCode ?? "", generation = 0, selectionGeneration = 0;
    const results = contentEl.createDiv({ cls: "qh-option-results" }); results.setAttr("aria-live", "polite");
    const invalidate = () => { generation++; results.empty(); };
    const choose = async (location: NonNullable<ModuleOptions["location"]>) => {
      invalidate();
      const token = generation, selection = ++selectionGeneration;
      const ok = await persist({ location });
      if (ok && selection === selectionGeneration && contentEl.isConnected) {
        chosen.setDesc(location.name);
        if (token === generation) results.empty();
      }
      return ok;
    };
    const search = async () => {
      const token = ++generation;
      results.empty();
      if (!query.trim()) return;
      results.setText(L("正在查找…", "Searching…"));
      try {
        const places = await searchWeatherPlaces(query, countryCode, currentLanguage(), url => fetchText(url, 3600000));
        if (token !== generation || !contentEl.isConnected) return;
        results.empty();
        if (!places.length) { results.setText(L("没有找到这个地点。试试完整名称、调整国家／地区，或手动填写坐标。", "No matching location. Try its full name, change the country / region, or enter coordinates manually.")); return; }
        for (const place of places) new Setting(results).setName(place.name).setDesc(place.detail).addButton(button => button.setButtonText(L("使用", "Use")).onClick(() => {
          void choose({ name: place.name, latitude: place.latitude, longitude: place.longitude });
        }));
      } catch {
        if (token === generation && contentEl.isConnected) results.setText(L("查找失败，请检查网络后重试", "Search failed; check your connection"));
      }
    };
    const names = new Intl.DisplayNames([dateLocale()], { type: "region" });
    const countries: Record<string, string> = {};
    const regions = WEATHER_COUNTRIES.map(code => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, dateLocale()));
    for (const region of regions) countries[region.code] = region.name;
    new Setting(contentEl).setName(L("国家／地区", "Country / region")).addDropdown(dropdown => dropdown.addOptions({ "": L("所有国家和地区", "All countries and regions"), ...countries })
      .setValue(countryCode).onChange(value => {
        countryCode = value; invalidate();
        void persist({ countryCode: value });
        if (query.trim()) void search();
      }));
    new Setting(contentEl).setName(L("查找城市", "Find a city"))
      .addText(input => { input.setValue(query).setPlaceholder(L("例如：温州、浙江省温州市、Wenzhou", "e.g. Wenzhou, Paris or Tokyo")).onChange(value => { query = value; invalidate(); }); onEnterSetting(input.inputEl, () => void search()); })
      .addButton(button => button.setButtonText(L("查找", "Search")).onClick(() => void search()));
    contentEl.appendChild(results);
    const manual = contentEl.createEl("details", { cls: "qh-weather-manual" });
    manual.createEl("summary", { text: L("手动填写位置", "Enter location manually") });
    let manualName = options.location?.name ?? "", latitude = options.location ? String(options.location.latitude) : "", longitude = options.location ? String(options.location.longitude) : "";
    new Setting(manual).setName(L("位置名称", "Location name")).addText(input => input.setValue(manualName).onChange(value => { manualName = value; }));
    new Setting(manual).setName(L("纬度", "Latitude")).addText(input => input.setValue(latitude).setPlaceholder("-90 … 90").onChange(value => { latitude = value; }));
    new Setting(manual).setName(L("经度", "Longitude")).addText(input => input.setValue(longitude).setPlaceholder("-180 … 180").onChange(value => { longitude = value; }));
    const status = manual.createDiv({ cls: "qh-native-scope" }); status.setAttr("aria-live", "polite");
    new Setting(manual).addButton(button => button.setButtonText(L("使用此位置", "Use this location")).onClick(() => {
      const location = coordinateLocation(manualName, latitude, longitude);
      if (!location) { status.setText(L("请填写名称和有效坐标：纬度 −90 至 90，经度 −180 至 180。", "Enter a name and valid coordinates: latitude −90 to 90, longitude −180 to 180.")); return; }
      void choose(location).then(ok => { if (contentEl.isConnected) status.setText(ok ? L("已保存", "Saved") : t("layout.saveFailed")); });
    }));
    const credit = contentEl.createEl("a", { cls: "qh-native-scope", text: L("地点数据：GeoNames · CC BY 4.0", "Location data: GeoNames · CC BY 4.0"), href: "https://www.geonames.org/" });
    credit.setAttr("target", "_blank"); credit.setAttr("rel", "noopener noreferrer");
    new Setting(contentEl).setName(L("温度单位", "Temperature unit")).addDropdown(dropdown => dropdown.addOptions({ c: "°C", f: "°F" }).setValue(options.unit ?? "c").onChange(value => { void persist({ unit: value as "c" | "f" }); }));
    return;
  }
  if (id === "daily-quote") {
    notePicker(L("摘录笔记（可选）", "Quotes note (optional)"), ["md"], L("未选择时使用内置的经典语句；选择后每行、列表项或引用是一句。", "Without one, built-in classics are used. Each line, list item or quote is one entry."), true);
    return;
  }
  if (id === "flashcards") {
    notePicker(L("卡片笔记", "Card note"), ["md"], L("每行一张：问题 :: 答案", "One per line: question :: answer"));
    contentEl.createEl("p", { cls: "qh-native-scope", text: L("每天固定一张起始卡片；与 Spaced Repetition 插件的单行卡片格式兼容，但不会修改复习记录。", "Each day starts on the same card. Compatible with Spaced Repetition single-line cards; review history is never changed.") });
    return;
  }
  if (id === "prompt-snippets") {
    notePicker(L("片段笔记", "Snippets note"), ["md"], L("每个标题下的正文是一段片段", "Each heading's section is one snippet"));
    count(); return;
  }
  if (id === "video-notes") {
    folderDropdown(contentEl, plugin, L("保存到文件夹", "Save to folder"), defaultFolderLabel(plugin), options.folder ?? "", value => { void persist({ folder: value }); });
    contentEl.createEl("p", { cls: "qh-native-scope", text: L("只保存链接和笔记结构，不下载视频或字幕。已安装 Qiaomu Agent 时可一键请它总结。", "Only the link and outline are saved; nothing is downloaded. With Qiaomu Agent you can ask it to summarize.") });
    return;
  }
  if (id === "calendar-next") {
    notePicker(L("库中的 .ics 文件", ".ics file in vault"), ["ics"], L("优先使用本地文件", "A local file takes priority"), true);
    const subscription = new Setting(contentEl).setName(L("或订阅地址", "Or subscription URL")).setDesc(L("支持 https:// 与 webcal://。地址可能包含私密令牌，只保存在本插件设置中；每 15 分钟最多请求一次。", "https:// or webcal://. The URL may contain a private token and stays in this plugin's settings; fetched at most every 15 minutes."));
    subscription.addText(input => { input.inputEl.type = "url"; input.setPlaceholder("https://…/basic.ics").setValue(options.url ?? "");
      autoSave(contentEl, subscription, input.inputEl, value => {
        if (!value.trim()) return persist({ url: undefined });
        const valid = calendarUrl(value);
        if (!valid) throw new Error(L("请输入有效的 https 或 webcal 地址", "Enter a valid https or webcal URL"));
        return persist({ url: valid });
      }); });
    contentEl.createEl("p", { cls: "qh-native-scope", text: L("支持单次与每日/每周/每月/每年重复的日程；带时区的时间按本机时间显示。", "Supports single and daily/weekly/monthly/yearly repeating events; zoned times are shown as local time.") });
    count(); return;
  }
  if (id === "activity-heatmap") {
    folderDropdown(contentEl, plugin, L("统计范围", "Scope"), L("整个知识库", "Whole vault"), options.folder ?? "", value => { void persist({ folder: value }); });
    contentEl.createEl("p", { cls: "qh-native-scope", text: L("根据文件的创建和最后修改时间统计，一篇笔记每天只计一次。", "Based on file creation and last-modified times; each note counts once per day.") });
    return;
  }
  contentEl.createEl("p", { text: L("声音在本机实时生成，不下载任何音频。直接在卡片上切换类型和音量。", "Sound is generated on this device. Switch type and volume on the card.") });
}

export function defaultFolderLabel(plugin: QiaomuHomePlugin): string {
  return plugin.settings.createFolder ? L("默认：{createFolder}", "Default: {createFolder}", { createFolder: plugin.settings.createFolder }) : L("默认：Obsidian 新笔记位置", "Default: Obsidian's new-note location");
}

function onEnterSetting(el: HTMLInputElement, action: () => void): void {
  el.addEventListener("keydown", event => { if (event.key === "Enter" && !isComposingKey(event)) { event.preventDefault(); action(); } });
}
