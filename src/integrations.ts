import { openFromHome } from "./open";
import { Notice, TFile, setIcon, type App } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { cardAction, fieldRow } from "./card-ui";
import { installState, openCommunityPluginSettings, openPluginPage, runCommand, type InstallState } from "./ecosystem";
import { L } from "./i18n";
import { moduleOptions, type ModuleOptions } from "./settings";
import { INTEGRATIONS, type IntegrationId } from "./integration-catalog";
export { INTEGRATIONS, isIntegration, type IntegrationId } from "./integration-catalog";


interface PluginHost { plugins?: { plugins?: Record<string, unknown> } }
function pluginInstance<T>(app: App, id: string): T | null {
  return ((app as unknown as PluginHost).plugins?.plugins?.[id] as T | undefined) ?? null;
}

/**
 * Explains a missing or disabled plugin and offers the next step. Used for integrations and Qiaomu family plugins.
 * `absent` opens the plugin's page in Obsidian's community browser, where the user decides to install.
 */
export function renderPluginGuide(parent: HTMLElement, app: App, options: { pluginId: string; pluginName: string; pitch: string; state: InstallState; repo?: string }): void {
  const guide = parent.createDiv({ cls: "qh-plugin-guide" });
  guide.createDiv({ cls: "qh-plugin-guide-pitch", text: options.pitch });
  const status = guide.createDiv({ cls: "qh-plugin-guide-status" });
  setIcon(status.createSpan(), options.state === "disabled" ? "power" : "package");
  status.createSpan({ text: options.state === "disabled"
    ? L("已安装 {pluginName}，尚未启用", "{pluginName} is installed but off", { pluginName: options.pluginName })
    : L("需要 {pluginName} 插件（免费）", "Uses the free {pluginName} plugin", { pluginName: options.pluginName }) });
  const actions = guide.createDiv({ cls: "qh-workflow-actions" });
  if (options.state === "disabled") cardAction(actions, L("去启用", "Turn it on"), () => openCommunityPluginSettings(app), "power", true);
  else cardAction(actions, L("安装 {pluginName}", "Install {pluginName}", { pluginName: options.pluginName }), () => openPluginPage(options.pluginId), "download", true);
  if (options.repo) cardAction(actions, L("了解更多", "Learn more"), () => window.open(options.repo, "_blank", "noopener,noreferrer"), "arrow-up-right");
  guide.createDiv({ cls: "qh-native-scope", text: L("装好后这张卡片会自动更新", "This card updates once it is ready") });
}

interface QuickAddChoice { id?: string; name?: string; type?: string; choices?: QuickAddChoice[] }
export function quickAddChoices(choices: unknown): Array<{ name: string; type: string }> {
  const result: Array<{ name: string; type: string }> = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items as QuickAddChoice[]) {
      if (!item || typeof item.name !== "string") continue;
      if (item.type === "Multi") walk(item.choices);
      else result.push({ name: item.name, type: typeof item.type === "string" ? item.type : "" });
    }
  };
  walk(choices);
  return result;
}

/** Board lanes are `##` headings and cards are list items, as written by the Kanban plugin. */
export function kanbanSummary(markdown: string): { lanes: number; cards: number; open: number } {
  let lanes = 0, cards = 0, open = 0, fence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || /^%%/.test(line)) continue;
    if (/^##\s+\S/.test(line)) lanes++;
    else if (/^[-*]\s+\[( |x|X)\]\s/.test(line)) { cards++; if (/^[-*]\s+\[ \]/.test(line)) open++; }
  }
  return { lanes, cards, open };
}

export function renderIntegration(parent: HTMLElement, plugin: QiaomuHomePlugin, id: IntegrationId, pageId: string): void {
  const app = plugin.app, config = INTEGRATIONS[id], options = moduleOptions(plugin.settings, id, pageId);
  const card = parent.createDiv({ cls: "qh-card" }); card.dataset.module = id;
  const head = card.createDiv({ cls: "qh-card-head" });
  setIcon(head.createSpan({ cls: "qh-card-icon" }), config.icon);
  head.createSpan({ cls: "qh-card-title", text: L(config.zh, config.en) });
  const state = installState(app, config.plugin);
  if (state !== "enabled") { renderPluginGuide(card, app, { pluginId: config.plugin, pluginName: config.pluginName, pitch: L(config.description, config.descriptionEn), state, repo: config.repo }); return; }
  const body = card.createDiv({ cls: "qh-native-preview" });
  const message = (text: string) => body.createDiv({ cls: "qh-card-empty", text });
  const open = (file: TFile) => void openFromHome(plugin, card, file);
  const row = (title: string, sub: string, run: () => void, icon = "file-text") => {
    const button = body.createEl("button", { cls: "qh-list-row" });
    setIcon(button.createSpan({ cls: "qh-list-row-icon" }), icon);
    const text = button.createSpan({ cls: "qh-list-row-text" });
    text.createSpan({ cls: "qh-workflow-title", text: title });
    if (sub) text.createSpan({ cls: "qh-item-sub", text: sub });
    button.addEventListener("click", run);
  };
  const command = (ids: string[]) => { for (const commandId of ids) if (runCommand(app, commandId)) return true; new Notice(L("{pluginName} 的这个命令不可用，请更新插件", "This {pluginName} command is unavailable; update the plugin", { pluginName: config.pluginName })); return false; };
  const recentFiles = (match: (file: TFile) => boolean) => app.vault.getFiles().filter(match).sort((a, b) => b.stat.mtime - a.stat.mtime);

  if (id === "quickadd-actions") {
    const quickAdd = pluginInstance<{ settings?: { choices?: unknown }; api?: { executeChoice?(name: string): Promise<void> } }>(app, "quickadd");
    const choices = quickAddChoices(quickAdd?.settings?.choices);
    if (!choices.length) { message(L("还没有 QuickAdd 动作，先在 QuickAdd 设置里添加一个", "No QuickAdd choices yet; add one in QuickAdd settings")); cardAction(body, L("打开 QuickAdd", "Open QuickAdd"), () => command(["quickadd:runQuickAdd"]), "zap", true); return; }
    const icons: Record<string, string> = { Template: "file-plus-2", Capture: "pencil-line", Macro: "workflow" };
    const list = body.createDiv({ cls: "qh-discovery-sites" });
    for (const choice of choices.slice(0, Math.max(options.limit, 6))) {
      const chip = list.createEl("button", { cls: "qh-discovery-site" });
      setIcon(chip.createSpan(), icons[choice.type] ?? "zap");
      chip.createSpan({ text: choice.name });
      chip.addEventListener("click", () => {
        if (typeof quickAdd?.api?.executeChoice !== "function") { command(["quickadd:runQuickAdd"]); return; }
        void quickAdd.api.executeChoice(choice.name).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
      });
    }
    return;
  }

  if (id === "dataview-query") {
    const dataview = pluginInstance<{ api?: DataviewApiLike }>(app, "dataview")?.api;
    if (!dataview) { message(L("Dataview 还在建立索引，稍后刷新", "Dataview is still indexing")); return; }
    const query = dataviewQuery(options);
    if (query.render === "native") {
      if (typeof dataview.execute !== "function") { message(L("请把 Dataview 插件更新到新版本", "Update the Dataview plugin to a newer version")); return; }
      const host = body.createDiv({ cls: "qh-dataview" });
      // Dataview renders a live-updating view and cleans up when the card DOM is removed.
      void Promise.resolve(dataview.execute(query.source, host, plugin, "")).catch(() => {
        if (card.isConnected) { host.empty(); host.createDiv({ cls: "qh-card-empty", text: L("查询失败", "Query failed") }); }
      });
      return;
    }
    const results = body.createDiv({ cls: "qh-native-preview" });
    results.createDiv({ cls: "qh-card-empty", text: L("正在查询…", "Running…") });
    void Promise.resolve(dataview.query?.(query.source)).then(result => {
      if (!card.isConnected) return; results.empty();
      if (!result) { results.createDiv({ cls: "qh-card-empty", text: L("Dataview 还在建立索引，稍后刷新", "Dataview is still indexing") }); return; }
      if (!result.successful || !result.value) { results.createDiv({ cls: "qh-card-empty", text: L("查询出错：{v}", "Query error: {v}", { v: result.error ?? "" }) }); return; }
      const rows = (result.value.values ?? []).slice(0, options.limit);
      if (!rows.length) results.createDiv({ cls: "qh-card-empty", text: L("没有结果", "No results") });
      for (const value of rows) {
        const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
        const rest = Array.isArray(value) ? (value as unknown[]).slice(1).map(dataviewText).filter(Boolean).join(" · ") : "";
        const path = typeof first === "object" && first && "path" in first ? String((first).path) : "";
        const file = path ? app.metadataCache.getFirstLinkpathDest(path, "") : null;
        const target = results.createEl(file ? "button" : "div", { cls: file ? "qh-list-row" : "qh-native-line" });
        if (file) { setIcon(target.createSpan({ cls: "qh-list-row-icon" }), "file-text"); target.addEventListener("click", () => open(file)); }
        const text = target.createSpan({ cls: "qh-list-row-text" });
        text.createSpan({ cls: "qh-workflow-title", text: file ? file.basename : dataviewText(first) });
        if (rest) text.createSpan({ cls: "qh-item-sub", text: rest.slice(0, 120) });
      }
    }).catch(() => { if (card.isConnected) { results.empty(); results.createDiv({ cls: "qh-card-empty", text: L("查询失败", "Query failed") }); } });
    return;
  }

  if (id === "kanban-boards") {
    const boards = recentFiles(file => file.extension === "md" && app.metadataCache.getFileCache(file)?.frontmatter?.["kanban-plugin"] !== undefined);
    if (!boards.length) message(L("还没有看板", "No boards yet"));
    const shown = boards.slice(0, options.limit);
    void Promise.all(shown.map(file => app.vault.cachedRead(file).then(kanbanSummary))).then(summaries => {
      if (!card.isConnected) return;
      shown.forEach((file, index) => {
        const summary = summaries[index];
        row(file.basename, L("{lanes} 列 · {open} 张未完成", "{lanes} lanes · {open} open", { lanes: summary.lanes, open: summary.open }), () => open(file), "columns-3");
      });
      cardAction(body, L("新建看板", "New board"), () => command(["obsidian-kanban:create-new-kanban-board"]), "plus", !boards.length);
    });
    return;
  }

  if (id === "excalidraw-drawings") {
    const drawings = recentFiles(file => file.extension === "excalidraw" || file.path.endsWith(".excalidraw.md") ||
      (file.extension === "md" && app.metadataCache.getFileCache(file)?.frontmatter?.["excalidraw-plugin"] !== undefined));
    if (!drawings.length) message(L("还没有绘图", "No drawings yet"));
    for (const file of drawings.slice(0, options.limit)) row(file.basename.replace(/\.excalidraw$/, ""), file.parent && !file.parent.isRoot() ? file.parent.path : "", () => open(file), "pen-tool");
    cardAction(body, L("新建绘图", "New drawing"), () => command(["obsidian-excalidraw-plugin:excalidraw-autocreate-newtab", "obsidian-excalidraw-plugin:excalidraw-autocreate"]), "plus", !drawings.length);
    return;
  }

  if (id === "spaced-review") {
    const tag = "#flashcards";
    const decks = app.vault.getMarkdownFiles().filter(file => {
      const cache = app.metadataCache.getFileCache(file);
      return (cache?.tags ?? []).some(entry => entry.tag.startsWith(tag)) || [cache?.frontmatter?.tags].flat().some(value => typeof value === "string" && `#${value.replace(/^#/, "")}`.startsWith(tag));
    });
    body.createDiv({ cls: "qh-native-line", text: decks.length ? L("{length} 篇笔记含 {tag} 卡片", "{length} notes with {tag} cards", { length: decks.length, tag }) : L("给笔记加上 {tag} 标签即可制卡", "Tag notes with {tag} to create cards", { tag }) });
    const actions = body.createDiv({ cls: "qh-workflow-actions" });
    cardAction(actions, L("复习卡片", "Review cards"), () => command(["obsidian-spaced-repetition:srs-review-flashcards"]), "layers", true);
    cardAction(actions, L("复习笔记", "Review notes"), () => command(["obsidian-spaced-repetition:srs-note-review-open-note"]), "file-text");
    cardAction(actions, L("复习队列", "Review queue"), () => command(["obsidian-spaced-repetition:srs-open-review-queue-view"]), "list");
    return;
  }

  if (id === "omnisearch") {
    const api = pluginInstance<{ api?: { search?(query: string): Promise<Array<{ path: string; basename: string; excerpt?: string }>> } }>(app, "omnisearch")?.api;
    const results = createDiv({ cls: "qh-native-preview" });
    let generation = 0;
    const { input } = fieldRow(body, { type: "search", placeholder: L("搜索正文…", "Search note contents…"), label: L("全文搜索", "Full-text search"), icon: "search", action: L("搜索", "Search"), onSubmit: () => {
      const query = input.value.trim(); if (!query) return;
      const current = ++generation;
      results.empty(); results.createDiv({ cls: "qh-card-empty", text: L("正在搜索…", "Searching…") });
      void Promise.resolve(api?.search?.(query)).then(found => {
        if (current !== generation || !card.isConnected) return;
        results.empty();
        if (!found?.length) { results.createDiv({ cls: "qh-card-empty", text: L("没有找到", "No matches") }); return; }
        for (const item of found.slice(0, options.limit)) {
          const file = app.vault.getAbstractFileByPath(item.path);
          if (!(file instanceof TFile)) continue;
          const button = results.createEl("button", { cls: "qh-list-row" });
          setIcon(button.createSpan({ cls: "qh-list-row-icon" }), "file-text");
          const text = button.createSpan({ cls: "qh-list-row-text" });
          text.createSpan({ cls: "qh-workflow-title", text: item.basename });
          if (item.excerpt) text.createSpan({ cls: "qh-item-sub", text: item.excerpt.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 110) });
          button.addEventListener("click", () => open(file));
        }
      }).catch(() => { if (current === generation && card.isConnected) { results.empty(); results.createDiv({ cls: "qh-card-empty", text: L("搜索失败", "Search failed") }); } });
    } });
    body.appendChild(results);
    return;
  }
}

interface DataviewApiLike {
  query?(source: string): Promise<{ successful: boolean; value?: { type: string; values?: unknown[] }; error?: string }>;
  /** Renders a live-updating dataview view; component owns the lifecycle and cleans up when container is removed. */
  execute?(source: string, container: HTMLElement, component: unknown, filePath: string): Promise<void>;
}

/** Compose a beginner-safe DQL query from GUI options; users never see the syntax. */
export function dataviewQuery(options: ModuleOptions): { render: "rows" | "native"; source: string } {
  const value = (options.sourceValue ?? "").trim().replace(/^#/, "").replace(/^"|"$/g, "");
  const scope = options.sourceKind === "tag" && value ? `FROM #${value}` : options.sourceKind === "folder" && value ? `FROM "${value}"` : 'FROM ""';
  const order = options.sortBy === "name" ? "file.name ASC" : options.sortBy === "ctime" ? "file.ctime DESC" : "file.mtime DESC";
  const limit = Math.min(6, Math.max(1, Math.floor(options.limit)));
  const fields = [...new Set((options.fields ?? "").split(/[,，、]/).map(field => field.trim()).filter(Boolean))].slice(0, 4);
  if (options.view === "tasks") return { render: "native", source: `TASK ${scope} ${options.onlyOpen ?? true ? "WHERE !completed " : ""}SORT ${order} LIMIT ${limit}` };
  if (options.view === "table" && fields.length) return { render: "native", source: `TABLE ${fields.join(", ")} ${scope} SORT ${order} LIMIT ${limit}` };
  return { render: "rows", source: `LIST ${scope} SORT ${order} LIMIT ${limit}` };
}

function dataviewText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const link = value as { path?: unknown; display?: unknown };
    if (typeof link.path === "string") return (typeof link.display === "string" ? link.display : link.path).split("/").pop()!.replace(/\.md$/, "");
    // Dataview dates, durations and arrays all implement a readable toString.
    const text = (value as { toString(): string }).toString();
    return text === "[object Object]" ? JSON.stringify(value).slice(0, 80) : text;
  }
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" ? value.toString() : "";
}
