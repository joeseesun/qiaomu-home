import { PRODUCTIVITY_MODULES, type ProductivityId } from "./productivity-catalog";
import { attachMasonry } from "./masonry";
import { isComposingKey } from "./input-ui";
import { renderProductivity, paintFocus } from "./productivity-ui";
import { renderBeginnerPlugins } from "./beginner-ui";
import { renderTodo } from "./todo-ui";
import { dailyExcerpt, excerptLines, inboxItems, pickReview, recentlyModified, removeInboxItem, restoreInboxItem, reviewCandidates } from "./home-native-modules";
import { DISCOVERY_MODULES, defaultSites, discoveryUrl, customSearchSites, type DiscoveryModuleId } from "./discovery";
import { EXTRA_MODULES, type ExtraId } from "./extra-catalog";
import { renderExtra } from "./extra-ui";
import { INTEGRATIONS, renderIntegration, renderPluginGuide, type IntegrationId } from "./integrations";
import { cardAction, fieldRow, undoNotice } from "./card-ui";
import { MAX_FOCUS, readFocus, writeFocus } from "./daily-focus";
import { completeTodo, reopenTodo, taskDisplay } from "./todo-data";
import { update, editorFor } from "./todo-files";
import { addTodoBlock } from "./todo-ui";
import { openFromHome } from "./open";
import { renderGithubInbox } from "./github";
import { L, dateLocale } from "./i18n";
import { DragFeedback, dropAfter } from "./drag-feedback";
import { editShortcutGroup, MoveShortcutModal, renderShortcutGroup } from "./shortcut-ui";
import { shortcutModuleId } from "./shortcuts";
import { Events, ItemView, Keymap, Menu, Notice, Platform, TFile, debounce, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { builtinActions, createNamedNote, newNote, type CreateAction } from "./actions";
import { askAgent, canAsk } from "./agent-bridge";
import {
  KNOWN_PLUGINS, commandExists, installState, localized, openCommunityPluginSettings, openPluginPage, pluginName, runCommand,
} from "./ecosystem";
import { greeting, relativeTime, t } from "./i18n";
import type QiaomuHomePlugin from "./main";
import { currentPage, localDay, moduleOptions, moduleSource, type FocusItem, type HomeSettings } from "./settings";
import { addPage, addPresetPage, duplicatePage, movePage, removePage, reorderPage } from "./pages";
import { orderModules, reorderModule, setModule } from "./layout";
import { pluginModules, type HomeModule } from "./module-catalog";
import { ModuleLibrary, ModuleOptionsModal, MoveModuleModal } from "./module-library";
import { NewPageModal, DeletePageModal } from "./page-dialogs";
import { connectionSnapshot, connectionsChanged, connectionState } from "./connections";
import { HOME_CHANGED_EVENT, findHomeProviders, type HomeAction, type HomeItem, type HomeProvider, type HomeSection } from "./protocol/qiaomu-home";
import { noteNameFromQuery, rankNotes, type NoteCandidate } from "./search";
import { loadActions, searchProvider } from "./sources";
import { captureNote, dailyMatcher, ensureParent, ensureTodayNote, todayPath } from "./today";

import { HOME_VIEW_TYPE, bindOpen, openPathFromHome } from "./open";
export { HOME_VIEW_TYPE };

const NOTE_RESULTS = 6;
/** What the Recent card lists: notes and documents, not images or media that happened to be opened. */
const RECENT_TYPES = new Set(["md", "canvas", "base", "pdf"]);
const PROVIDER_RESULTS = 4;

/** One selectable row in the search dropdown. */
interface ResultRow {
  el: HTMLElement;
  run(newTab: boolean): void;
}

function sourceOrder(id: string): number {
  const index = KNOWN_PLUGINS.findIndex((plugin) => plugin.id === id);
  return index === -1 ? KNOWN_PLUGINS.length : index;
}

function sortedProviders(providers: Array<[string, HomeProvider]>): Array<[string, HomeProvider]> {
  return [...providers].sort(([a], [b]) => sourceOrder(a) - sourceOrder(b) || a.localeCompare(b));
}

/** Every action Home can offer, in the user's saved order; new actions from providers join at the end. */
export function collectActions(app: App, settings: HomeSettings): CreateAction[] {
  const all: CreateAction[] = [...builtinActions(app)];
  for (const [id, provider] of sortedProviders(findHomeProviders(app))) {
    for (const action of loadActions(provider)) {
      all.push({ key: `${id}:${action.id}`, label: action.label, icon: action.icon, run: () => action.run() });
    }
  }
  for (const command of settings.commands) {
    if (!commandExists(app, command.id)) continue;
    all.push({ key: `command:${command.id}`, label: command.label, icon: command.icon, run: () => { if (!runCommand(app, command.id)) new Notice(t("error.command")); } });
  }
  const order = new Map(settings.actions.map((key, index) => [key, index]));
  return all.sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity));
}

/** Screen-reader name for an icon-only control, without creating a hover tooltip. */
function hiddenLabel(el: HTMLElement, text: string): void {
  el.createSpan({ cls: "qh-sr-only", text });
}

export class HomeView extends ItemView {
  private pageEl!: HTMLElement;
  private photoEl!: HTMLElement;
  private creditEl!: HTMLElement;
  private wallButton!: HTMLElement;
  private createEl!: HTMLElement;
  private headEl!: HTMLElement;
  private timeEl: HTMLElement | null = null;
  private subEl: HTMLElement | null = null;
  private inputEl!: HTMLInputElement;
  private clearEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private disposeMasonry?: () => void;
  private tabsEl!: HTMLElement;
  private activePageId = "";
  private tabsSignature = "";
  private editing = false;
  private dragFeedback!: DragFeedback;
  private movedModule: string | null = null;
  private movedShortcut: string | null = null;
  markMovedShortcut(id: string): void { this.movedShortcut = id; }
  private dragging: { kind: "card" | "page"; id: string; pageId: string } | null = null;
  private readonly pageInstance = `qh-pages-${crypto.randomUUID()}`;
  private reviewSelection: { folder: string; path: string } | null = null;
  private connections: unknown[] = [];

  private rows: ResultRow[] = [];
  private activeRow = 0;
  private searchGeneration = 0;
  private capturingSearch = false;
  private sectionsGeneration = 0;
  private photoGeneration = 0;
  private lastMinute = "";
  private lastDay = localDay();
  private discoveryDrafts = new Map<string, string>();
  private dailyFocusDrafts = new Map<string, string>();
  private focusSaving = false;
  private readonly refreshSoon = debounce(() => this.refreshContent(), 150, true);
  /** A refresh was requested while Home was hidden or the user was composing text; run it when that ends. */
  private stale = false;
  private composing = false;
  private wallpaperSignature = "";

  /** Vault and plugin events land here: a hidden Home only remembers that it is out of date. */
  requestRefresh(): void {
    if (!this.contentEl.isConnected || !this.containerEl.isShown() || this.composing) { this.stale = true; return; }
    this.refreshSoon();
  }

  private catchUp(): void {
    if (!this.stale || !this.containerEl.isShown() || this.composing) return;
    this.stale = false;
    this.refreshSoon();
  }

  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuHomePlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string { return HOME_VIEW_TYPE; }
  getDisplayText(): string { return t("view.title"); }
  getIcon(): string { return "house"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    this.register(() => this.refreshSoon.cancel());
    root.empty();
    root.addClass("qh-root", "qh-ui");
    this.dragFeedback = new DragFeedback(root);
    const backdrop = root.createDiv({ cls: "qh-backdrop" });
    this.photoEl = backdrop.createDiv({ cls: "qh-photo" });
    backdrop.createDiv({ cls: "qh-shade" });

    this.pageEl = root.createDiv({ cls: "qh-page" });
    this.headEl = this.pageEl.createDiv({ cls: "qh-head" });
    this.buildSearch(this.pageEl.createDiv({ cls: "qh-bar" }));
    this.tabsEl = this.pageEl.createDiv({ cls: "qh-pages" });
    this.gridEl = this.pageEl.createDiv({ cls: "qh-grid" });
    this.buildCorner(root.createDiv({ cls: "qh-corner" }));

    this.registerEvent((this.app.workspace as Events).on(HOME_CHANGED_EVENT, () => this.requestRefresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => { if (leaf === this.leaf) { this.stale = true; this.catchUp(); } }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.catchUp()));
    this.registerDomEvent(root, "compositionstart", () => { this.composing = true; });
    this.registerDomEvent(root, "compositionend", () => { this.composing = false; window.setTimeout(() => this.catchUp(), 0); });
    // The Todo card listens for the notes it reads; other files never make it re-read.
    const refreshTodo = (path?: string) => this.contentEl.querySelectorAll(".qh-todo").forEach(card => card.dispatchEvent(new CustomEvent("qh-todo-refresh", { detail: { path } })));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (!this.containerEl.isShown()) { this.stale = true; return; }
      refreshTodo(file.path);
      const page = currentPage(this.plugin.settings);
      if (file instanceof TFile && file.extension === "md" &&
        (moduleOptions(this.plugin.settings, "daily-preview", page.id).visible ||
          moduleOptions(this.plugin.settings, "recently-modified", page.id).visible ||
          moduleOptions(this.plugin.settings, "inbox-preview", page.id).visible ||
          Object.keys(PRODUCTIVITY_MODULES).some(id => moduleOptions(this.plugin.settings, id, page.id).visible) ||
          (Object.keys(EXTRA_MODULES) as ExtraId[]).some(id => EXTRA_MODULES[id].vault && moduleOptions(this.plugin.settings, id, page.id).visible) ||
          ["kanban-boards", "excalidraw-drawings"].some(id => moduleOptions(this.plugin.settings, id, page.id).visible))) this.requestRefresh();
    }));
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => { if (info.file && this.containerEl.isShown()) refreshTodo(info.file.path); }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.requestRefresh()));
    // Property-driven cards (habits, focus, tags) must render after the cache has the new frontmatter, not on the raw modify.
    this.registerEvent(this.app.metadataCache.on("changed", () => {
      const page = currentPage(this.plugin.settings);
      if (["habit-checkin", "daily-focus", "tag-cloud", "kanban-boards", "excalidraw-drawings", "spaced-review"].some(id => moduleOptions(this.plugin.settings, id, page.id).visible)) this.requestRefresh();
    }));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.requestRefresh()));
    this.registerDomEvent(root.ownerDocument, "pointerdown", (event) => {
      const target = event.target as Node | null;
      if (target && this.inputEl.parentElement?.contains(target)) return;
      this.closeResults();
    });
    this.registerInterval(window.setInterval(() => this.tick(), 1000));
    // Also recover when a drag ends outside its original card or is cancelled.
    this.registerDomEvent(this.contentEl.ownerDocument, "dragend", () => this.cancelDrag());
    this.registerDomEvent(this.contentEl.ownerDocument, "keydown", (event) => {
      if (event.key === "Escape") this.cancelDrag();
    });
    this.connections = connectionSnapshot(this.app);
    this.registerInterval(window.setInterval(() => {
      if (!this.contentEl.isConnected) return;
      const next = connectionSnapshot(this.app);
      if (!connectionsChanged(this.connections, next)) return;
      this.connections = next;
      this.requestRefresh();
      if (this.inputEl.value.trim() && this.inputEl.getAttr("aria-expanded") === "true") this.onQuery();
    }, 1500));

    this.renderHead();
    this.refreshContent();
    this.focusSearchSoon();
    // Pick today's photo (or a fresh one) before painting, so the page does not flash the previous wallpaper.
    await this.plugin.wallpaper.prepareForView();
    await this.renderPhoto();
  }

  async onClose(): Promise<void> {
    this.dragFeedback?.clear();
    this.disposeMasonry?.();
    this.searchGeneration++;
    this.sectionsGeneration++;
    this.photoGeneration++;
    this.contentEl.empty();
  }

  /** Re-renders everything that depends on settings. Called by the plugin after settings change. */
  render(): void {
    // A Home tab restored in the background has a view object but has not been opened (built) yet.
    if (!this.headEl) return;
    this.relabel();
    this.renderHead();
    this.refreshContent();
    // Card-level saves rerender often; the wallpaper only repaints when its settings changed.
    const wallpaper = JSON.stringify(this.plugin.settings.wallpaper);
    if (wallpaper !== this.wallpaperSignature) void this.renderPhoto();
  }

  /** The search bar is built once to keep the query, focus and IME state; only its text follows the language. */
  private relabel(): void {
    this.inputEl.placeholder = t("search.placeholder");
    this.inputEl.labels?.[0]?.querySelector(".qh-sr-only")?.setText(t("search.label"));
    this.clearEl.querySelector(".qh-sr-only")?.setText(t("search.clear"));
    (this.leaf as unknown as { updateHeader?(): void }).updateHeader?.();
  }

  focusSearch(): void {
    this.inputEl.focus();
    this.inputEl.select();
  }

  private focusSearchSoon(): void {
    // On phones focusing would pop the keyboard over the page; there the user taps the field.
    if (Platform.isMobile) return;
    window.setTimeout(() => { if (this.app.workspace.getMostRecentLeaf() === this.leaf) this.focusSearch(); }, 50);
  }

  // Header -----------------------------------------------------------------

  refreshHeadline(): void { if (this.headEl) this.renderHead(); }

  private renderHead(): void {
    this.headEl.empty();
    this.timeEl = this.subEl = null;
    this.lastMinute = "";
    const headline = this.plugin.settings.headline;
    if (headline === "clock" || !this.plugin.settings.customHeadline.trim()) {
      this.timeEl = this.headEl.createDiv({ cls: "qh-time" });
      this.subEl = this.headEl.createDiv({ cls: "qh-sub" });
      this.tick();
      return;
    }
    const brand = this.headEl.createDiv({ cls: "qh-brand" });
    brand.createSpan({ cls: "qh-brand-name", text: this.plugin.settings.customHeadline });
  }

  private tick(): void {
    paintFocus(this.contentEl, this.plugin);
    const now = new Date();
    if (this.lastDay !== localDay(now)) { this.lastDay = localDay(now); this.requestRefresh(); }
    const minute = now.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    this.catchUp();
    this.contentEl.querySelectorAll(".qh-card[data-tick]").forEach(card => card.dispatchEvent(new Event("qh-minute")));
    if (!this.timeEl || !this.subEl) return;
    this.timeEl.setText(minute);
    const date = now.toLocaleDateString(dateLocale(), { month: "long", day: "numeric", weekday: "long" });
    this.subEl.setText(`${greeting(now.getHours())} · ${date}`);
  }

  // Wallpaper --------------------------------------------------------------

  async renderPhoto(): Promise<void> {
    if (!this.creditEl) return;
    const generation = ++this.photoGeneration;
    this.wallpaperSignature = JSON.stringify(this.plugin.settings.wallpaper);
    const shown = await this.plugin.wallpaper.resolve(this.contentEl.ownerDocument.defaultView ?? window);
    if (generation !== this.photoGeneration) return;
    const root = this.contentEl;
    root.style.setProperty("--qh-dim", String(this.plugin.settings.wallpaper.dim));
    this.creditEl.empty();
    this.wallButton.toggleClass("is-off", !shown);
    if (!shown) {
      root.removeClass("qh-has-photo");
      this.photoEl.style.removeProperty("background-image");
      return;
    }
    root.addClass("qh-has-photo");
    if (shown.color) root.style.setProperty("--qh-photo-color", shown.color);
    const img = new Image();
    img.onload = () => {
      if (generation !== this.photoGeneration) return;
      this.photoEl.style.backgroundImage = `url("${shown.url.replace(/"/g, "%22")}")`;
      this.photoEl.addClass("is-loaded");
    };
    img.src = shown.url;
    if (shown.photo) {
      const link = this.creditEl.createEl("a", { cls: "qh-credit-link", text: t("wallpaper.credit", { name: shown.photo.author }), href: shown.photo.page });
      link.target = "_blank";
      link.rel = "noopener";
    }
  }

  /** Top-right corner: photo credit, change wallpaper (right-click for more), Home settings. */
  private buildCorner(corner: HTMLElement): void {
    this.creditEl = corner.createDiv({ cls: "qh-credit" });
    this.wallButton = corner.createEl("button", { cls: "qh-corner-button" });
    setIcon(this.wallButton, "image");
    hiddenLabel(this.wallButton, t("wallpaper.next"));
    this.wallButton.addEventListener("click", (event) => {
      if (this.plugin.wallpaper.canRotate()) this.nextWallpaper();
      else this.wallpaperMenu(event);
    });
    this.wallButton.addEventListener("contextmenu", (event) => { event.preventDefault(); this.wallpaperMenu(event); });
    const gear = corner.createEl("button", { cls: "qh-corner-button" });
    setIcon(gear, "settings-2");
    hiddenLabel(gear, t("settings.open"));
    gear.addEventListener("click", () => this.plugin.openSettings());
  }

  private nextWallpaper(): void {
    this.photoEl.removeClass("is-loaded");
    this.wallButton.addClass("is-spinning");
    void this.plugin.wallpaper.next().finally(() => this.wallButton.removeClass("is-spinning"));
  }

  private wallpaperMenu(event: MouseEvent): void {
    const wall = this.plugin.settings.wallpaper;
    const menu = new Menu();
    if (this.plugin.wallpaper.canRotate()) menu.addItem((item) => item.setTitle(t("wallpaper.next")).setIcon("shuffle").onClick(() => this.nextWallpaper()));
    const page = wall.source !== "local" && wall.source !== "none" ? wall.current?.page : undefined;
    if (page) menu.addItem((item) => item.setTitle(t("wallpaper.view")).setIcon("external-link").onClick(() => { window.open(page); }));
    menu.addSeparator();
    const sources: Array<[typeof wall.source, string]> = [["curated", t("wallpaper.curated")], ["none", t("wallpaper.none")]];
    if (wall.unsplashSecret) sources.splice(1, 0, ["unsplash", t("wallpaper.unsplash")]);
    if (wall.localPath || wall.localFolder) sources.splice(-1, 0, ["local", t("wallpaper.local")]);
    for (const [source, label] of sources) {
      menu.addItem((item) => item.setTitle(label).setChecked(wall.source === source).onClick(async () => {
        wall.source = source;
        await this.plugin.saveSettings({ rerender: false });
        await this.plugin.wallpaper.prepareForView();
        this.plugin.eachView((view) => void view.renderPhoto());
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("wallpaper.settings")).setIcon("settings-2").onClick(() => this.plugin.openSettings()));
    menu.showAtMouseEvent(event);
  }

  // Search -----------------------------------------------------------------

  private buildSearch(bar: HTMLElement): void {
    const form = bar.createEl("form", { cls: "qh-search" });
    form.setAttr("role", "search");
    const label = form.createEl("label", { cls: "qh-search-icon" });
    setIcon(label, "search");
    hiddenLabel(label, t("search.label"));
    this.inputEl = form.createEl("input", { cls: "qh-search-input", type: "search", placeholder: t("search.placeholder") });
    this.inputEl.id = `qh-search-${Math.random().toString(36).slice(2)}`;
    label.htmlFor = this.inputEl.id;
    this.inputEl.setAttrs({ autocomplete: "off", spellcheck: "false", enterkeyhint: "search", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false" });
    form.addEventListener("pointerdown", event => {
      if (event.target === form) { event.preventDefault(); this.inputEl.focus(); }
    });
    this.clearEl = form.createEl("button", { cls: "qh-icon-button qh-search-clear", type: "button" });
    setIcon(this.clearEl, "x");
    hiddenLabel(this.clearEl, t("search.clear"));
    this.clearEl.hide();
    this.clearEl.addEventListener("click", () => { this.inputEl.value = ""; this.onQuery(); this.inputEl.focus(); });
    form.addEventListener("submit", (event) => event.preventDefault());
    this.inputEl.addEventListener("input", () => this.onQuery());
    this.inputEl.addEventListener("focus", () => { if (this.inputEl.value.trim()) this.onQuery(); });
    this.inputEl.addEventListener("keydown", (event) => this.onSearchKey(event));

    this.createEl = bar.createDiv({ cls: "qh-create" });

    this.resultsEl = form.createDiv({ cls: "qh-results" });
    this.resultsEl.id = `${this.inputEl.id}-results`;
    this.resultsEl.setAttr("role", "listbox");
    this.inputEl.setAttr("aria-controls", this.resultsEl.id);
    this.resultsEl.hide();
  }

  private onSearchKey(event: KeyboardEvent): void {
    if (this.composing || isComposingKey(event)) return;
    const query = this.inputEl.value.trim();
    if (event.key === "Escape") {
      if (this.inputEl.value) { event.preventDefault(); this.inputEl.value = ""; this.onQuery(); }
      else this.closeResults();
      return;
    }
    if (event.key === "Tab") { this.closeResults(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!this.rows.length) return;
      event.preventDefault();
      this.setActiveRow((this.activeRow + (event.key === "ArrowDown" ? 1 : -1) + this.rows.length) % this.rows.length);
      return;
    }
    if (event.key !== "Enter" || !query) return;
    event.preventDefault();
    if (event.shiftKey && !Keymap.isModifier(event, "Mod")) {
      void this.capture(query);
      return;
    }
    if (Keymap.isModifier(event, "Mod") && canAsk(this.app)) {
      this.closeResults();
      void askAgent(this.app, query);
      return;
    }
    this.rows[this.activeRow]?.run(false);
  }

  private async capture(query: string): Promise<void> {
    if (this.capturingSearch) return;
    this.capturingSearch = true;
    const target = t("capture.daily");
    try {
      await captureNote(this.app, { ...this.plugin.settings, captureTarget: "daily" }, query);
      if (this.inputEl.value.trim() === query) { this.inputEl.value = ""; this.onQuery(); }
      new Notice(t("capture.saved", { target }));
      this.refreshSoon();
    } catch (error) {
      new Notice(t("capture.failed", { message: error instanceof Error ? error.message : String(error) }));
    } finally { this.capturingSearch = false; }
  }

  private onQuery(): void {
    const query = this.inputEl.value.trim();
    this.clearEl.toggle(this.inputEl.value.length > 0);
    const generation = ++this.searchGeneration;
    if (!query) { this.closeResults(); return; }
    this.renderResults(query, generation);
  }

  private closeResults(): void {
    this.searchGeneration++;
    this.resultsEl.hide();
    this.resultsEl.empty();
    this.rows = [];
    this.inputEl.setAttr("aria-expanded", "false");
    this.inputEl.removeAttribute("aria-activedescendant");
  }

  private candidates(): NoteCandidate[] {
    return this.app.vault.getFiles().map((file) => {
      const aliases = this.app.metadataCache.getFileCache(file)?.frontmatter?.aliases as unknown;
      return {
        path: file.path, basename: file.basename, extension: file.extension.toLowerCase(), mtime: file.stat.mtime,
        aliases: Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : typeof aliases === "string" ? [aliases] : [],
      };
    });
  }

  private renderResults(query: string, generation: number): void {
    const list = this.resultsEl;
    list.empty();
    this.rows = [];
    list.show();
    this.inputEl.setAttr("aria-expanded", "true");

    const notes = rankNotes(query, this.candidates(), this.app.workspace.getLastOpenFiles(), NOTE_RESULTS);
    const notesGroup = list.createDiv({ cls: "qh-result-group" });
    notesGroup.createDiv({ cls: "qh-result-heading", text: t("search.notes") });
    if (!notes.length) notesGroup.createDiv({ cls: "qh-result-empty", text: t("search.none") });
    for (const note of notes) {
      this.addRow(notesGroup, {
        icon: note.extension === "md" ? "file-text" : note.extension === "canvas" ? "layout-dashboard" : note.extension === "base" ? "database" : "file",
        title: note.title, detail: note.alias ? `${note.alias} · ${note.folder}` : note.folder,
        run: (newTab) => this.openPath(note.path, newTab),
      });
    }

    // Provider groups keep their slot in the list so late answers do not reorder what the user is looking at.
    for (const [id, provider] of sortedProviders(findHomeProviders(this.app))) {
      if (typeof provider.search !== "function") continue;
      const group = list.createDiv({ cls: "qh-result-group" });
      group.hide();
      void searchProvider(provider, query, PROVIDER_RESULTS).then((items) => {
        if (generation !== this.searchGeneration || !items.length) return;
        group.createDiv({ cls: "qh-result-heading", text: pluginName(this.app, id) });
        const active = this.rows[this.activeRow];
        for (const item of items) this.addRow(group, { icon: item.icon ?? "circle", title: item.title, detail: item.subtitle ?? item.meta ?? "", run: () => void item.open() });
        group.show();
        // Keep keyboard order equal to what is on screen, and keep the highlight on the same row.
        this.rows.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        if (active) this.setActiveRow(this.rows.indexOf(active));
      });
    }

    const commands = list.createDiv({ cls: "qh-result-group qh-result-commands" });
    this.addRow(commands, { icon: "pencil-line", title: t("search.capture", { q: query,
      target: t("capture.daily") }),
      hint: t("search.hint.capture"), run: () => void this.capture(query) });
    if (!notes.some((note) => note.title.toLowerCase() === query.toLowerCase())) {
      const name = noteNameFromQuery(query);
      if (name) this.addRow(commands, { icon: "file-plus", title: t("search.create", { q: name }), run: () => void createNamedNote(this.app, this.leaf, name, this.plugin.settings.createFolder) });
    }
    if (canAsk(this.app)) {
      this.addRow(commands, { icon: "sparkles", title: t("search.ask", { q: query }), hint: t("search.hint.ask"), run: () => void askAgent(this.app, query) });
    }
    if (commandExists(this.app, "global-search:open")) {
      this.addRow(commands, { icon: "text-search", title: t("search.fullText", { q: query }), run: () => this.openGlobalSearch(query) });
    }
    // The web: the first site highlighted on the Multi-search card, so the top box and the card agree.
    const web = this.webSite();
    if (web) this.addRow(commands, { icon: "globe", title: L("用 {zh} 搜索「{query}」", "Search {en} for “{query}”", { en: web.en, query, zh: web.zh }),
      run: () => { window.open(discoveryUrl(web, query), "_blank", "noopener,noreferrer"); } });
    this.setActiveRow(0);
  }

  private webSite() {
    const base = DISCOVERY_MODULES["multi-search"];
    const options = moduleOptions(this.plugin.settings, "multi-search");
    const sites = [...base.sites, ...customSearchSites(options.customSites ?? [])].filter((site) => site.search);
    const selected = options.sites ?? defaultSites(base.sites);
    return sites.find((site) => selected.includes(site.id)) ?? sites[0];
  }

  private addRow(group: HTMLElement, row: { icon: string; title: string; detail?: string; hint?: string; run(newTab: boolean): void }): void {
    const el = group.createDiv({ cls: "qh-result" });
    el.id = `${this.inputEl.id}-option-${this.searchGeneration}-${this.rows.length}`;
    el.setAttr("role", "option");
    el.setAttr("aria-selected", "false");
    setIcon(el.createSpan({ cls: "qh-result-icon" }), row.icon);
    const text = el.createDiv({ cls: "qh-result-text" });
    text.createDiv({ cls: "qh-result-title", text: row.title });
    if (row.detail) text.createDiv({ cls: "qh-result-detail", text: row.detail });
    if (row.hint && !Platform.isMobile) el.createSpan({ cls: "qh-result-hint", text: row.hint });
    const entry: ResultRow = { el, run: (newTab) => { this.closeResults(); row.run(newTab); } };
    this.rows.push(entry);
    el.addEventListener("pointerenter", () => this.setActiveRow(this.rows.indexOf(entry)));
    el.addEventListener("click", (event) => entry.run(Keymap.isModEvent(event) !== false));
    el.addEventListener("auxclick", (event) => { if (event.button === 1) entry.run(true); });
  }

  private setActiveRow(index: number): void {
    const previous = this.rows[this.activeRow]?.el;
    previous?.removeClass("is-active"); previous?.setAttr("aria-selected", "false");
    this.activeRow = Math.max(0, Math.min(index, this.rows.length - 1));
    const row = this.rows[this.activeRow];
    if (!row) return;
    row.el.addClass("is-active");
    row.el.setAttr("aria-selected", "true");
    this.inputEl.setAttr("aria-activedescendant", row.el.id);
    row.el.scrollIntoView({ block: "nearest" });
  }

  private openPath(path: string, newTab: boolean): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = newTab || this.plugin.settings.openInNewTab ? this.app.workspace.getLeaf("tab") : this.leaf;
    void leaf.openFile(file, { active: true });
  }

  private openNote(card: HTMLElement, path: string, event?: MouseEvent | KeyboardEvent | null, line?: number): void {
    void openPathFromHome(this.plugin, card, path, event, line).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  private openGlobalSearch(query: string): void {
    const search = (this.app as unknown as { internalPlugins?: { getPluginById?(id: string): { instance?: { openGlobalSearch?(q: string): void } } | null } })
      .internalPlugins?.getPluginById?.("global-search")?.instance;
    if (typeof search?.openGlobalSearch === "function") search.openGlobalSearch(query);
    else runCommand(this.app, "global-search:open");
  }

  // Create row -------------------------------------------------------------

  /** "New note" sits next to search; other actions live in the ▾ menu. */
  private renderCreate(): void {
    const group = this.createEl;
    group.empty();
    const settings = this.plugin.settings;
    const actions = collectActions(this.app, settings);
    const split = group.createDiv({ cls: "qh-split" });
    const main = split.createEl("button", { cls: "qh-pill-button qh-new" });
    setIcon(main.createSpan({ cls: "qh-pill-icon" }), "plus");
    main.createSpan({ cls: "qh-pill-text", text: t("new.note") });
    main.addEventListener("click", () => void newNote(this.app, this.leaf, this.plugin.settings.createFolder));
    const hidden = new Set(settings.hiddenActions);
    const more = actions.filter((action) => !hidden.has(action.key));
    const chevron = split.createEl("button", { cls: "qh-pill-button qh-new-more" });
    setIcon(chevron, "chevron-down");
    hiddenLabel(chevron, t("new.more"));
    chevron.addEventListener("click", (event) => {
      const menu = new Menu();
      for (const action of more) menu.addItem((item) => item.setTitle(action.label).setIcon(action.icon).onClick(() => this.runAction(action)));
      if (more.length) menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("menu.customize")).setIcon("settings-2").onClick(() => this.plugin.openSettings()));
      const rect = chevron.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right, y: rect.bottom + 6, left: true });
      event.preventDefault();
    });
  }

  private readonly expandedGuides = new Set<string>();

  private runAction(action: CreateAction): void {
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    void Promise.resolve(action.run(this.leaf)).catch((error: unknown) => { console.error("Qiaomu Home: action failed", error); new Notice(error instanceof Error ? error.message : t("error.command")); });
  }

  // Continue area ----------------------------------------------------------

  openLibrary(pageId = currentPage(this.plugin.settings).id): void {
    new ModuleLibrary(this.plugin, pageId).open();
  }

  addPage(): void {
    new NewPageModal(this.app, async (name, template) => {
      const page = template ? addPresetPage(this.plugin.settings, template, name) : addPage(this.plugin.settings, name);
      await this.plugin.saveSettings();
      // A blank page needs cards; a template page is ready to use.
      if (!template) window.setTimeout(() => { if (this.contentEl.isConnected) this.openLibrary(page.id); }, 0);
    }, "", t("pages.add"), true).open();
  }

  editLayout(pageId: string): void {
    if (!this.plugin.settings.pages.some(page=>page.id===pageId)) return;
    this.plugin.settings.activePageId=pageId;this.plugin.settings.tabsEnabled=true;
    this.editing=true;this.tabsSignature="";this.refreshContent();
    void this.plugin.saveSettings({rerender:false});
  }

  private shortcutDragging = false;

  private saveLayout(): void {
    void this.plugin.saveSettings().catch((error: unknown) => {
      new Notice(t("layout.saveFailed"));
      console.error("Qiaomu Home: could not save layout", error);
    });
  }

  private pageMenu(event: MouseEvent, id: string): void {
    const settings = this.plugin.settings;
    const page = settings.pages.find((item) => item.id === id);
    if (!page) return;
    const name = page.name || t("pages.default");
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("library.title")).setIcon("plus").onClick(() => this.openLibrary(id)));
    menu.addItem((item) => item.setTitle(t("pages.rename")).setIcon("pencil").onClick(() => {
      new NewPageModal(this.app, async (value) => {
        const target = settings.pages.find((entry) => entry.id === id);
        if (!target) return;
        target.name = value;
        await this.plugin.saveSettings();
      }, name, t("pages.rename")).open();
    }));
    menu.addItem((item) => item.setTitle(t("pages.duplicate")).setIcon("copy").onClick(() => {
      new NewPageModal(this.app, async (value) => {
        duplicatePage(settings, id, value);
        await this.plugin.saveSettings();
      }, t("pages.copyName", { name }), t("pages.duplicate")).open();
    }));
    const index = settings.pages.indexOf(page);
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("layout.earlier")).setIcon("arrow-left").setDisabled(index === 0).onClick(() => {
      movePage(settings, id, -1); this.saveLayout();
    }));
    menu.addItem((item) => item.setTitle(t("layout.later")).setIcon("arrow-right").setDisabled(index === settings.pages.length - 1).onClick(() => {
      movePage(settings, id, 1); this.saveLayout();
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("pages.delete")).setIcon("trash-2").setDisabled(id === settings.homePageId || settings.pages.length === 1).onClick(() => {
      new DeletePageModal(this.app, name, async () => {
        removePage(settings, id);
        await this.plugin.saveSettings();
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }

  private decorateCard(card: HTMLElement, id: string, pageId: string, ordered: string[]): void {
    const head = card.querySelector<HTMLElement>(".qh-card-head");
    if (!head) return;
    const name = card.querySelector(".qh-card-title")?.textContent ?? "";
    const menuButton = head.createEl("button", { cls: "qh-icon-button qh-module-menu" });
    setIcon(menuButton, "ellipsis"); hiddenLabel(menuButton, t("layout.menu"));
    menuButton.addEventListener("click", (event) => {
      const menu = new Menu();
      if (id.startsWith("shortcut:")) {
        const groupId = id.slice("shortcut:".length);
        menu.addItem((item) => item.setTitle(L("管理入口", "Manage shortcuts")).setIcon("list-filter").onClick(() => this.editLayout(pageId)));
        menu.addItem((item) => item.setTitle(t("shortcut.renameGroup")).setIcon("pencil").onClick(() => editShortcutGroup(this.plugin, pageId, groupId)));
        menu.addItem((item) => item.setTitle(t("layout.move")).setIcon("panels-top-left").onClick(() => new MoveShortcutModal(this.plugin, pageId, groupId).open()));
        menu.addSeparator();
      } else if (id !== "recommendations") {
        menu.addItem((item) => item.setTitle(L("组件设置", "Card settings"))
          .setIcon("settings-2").onClick(() => new ModuleOptionsModal(this.plugin, pageId, id, name).open()));
        menu.addItem((item) => item.setTitle(t("layout.move")).setIcon("panels-top-left").onClick(() => new MoveModuleModal(this.plugin, pageId, id).open()));
        menu.addSeparator();
      }
      const index = ordered.indexOf(id);
      for (const delta of [-1, 1]) menu.addItem((item) => item.setTitle(t(delta < 0 ? "layout.earlier" : "layout.later"))
        .setIcon(delta < 0 ? "arrow-up" : "arrow-down").setDisabled(index + delta < 0 || index + delta >= ordered.length).onClick(() => {
          const page = this.plugin.settings.pages.find((entry) => entry.id === pageId);
          if (page && reorderModule(page, id, ordered[index + delta], ordered, delta > 0)) this.saveLayout();
        }));
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("layout.remove")).setIcon("minus-circle").onClick(() => {
        const page = this.plugin.settings.pages.find((entry) => entry.id === pageId);
        if (!page) return;
        if (id === "recommendations") page.showRecommendations = false;
        else setModule(this.plugin.settings, pageId, id, { visible: false });
        this.saveLayout();
      }));
      menu.showAtMouseEvent(event);
    });
    if (this.editing) {
      const handle = head.createEl("button", { cls: "qh-icon-button qh-drag-handle" });
      setIcon(handle, "grip-vertical"); hiddenLabel(handle, t("layout.drag"));
      head.prepend(handle);
      handle.addEventListener("click", () => menuButton.click());
      this.enableDrag(handle, card, "card", id, pageId);
    }
  }

  private cancelDrag(): void {
    if (!this.dragging && !this.shortcutDragging) return;
    this.shortcutDragging = false;
    this.dragging = null;
    this.dragFeedback.clear();
    this.contentEl.querySelectorAll(".qh-dragging, .qh-drop-target").forEach((el) => el.removeClass("qh-dragging", "qh-drop-target"));
    this.refreshContent();
  }

  private enableDrag(handle: HTMLElement, target: HTMLElement, kind: "card" | "page", id: string, pageId: string): void {
    handle.draggable = true;
    handle.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      this.dragging = { kind, id, pageId };
      event.dataTransfer.setData("application/x-qiaomu-home-layout", id);
      event.dataTransfer.effectAllowed = "move";
      this.dragFeedback.start(target, event, target.querySelector(".qh-card-title")?.textContent ?? target.textContent ?? "");
    });
    target.addEventListener("dragover", (event) => {
      const from = this.dragging;
      if (!from || from.kind !== kind || from.id === id || from.pageId !== pageId) return;
      event.preventDefault();
      this.dragFeedback.over(target, event, kind === "page" ? "x" : "y");
    });
    target.addEventListener("dragleave", (event) => this.dragFeedback.leave(target, event));
    target.addEventListener("drop", (event) => {
      const from = this.dragging;
      if (!from || from.kind !== kind || from.id === id || from.pageId !== pageId) return;
      event.preventDefault(); event.stopPropagation();
      const rect = target.getBoundingClientRect();
      const after = dropAfter(kind === "page" ? "x" : "y", rect, event);
      let changed = false;
      if (kind === "page") changed = reorderPage(this.plugin.settings, from.id, id, after);
      else {
        const page = this.plugin.settings.pages.find((entry) => entry.id === pageId);
        const ids = Array.from(this.gridEl.querySelectorAll<HTMLElement>(".qh-card")).map((card) => card.dataset.module!);
        if (page) changed = reorderModule(page, from.id, id, ids, after);
      }
      this.dragging = null;
      this.dragFeedback.clear();
      if (changed) {
        this.movedModule = kind === "card" ? from.id : null;
        if (kind === "card") {
          const page = this.plugin.settings.pages.find((entry) => entry.id === pageId);
          const cards = Array.from(this.gridEl.querySelectorAll<HTMLElement>(".qh-card"));
          if (page) for (const key of orderModules(page, cards.map((card) => card.dataset.module!))) {
            const card = cards.find((entry) => entry.dataset.module === key);
            if (card) this.gridEl.appendChild(card);
          }
        } else this.renderPages();
        this.saveLayout();
      }
    });
    handle.addEventListener("dragend", () => {
      this.dragging = null;
      this.dragFeedback.clear();
      this.contentEl.querySelectorAll(".qh-dragging, .qh-drop-target").forEach((el) => el.removeClass("qh-dragging", "qh-drop-target"));
      this.refreshContent();
    });
  }

  private masonry(grid: HTMLElement): void {
    this.disposeMasonry?.();
    this.disposeMasonry = attachMasonry(grid);
  }

  private renderPages(): void {
    const settings = this.plugin.settings;
    const page = currentPage(settings);
    if (page.id !== this.activePageId) {
      this.activePageId = page.id;
      // Invalidate the former page immediately: slower sources must not flash through.
      this.gridEl.empty();
    }
    const signature = JSON.stringify([this.editing, settings.tabsEnabled, page.id, settings.pages.map((item) => [item.id, item.name])]);
    if (signature === this.tabsSignature) return;
    this.tabsSignature = signature;
    this.tabsEl.empty();
    this.contentEl.toggleClass("qh-editing", this.editing);
    const label = this.tabsEl.createSpan({ cls: "qh-sr-only", text: t("pages.label") });
    label.id = `${this.pageInstance}-label`;
    const list = this.tabsEl.createDiv({ cls: "qh-page-tabs", attr: { role: "tablist", "aria-labelledby": label.id } });
    const select = (id: string, focus: boolean) => {
      if (id === settings.activePageId) return;
      settings.activePageId = id;
      this.plugin.eachView((view) => view.refreshContent());
      if (focus) this.tabsEl.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
      void this.plugin.saveSettings({ rerender: false });
    };
    const shownPages = settings.tabsEnabled ? settings.pages : [currentPage(settings)];
    shownPages.forEach((item, index) => {
      const selected = item.id === page.id;
      const button = list.createEl("button", { cls: "qh-page-tab", text: item.name || t("pages.default"),
        attr: { role: "tab", "aria-selected": String(selected), "aria-controls": `${this.pageInstance}-panel` } });
      button.id = `${this.pageInstance}-tab-${index}`;
      button.tabIndex = selected ? 0 : -1;
      button.addEventListener("click", () => select(item.id, true));
      button.addEventListener("contextmenu", (event) => { event.preventDefault(); this.pageMenu(event, item.id); });
      if (this.editing) this.enableDrag(button, button, "page", item.id, page.id);
      button.addEventListener("keydown", (event) => {
        let next: number;
        if (event.key === "ArrowRight") next = (index + 1) % shownPages.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + shownPages.length) % shownPages.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = shownPages.length - 1;
        else return;
        event.preventDefault();
        select(shownPages[next].id, true);
      });
    });
    const add = this.tabsEl.createEl("button", { cls: "qh-icon-button qh-page-add" });
    setIcon(add, "plus"); hiddenLabel(add, t("pages.add"));
    add.addEventListener("click", () => this.addPage());
    const options = this.tabsEl.createEl("button", { cls: "qh-icon-button qh-page-add" });
    setIcon(options, "ellipsis"); hiddenLabel(options, t("pages.menu"));
    options.addEventListener("click", (event) => this.pageMenu(event, page.id));
    const tools = this.tabsEl.createDiv({ cls: "qh-layout-tools" });
    if (this.editing) {
      const library = tools.createEl("button", { cls: "qh-layout-action" });
      setIcon(library.createSpan(), "plus"); library.createSpan({ text: t("library.title") });
      library.addEventListener("click", () => this.openLibrary());
    }
    if (!this.editing) {
      // Adding cards is the most common layout change, so it gets its own button beside Customize.
      const library = tools.createEl("button", { cls: "qh-icon-button qh-layout-button qh-add-cards" });
      setIcon(library, "blocks"); hiddenLabel(library, t("library.title"));
      library.setAttr("aria-label", t("library.title"));
      library.addEventListener("click", () => this.openLibrary());
    }
    const edit = tools.createEl("button", { cls: this.editing ? "qh-layout-action" : "qh-icon-button qh-layout-button" });
    setIcon(edit.createSpan(), this.editing ? "check" : "settings");
    if (this.editing) edit.createSpan({ text: t("layout.done") });
    else hiddenLabel(edit, L("布置主页", "Customize Home"));
    edit.setAttr("aria-pressed", String(this.editing));
    edit.addEventListener("click", () => { this.editing = !this.editing; this.dragging = null; this.shortcutDragging = false; this.dragFeedback.clear(); this.refreshContent(); });
  }

  private refreshContent(force = false): void {
    if (!this.gridEl || this.dragging || this.shortcutDragging) return;
    if (!force && this.composing) { this.stale = true; return; }
    this.stale = false;
    this.renderPages();
    this.renderCreate();
    const generation = ++this.sectionsGeneration;
    const page = currentPage(this.plugin.settings);
    const grid = this.gridEl;
    const next = this.contentEl.createDiv({ cls: "qh-grid" });
    next.id = `${this.pageInstance}-panel`;
    next.setAttr("role", "tabpanel");
    const index = this.plugin.settings.tabsEnabled ? this.plugin.settings.pages.indexOf(page) : 0;
    next.setAttr("aria-labelledby", `${this.pageInstance}-tab-${index}`);
    next.tabIndex = 0;
    next.detach();
    const first = !grid.hasChildNodes();
    if (moduleOptions(this.plugin.settings, "recent", page.id).visible) this.renderRecent(next);
    if (first) { grid.replaceWith(next); this.gridEl = next; this.masonry(next); }
    void pluginModules(this.app, Object.keys(page.moduleOptions).map(moduleSource).filter((id): id is string => Boolean(id))).then((modules) => {
      if (generation !== this.sectionsGeneration) return;
      const expanded = [...modules];
      // Keep explicitly configured sections removable even when their source is disabled or absent.
      for (const id of Object.keys(page.moduleOptions)) {
        const source = moduleSource(id);
        if (!source || !page.moduleOptions[id].visible || expanded.some((item) => item.id === id)) continue;
        const base = modules.find((item) => item.sourceId === source);
        if (base) expanded.push({ ...base, id, title: base.source, section: undefined,
          status: base.section ? "unavailable" : base.status });
      }
      for (const item of expanded) {
        if (!moduleOptions(this.plugin.settings, item.id, page.id).visible) continue;
        if (!item.section && item.id === item.sourceId && Object.keys(page.moduleOptions).some((key) => moduleSource(key) === item.sourceId)) continue;
        if ((item.status === "absent" || item.status === "disabled") && !Object.hasOwn(page.moduleOptions, item.id)) continue;
        if (item.section) this.renderSection(next, item.sourceId!, {
          ...item.section, items: item.section.items.slice(0, moduleOptions(this.plugin.settings, item.id, page.id).limit),
        }, item.id);
        else this.renderUnavailable(next, item);
      }
      for (const id of Object.keys(PRODUCTIVITY_MODULES) as ProductivityId[]) {
        if (moduleOptions(this.plugin.settings, id, page.id).visible) renderProductivity(next, this.plugin, id, page.id, () => new ModuleOptionsModal(this.plugin, page.id, id, L(PRODUCTIVITY_MODULES[id].zh, PRODUCTIVITY_MODULES[id].en)).open());
      }
      for (const id of Object.keys(EXTRA_MODULES) as ExtraId[]) {
        if (moduleOptions(this.plugin.settings, id, page.id).visible) renderExtra(next, this.plugin, id, page.id, () => new ModuleOptionsModal(this.plugin, page.id, id, L(EXTRA_MODULES[id].zh, EXTRA_MODULES[id].en)).open());
      }
      for (const id of Object.keys(INTEGRATIONS) as IntegrationId[]) {
        if (moduleOptions(this.plugin.settings, id, page.id).visible) renderIntegration(next, this.plugin, id, page.id, () => new ModuleOptionsModal(this.plugin, page.id, id, L(INTEGRATIONS[id].zh, INTEGRATIONS[id].en)).open());
      }
      if (moduleOptions(this.plugin.settings, "todo", page.id).visible) renderTodo(next, this.plugin, moduleOptions(this.plugin.settings, "todo", page.id).limit);
      if (moduleOptions(this.plugin.settings, "daily-preview", page.id).visible) this.renderDailyPreview(next, page.id);
      if (moduleOptions(this.plugin.settings, "recently-modified", page.id).visible) this.renderRecentlyModified(next, page.id);
      if (moduleOptions(this.plugin.settings, "review-note", page.id).visible) this.renderReviewNote(next);
      if (moduleOptions(this.plugin.settings, "inbox-preview", page.id).visible) this.renderInboxPreview(next, page.id);
      if (moduleOptions(this.plugin.settings, "daily-focus", page.id).visible) this.renderDailyFocus(next);
      if (moduleOptions(this.plugin.settings, "countdown", page.id).visible) this.renderCountdown(next);
      for (const id of Object.keys(DISCOVERY_MODULES) as DiscoveryModuleId[]) {
        if (moduleOptions(this.plugin.settings, id, page.id).visible) this.renderDiscovery(next, id);
      }
      if (moduleOptions(this.plugin.settings, "beginner-plugins", page.id).visible) renderBeginnerPlugins(next, this.plugin, page.id, moduleOptions(this.plugin.settings, "beginner-plugins", page.id).limit, this.expandedGuides);
      this.renderRecommendations(next);
      for (const group of page.shortcutGroups) {
        if (moduleOptions(this.plugin.settings, shortcutModuleId(group.id), page.id).visible) renderShortcutGroup(next, this.plugin, page.id, group, this.editing, this.dragFeedback, (active) => { this.shortcutDragging = active; });
      }
      const cards = Array.from(next.querySelectorAll<HTMLElement>(".qh-card"));
      const ids = cards.map((card) => card.dataset.module!);
      const ordered = orderModules(page, ids);
      for (const id of ordered) {
        const card = cards.find((item) => item.dataset.module === id)!;
        this.decorateCard(card, id, page.id, ordered);
        next.appendChild(card);
        if (id === this.movedModule) { card.addClass("qh-just-moved"); this.movedModule = null; }
      }
      if (this.movedShortcut) {
        next.querySelectorAll<HTMLElement>("[data-shortcut]").forEach((element) => {
          if (element.dataset.shortcut === this.movedShortcut) element.addClass("qh-just-moved");
        });
        this.movedShortcut = null;
      }
      if (!cards.length) {
        const empty = next.createDiv({ cls: "qh-page-empty" });
        empty.createDiv({ text: t("pages.empty") });
        const configure = empty.createEl("button", { cls: "qh-pill", text: t("library.title") });
        configure.addEventListener("click", () => this.openLibrary(page.id));
      }
      if (!first) {
        const restore = this.captureFocus(grid);
        const scrollTop = this.pageEl.scrollTop;
        // The new masonry grid starts with 1px rows. Keep the old height until its
        // cards have been measured, or the browser clamps the page's scroll to zero.
        next.style.minHeight = `${grid.getBoundingClientRect().height}px`;
        grid.replaceWith(next); this.gridEl = next; this.masonry(next);
        next.style.removeProperty("min-height");
        this.pageEl.scrollTop = scrollTop;
        restore(next);
      }
    }).catch((error: unknown) => console.error("Qiaomu Home: could not load modules", error));
  }

  /**
   * A rebuilt grid replaces the one the user may be typing in. Remember the focused field (card + position),
   * its text and caret, and put them back in the matching field of the new grid.
   */
  private captureFocus(grid: HTMLElement): (next: HTMLElement) => void {
    const focused = this.contentEl.ownerDocument.activeElement;
    if (!(focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) || !grid.contains(focused) || focused.type === "checkbox") return () => {};
    const card = focused.closest<HTMLElement>(".qh-card");
    if (!card) return () => {};
    const fields = Array.from(card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=checkbox]), textarea"));
    const index = fields.indexOf(focused), value = focused.value;
    const start = focused.selectionStart, end = focused.selectionEnd;
    const module = card.dataset.module;
    return (next) => {
      const target = Array.from(next.querySelectorAll<HTMLElement>(".qh-card")).find(entry => entry.dataset.module === module);
      const field = target?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=checkbox]), textarea")[index];
      if (!field || field.disabled) return;
      if (field.value !== value) { field.value = value; field.dispatchEvent(new Event("input")); }
      field.focus({ preventScroll: true });
      try { if (start !== null && end !== null) field.setSelectionRange(start, end); } catch { /* type=search etc. */ }
    };
  }

  private renderSection(parent: HTMLElement, sourceId: string, section: HomeSection, moduleId: string): void {
    const card = parent.createDiv({ cls: "qh-card" });
    card.dataset.source = sourceId;
    card.dataset.module = moduleId;
    const head = card.createDiv({ cls: "qh-card-head" });
    const known = KNOWN_PLUGINS.find((plugin) => plugin.id === sourceId);
    setIcon(head.createSpan({ cls: "qh-card-icon" }), known?.icon ?? "puzzle");
    head.createSpan({ cls: "qh-card-title", text: section.title });
    if (section.more) this.actionButton(head, section.more, "qh-card-more", true);
    if (!section.items.length) {
      card.createDiv({ cls: "qh-card-empty", text: section.empty ?? "" });
      return;
    }
    const list = card.createDiv({ cls: "qh-list" });
    for (const item of section.items) this.renderItem(list, item);
  }

  private renderItem(list: HTMLElement, item: HomeItem, extra: { open?(event: MouseEvent | KeyboardEvent): void; menu?(menu: Menu): void } = {}): HTMLElement {
    const row = list.createDiv({ cls: "qh-item" });
    row.tabIndex = 0;
    row.setAttr("role", "button");
    if (item.active) row.addClass("is-active");
    const thumb = row.createDiv({ cls: "qh-thumb" });
    const showIcon = () => { thumb.empty(); thumb.addClass("is-icon"); setIcon(thumb, item.icon ?? "circle"); };
    if (item.image) {
      const img = thumb.createEl("img", { attr: { alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" } });
      img.addEventListener("error", showIcon, { once: true });
      img.src = item.image;
    } else showIcon();
    const body = row.createDiv({ cls: "qh-item-body" });
    body.createDiv({ cls: "qh-item-title", text: item.title });
    const line = [item.subtitle, item.meta].filter(Boolean).join(" · ");
    if (line) body.createDiv({ cls: "qh-item-sub", text: line });
    if (item.progress !== undefined) {
      const bar = body.createDiv({ cls: "qh-progress" });
      bar.createDiv({ cls: "qh-progress-fill" }).style.width = `${Math.round(item.progress * 100)}%`;
    }
    for (const action of item.actions ?? []) this.actionButton(row, action, "qh-item-action", false);
    const open = (event: MouseEvent | KeyboardEvent) => {
      if (extra.open) { extra.open(event); return; }
      void Promise.resolve(item.open()).catch((error: unknown) => console.error("Qiaomu Home: open failed", error));
    };
    bindOpen(row, open);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(event); } });
    if (extra.menu) {
      const showMenu = (event: MouseEvent, anchor?: HTMLElement) => {
        event.preventDefault(); event.stopPropagation();
        const menu = new Menu();
        extra.menu!(menu);
        if (anchor) {
          const rect = anchor.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom });
        } else menu.showAtMouseEvent(event);
      };
      row.addEventListener("contextmenu", event => showMenu(event));
      const more = row.createEl("button", { cls: "qh-icon-button qh-item-menu" });
      setIcon(more, "ellipsis");
      hiddenLabel(more, L("笔记选项：{title}", "Note options: {title}", { title: item.title }));
      more.setAttr("aria-haspopup", "menu");
      more.addEventListener("click", event => showMenu(event, more));
      more.addEventListener("keydown", event => event.stopPropagation());
    }
    return row;
  }

  private actionButton(parent: HTMLElement, action: HomeAction, cls: string, withText: boolean): void {
    const button = parent.createEl("button", { cls: `qh-icon-button ${cls}` });
    setIcon(button.createSpan({ cls: "qh-button-icon" }), action.icon || "arrow-right");
    if (withText) button.createSpan({ cls: "qh-button-text", text: action.label });
    else hiddenLabel(button, action.label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void Promise.resolve(action.run()).catch((error: unknown) => { console.error("Qiaomu Home: action failed", error); new Notice(error instanceof Error ? error.message : t("error.command")); });
    });
    button.addEventListener("keydown", (event) => event.stopPropagation());
  }

  private renderRecent(parent: HTMLElement): void {
    const card = parent.createDiv({ cls: "qh-card" });
    card.dataset.module = "recent";
    const head = card.createDiv({ cls: "qh-card-head" });
    setIcon(head.createSpan({ cls: "qh-card-icon" }), "history");
    head.createSpan({ cls: "qh-card-title", text: t("section.recent") });
    const settings = this.plugin.settings;
    const pinned = settings.recentPinned, hidden = new Set(settings.recentHidden);
    const paths = [...pinned, ...this.app.workspace.getLastOpenFiles().filter((path) => !pinned.includes(path) && !hidden.has(path))];
    const files = paths
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile && RECENT_TYPES.has(file.extension.toLowerCase()))
      .slice(0, Math.max(moduleOptions(settings, "recent").limit, pinned.length));
    if (!files.length) { card.createDiv({ cls: "qh-card-empty", text: t("section.recent.empty") }); return; }
    const list = card.createDiv({ cls: "qh-list" });
    const save = (change: () => void) => { change(); void this.plugin.saveSettings().catch(() => new Notice(t("layout.saveFailed"))); };
    for (const file of files) {
      const isPinned = pinned.includes(file.path);
      const row = this.renderItem(list, {
        id: file.path, title: file.basename, icon: isPinned ? "pin" : file.extension === "md" ? "file-text" : file.extension === "canvas" ? "layout-dashboard" : file.extension === "base" ? "database" : "file",
        subtitle: file.parent && !file.parent.isRoot() ? file.parent.path : "", open: () => {},
      }, {
        open: (event) => this.openNote(card, file.path, event),
        menu: (menu) => {
          menu.addItem((item) => item.setTitle(L("在新标签页打开", "Open in new tab")).setIcon("file-plus").onClick(() => this.openPath(file.path, true)));
          menu.addItem((item) => item.setTitle(isPinned ? (L("取消置顶", "Unpin")) : (L("置顶", "Pin to top"))).setIcon(isPinned ? "pin-off" : "pin")
            .onClick(() => save(() => { settings.recentPinned = isPinned ? pinned.filter((path) => path !== file.path) : [...pinned, file.path].slice(-20); })));
          if (!isPinned) menu.addItem((item) => item.setTitle(L("从列表移除", "Remove from list")).setIcon("eye-off")
            .onClick(() => save(() => { settings.recentHidden = [...settings.recentHidden.filter((path) => path !== file.path), file.path].slice(-200); })));
        },
      });
      if (isPinned) row.addClass("is-pinned");
    }
  }

  private nativeCard(parent: HTMLElement, id: string, title: string, icon: string): HTMLElement {
    const card = parent.createDiv({ cls: "qh-card" });
    card.dataset.module = id;
    const head = card.createDiv({ cls: "qh-card-head" });
    setIcon(head.createSpan({ cls: "qh-card-icon" }), icon);
    head.createSpan({ cls: "qh-card-title", text: title });
    return card;
  }

  private renderDailyPreview(parent: HTMLElement, pageId: string): void {
    const card = this.nativeCard(parent, "daily-preview", L("今日日记", "Today's note"), "calendar-days");
    const body = card.createDiv({ cls: "qh-native-preview" });
    body.createDiv({ cls: "qh-card-empty", text: L("正在读取…", "Loading…") });
    // Without the core plugin, the action leads to where it can be turned on instead of a disabled button.
    if (commandExists(this.app, "daily-notes")) {
      const action = cardAction(card, L("打开今日日记", "Open today's note"), () => {}, "arrow-up-right");
      bindOpen(action, (event) => void ensureTodayNote(this.app).then((file) => openFromHome(this.plugin, card, file, event))
        .catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))));
    } else cardAction(card, L("启用日记核心插件", "Turn on Daily notes"), () => {
      const setting = (this.app as unknown as { setting?: { open?(): void; openTabById?(id: string): void } }).setting;
      setting?.open?.(); setting?.openTabById?.("plugins");
    }, "power", true);
    const limit = moduleOptions(this.plugin.settings, "daily-preview", pageId).limit;
    void todayPath(this.app).then(async (path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      const content = file instanceof TFile ? editorFor(this.app, file)?.getValue() ?? await this.app.vault.cachedRead(file) : "";
      const all = excerptLines(content, Number.POSITIVE_INFINITY);
      if (!card.isConnected) return;
      body.empty();
      if (!all.length) { body.createDiv({ cls: "qh-card-empty", text: file ? (L("今日日记还没有正文", "Today's note is empty")) : (L("今天还没有日记", "No daily note yet")) }); return; }
      const rows = content.split("\n");
      for (const entry of all.slice(0, limit)) {
        const line = body.createDiv({ cls: "qh-native-line qh-native-link" });
        if (entry.task && file instanceof TFile) {
          const raw = rows[entry.line] ?? "";
          const box = line.createEl("input", { type: "checkbox", cls: "qh-line-check" });
          box.checked = entry.task === "done";
          box.addEventListener("click", (event) => event.stopPropagation());
          box.addEventListener("change", () => {
            box.disabled = true;
            const item = { line: entry.line, raw: raw.replace(/\r$/, ""), text: entry.text };
            const write = box.checked
              ? (current: string) => completeTodo(current, "", item)
              : (current: string) => reopenTodo(current, item.raw, item.raw.replace(/\[[xX]\]/, "[ ]"));
            void update(this.app, file, write).catch(() => {
              box.checked = !box.checked;
              new Notice(L("这一行已被修改，请刷新后再试", "This line changed; refresh and try again"));
            }).finally(() => { box.disabled = false; });
          });
          line.toggleClass("is-done", entry.task === "done");
        }
        const text = line.createSpan({ text: entry.text });
        text.id = `qh-line-${crypto.randomUUID()}`;
        line.querySelector<HTMLInputElement>(".qh-line-check")?.setAttr("aria-labelledby", text.id);
        line.tabIndex = 0;
        bindOpen(line, (event) => this.openNote(card, path, event, entry.line));
        line.addEventListener("keydown", (event) => { if (event.key === "Enter") this.openNote(card, path, event, entry.line); });
      }
      if (all.length > limit) body.createDiv({ cls: "qh-native-scope", text: L("还有 {v} 行", "{v} more lines", { v: all.length - limit }) });
    }).catch(() => {
      if (!card.isConnected) return;
      body.empty();
      body.createDiv({ cls: "qh-card-empty", text: L("无法读取日记设置", "Daily note settings unavailable") });
    });
  }

  /** Daily notes and the notes Home writes into (Inbox, task note) change constantly and would crowd out everything else. */
  private async homeNoteFilter(): Promise<(path: string) => boolean> {
    const daily = await dailyMatcher(this.app);
    const own = new Set([this.plugin.settings.captureInboxPath, this.plugin.settings.todoPath]);
    return (path) => own.has(path) || daily(path);
  }

  private renderRecentlyModified(parent: HTMLElement, pageId: string): void {
    const card = this.nativeCard(parent, "recently-modified", L("最近修改", "Recently modified"), "file-clock");
    const options = moduleOptions(this.plugin.settings, "recently-modified", pageId);
    if (options.folder) card.createDiv({ cls: "qh-native-scope", text: options.folder });
    const list = card.createDiv({ cls: "qh-list" });
    void (options.excludeDaily === false ? Promise.resolve(undefined) : this.homeNoteFilter()).then((exclude) => {
      if (!card.isConnected) return;
      const files = recentlyModified(this.app, options.limit, options.folder, exclude);
      if (!files.length) { card.createDiv({ cls: "qh-card-empty", text: L("还没有 Markdown 笔记", "No Markdown notes yet") }); return; }
      for (const file of files) this.renderItem(list, { id: file.path, title: file.basename, icon: "file-text",
        subtitle: file.parent && !file.parent.isRoot() ? file.parent.path : "", meta: relativeTime(file.stat.mtime), open: () => {} },
      { open: (event) => this.openNote(card, file.path, event) });
    });
  }

  private renderReviewNote(parent: HTMLElement): void {
    const card = this.nativeCard(parent, "review-note", L("回顾一篇", "Review a note"), "shuffle");
    const settings = this.plugin.settings;
    if (settings.reviewFolder) card.createDiv({ cls: "qh-native-scope", text: settings.reviewFolder });
    const list = card.createDiv({ cls: "qh-list" });
    const excerpt = card.createDiv({ cls: "qh-native-preview qh-review-excerpt" });
    const actions = card.createDiv({ cls: "qh-workflow-actions" });
    void (settings.reviewExcludeDaily ? dailyMatcher(this.app) : Promise.resolve(() => false)).then((daily) => {
      if (!card.isConnected) return;
      const excluded = new Set(settings.reviewExcluded);
      const candidates = reviewCandidates(this.app, settings.reviewFolder, (path) => excluded.has(path) || daily(path));
      if (!candidates.length) {
        card.createDiv({ cls: "qh-card-empty", text: L("所选范围里没有可回顾的笔记", "No notes to review in this scope") });
        cardAction(card, L("更换范围", "Change folder"), () => new ModuleOptionsModal(this.plugin, currentPage(settings).id, "review-note", L("回顾一篇", "Review a note")).open(), "folder", true);
        return;
      }
      let current = this.reviewSelection?.folder === settings.reviewFolder
        ? candidates.find((file) => file.path === this.reviewSelection?.path) : undefined;
      const mark = (change: () => void) => { change(); void this.plugin.saveSettings({ rerender: false }).catch(() => new Notice(t("layout.saveFailed"))); };
      const seen = (path: string) => mark(() => { settings.reviewSeen = { ...settings.reviewSeen, [path]: localDay() }; });
      const choose = (different: boolean) => {
        if (!current || different) current = pickReview(candidates, settings.reviewSeen, localDay(), { avoid: current?.path });
        if (!current) return;
        const file = current;
        this.reviewSelection = { folder: settings.reviewFolder, path: file.path };
        list.empty(); excerpt.empty();
        this.renderItem(list, { id: file.path, title: file.basename, icon: "file-text",
          subtitle: file.parent && !file.parent.isRoot() ? file.parent.path : "", meta: relativeTime(file.stat.mtime), open: () => {} },
        { open: (event) => { seen(file.path); this.openNote(card, file.path, event); } });
        void this.app.vault.cachedRead(file).then((markdown) => {
          if (this.reviewSelection?.path !== file.path || !card.isConnected) return;
          for (const line of dailyExcerpt(markdown, 2)) excerpt.createDiv({ cls: "qh-native-line", text: line });
        }).catch(() => {});
      };
      choose(false);
      cardAction(actions, L("换一篇", "Another note"), () => choose(true), "shuffle");
      cardAction(actions, L("已回顾", "Reviewed"), () => { if (current) seen(current.path); choose(true); }, "check");
      cardAction(actions, L("不再出现", "Never show"), () => {
        if (!current) return;
        const path = current.path;
        mark(() => { settings.reviewExcluded = [...settings.reviewExcluded, path].slice(-500); });
        const index = candidates.findIndex((file) => file.path === path);
        if (index >= 0) candidates.splice(index, 1);
        if (candidates.length) choose(true); else { list.empty(); excerpt.empty(); }
      }, "eye-off");
    });
  }

  private renderInboxPreview(parent: HTMLElement, pageId: string): void {
    const card = this.nativeCard(parent, "inbox-preview", L("收件箱", "Inbox"), "inbox");
    const path = this.plugin.settings.captureInboxPath;
    const file = this.app.vault.getAbstractFileByPath(path);
    const body = card.createDiv({ cls: "qh-native-preview" });
    if (!(file instanceof TFile)) {
      body.createDiv({ cls: "qh-card-empty", text: L("还没有收件箱笔记（{path}）。将快速记录的目标设为收件箱，记下的内容会出现在这里。", "No Inbox note yet ({path}). Set Quick capture to Inbox to collect entries here.", { path }) });
      cardAction(card, L("创建收件箱", "Create Inbox"), () => void (async () => {
        await ensureParent(this.app, path);
        if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.create(path, "");
      })().catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))), "plus", true);
      return;
    }
    const head = card.querySelector<HTMLElement>(".qh-card-head")!;
    const count = head.createSpan({ cls: "qh-card-count" });
    body.createDiv({ cls: "qh-card-empty", text: L("正在读取…", "Loading…") });
    const undoLabels = { undo: L("撤销", "Undo"), failed: L("无法撤销：收件箱已被修改", "Could not undo: the Inbox changed") };
    void Promise.resolve(editorFor(this.app, file)?.getValue() ?? this.app.vault.cachedRead(file)).then((markdown) => {
      if (!card.isConnected) return;
      body.empty();
      const items = inboxItems(markdown);
      count.setText(items.length ? String(items.length) : "");
      if (!items.length) {
        // Notes written before list items were used still show their last lines.
        const lines = dailyExcerpt(markdown.split(/\r?\n/).slice(-500).join("\n"), 500).slice(-moduleOptions(this.plugin.settings, "inbox-preview", pageId).limit);
        if (lines.length) for (const line of lines) body.createDiv({ cls: "qh-native-line", text: line });
        else body.createDiv({ cls: "qh-card-empty", text: L("收件箱是空的", "Inbox is empty") });
        return;
      }
      // Newest first: captures are appended to the end of the note.
      for (const item of items.slice(-moduleOptions(this.plugin.settings, "inbox-preview", pageId).limit).reverse()) {
        const row = body.createDiv({ cls: "qh-inbox-row" });
        const text = row.createDiv({ cls: "qh-native-line qh-native-link", text: taskDisplay(item.text) });
        text.tabIndex = 0;
        bindOpen(text, (event) => this.openNote(card, path, event, item.line));
        const tools = row.createDiv({ cls: "qh-inbox-tools" });
        const tool = (icon: string, label: string, run: () => Promise<void>) => {
          const button = tools.createEl("button", { cls: "qh-icon-button" });
          setIcon(button, icon); hiddenLabel(button, label);
          button.addEventListener("click", () => {
            button.disabled = true;
            void run().catch((error: unknown) => {
              button.disabled = false;
              new Notice(error instanceof Error && error.message !== "Item changed" ? error.message : (L("这条内容已被修改，请刷新后再试", "This item changed; refresh and try again")));
            });
          });
        };
        tool("list-plus", L("转为待办", "Move to tasks"), async () => {
          await update(this.app, file, (current) => removeInboxItem(current, item));
          const [first, ...rest] = item.raw.split("\n");
          const block = [`- [ ] ${first.replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, "").replace(/\r$/, "")}`, ...rest].join("\n");
          try { await addTodoBlock(this.plugin, block); }
          catch (error) { await update(this.app, file, (current) => restoreInboxItem(current, item)); throw error; }
          new Notice(L("已移到今日待办", "Moved to today's tasks"));
        });
        tool("trash-2", L("删除", "Delete"), async () => {
          await update(this.app, file, (current) => removeInboxItem(current, item));
          undoNotice(L("已从收件箱删除", "Removed from Inbox"), () => update(this.app, file, (current) => restoreInboxItem(current, item)), undoLabels);
        });
      }
    }).catch(() => { if (card.isConnected) body.setText(L("无法读取收件箱", "Could not read Inbox")); });
    const open = cardAction(card, L("打开收件箱", "Open Inbox"), () => {}, "arrow-up-right");
    bindOpen(open, (event) => this.openNote(card, path, event));
  }

  private renderDailyFocus(parent: HTMLElement): void {
    const card = this.nativeCard(parent, "daily-focus", L("今日重点", "Today's focus"), "target");
    const list = card.createDiv({ cls: "qh-focus-list" });
    let items: FocusItem[] = [];
    const draftKey = `${currentPage(this.plugin.settings).id}:${localDay()}`;
    const save = async (next: FocusItem[], committed?: () => void) => {
      if (this.focusSaving) return;
      this.focusSaving = true;
      addFocus.disabled = true;
      try { await writeFocus(this.plugin, next); items = next; committed?.(); }
      catch (error) {
        new Notice(error instanceof Error && error.message === "Focus property changed"
          ? (L("今日日记里的 focus 属性不是文字，已保留原值", "The focus property in today's note is not text; it was left unchanged"))
          : error instanceof Error ? error.message : t("layout.saveFailed"));
      } finally { this.focusSaving = false; addFocus.disabled = false; this.requestRefresh(); }
    };
    // The field is built right away so a refresh can hand focus back to it while the list loads.
    const { input, row: field, submit: addFocus } = fieldRow(card, {
      placeholder: L("今天最重要的一件事", "One important thing today"),
      label: L("今日重点", "Today's focus"), icon: "plus", action: L("添加重点", "Add focus"), onSubmit: () => {
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        if (items.some((item) => item.text === text)) { input.value = ""; this.dailyFocusDrafts.delete(draftKey); return; }
        void save([...items, { text, done: false }], () => {
          if (this.dailyFocusDrafts.get(draftKey)?.trim() === text) this.dailyFocusDrafts.delete(draftKey);
          if (input.value.trim() === text) input.value = "";
        });
      },
    });
    input.maxLength = 240;
    addFocus.disabled = true;
    input.value = this.dailyFocusDrafts.get(draftKey) ?? "";
    input.addEventListener("input", () => this.dailyFocusDrafts.set(draftKey, input.value));
    const note = card.createDiv({ cls: "qh-native-scope" });
    void readFocus(this.plugin).then((state) => {
      if (!card.isConnected) return;
      items = state.items;
      addFocus.disabled = this.focusSaving;
      if (state.invalid) {
        field.hide();
        list.createDiv({ cls: "qh-card-empty", text: L("今日日记的 focus 属性不是文字，已保留原值。", "The focus property in today's note is not text; it was left unchanged.") });
        return;
      }
      for (const [index, item] of items.entries()) {
        const row = list.createDiv({ cls: "qh-focus-item" });
        const label = row.createEl("label", { cls: "qh-habit-row qh-focus-done" });
        const done = label.createEl("input", { type: "checkbox" }); done.checked = item.done;
        label.createSpan({ text: item.text });
        label.toggleClass("is-done", item.done);
        done.addEventListener("change", () => { label.toggleClass("is-done", done.checked); void save(items.map((entry, at) => at === index ? { ...entry, done: done.checked } : entry)); });
        const tools = row.createDiv({ cls: "qh-inbox-tools" });
        const todo = tools.createEl("button", { cls: "qh-icon-button" });
        setIcon(todo, "list-plus"); hiddenLabel(todo, L("加入今日待办", "Add to today's tasks"));
        todo.addEventListener("click", () => {
          todo.disabled = true;
          void addTodoBlock(this.plugin, `- [ ] ${item.text}`).then(() => new Notice(L("已加入今日待办", "Added to today's tasks")))
            .catch((error: unknown) => { todo.disabled = false; new Notice(error instanceof Error ? error.message : t("layout.saveFailed")); });
        });
        const remove = tools.createEl("button", { cls: "qh-icon-button" });
        setIcon(remove, "x"); hiddenLabel(remove, L("移除", "Remove"));
        remove.addEventListener("click", () => void save(items.filter((_, at) => at !== index)));
      }
      if (!items.length && state.yesterday.length) {
        const carry = list.createDiv({ cls: "qh-focus-yesterday" });
        carry.createDiv({ cls: "qh-native-scope", text: L("昨天的重点还没完成", "Unfinished from yesterday") });
        for (const item of state.yesterday) {
          const row = carry.createDiv({ cls: "qh-focus-item" });
          row.createSpan({ cls: "qh-native-line", text: item.text });
          cardAction(row, L("继续", "Continue"), () => void save([...items, { text: item.text, done: false }].slice(0, MAX_FOCUS)), "corner-down-right");
        }
      }
      if (items.length >= MAX_FOCUS) field.hide();
      else if (items.length) input.placeholder = L("再加一件（最多 {MAX_FOCUS} 件）", "Add another (up to {MAX_FOCUS})", { MAX_FOCUS });
      if (!items.length && !state.yesterday.length) note.setText(state.stored === "note"
        ? (L("记在今日日记的 focus 属性里", "Saved in today's note as the focus property"))
        : (L("启用日记核心插件后会记进日记", "Turn on Daily notes to keep focus in your notes")));
    }).catch(() => { if (card.isConnected) list.createDiv({ cls: "qh-card-empty", text: L("无法读取今日日记", "Could not read today's note") }); });
  }

  private renderCountdown(parent: HTMLElement): void {
    const card = this.nativeCard(parent, "countdown", L("倒计时", "Countdown"), "calendar-clock");
    const data = this.plugin.settings.countdown;
    if (data.date) {
      const target = new Date(`${data.date}T00:00:00`);
      const days = Math.round((target.getTime() - new Date(`${localDay()}T00:00:00`).getTime()) / 86400000);
      const hero = card.createDiv({ cls: "qh-countdown" });
      hero.createDiv({ cls: "qh-countdown-label", text: data.label || (L("目标日", "Target day")) });
      const figure = hero.createDiv({ cls: "qh-countdown-figure" });
      if (days === 0) figure.createSpan({ cls: "qh-countdown-number", text: L("就是今天", "Today") });
      else {
        figure.createSpan({ cls: "qh-countdown-prefix", text: days > 0 ? (L("还有", "")) : (L("已过去", "")) });
        figure.createSpan({ cls: "qh-countdown-number", text: String(Math.abs(days)) });
        figure.createSpan({ cls: "qh-countdown-unit", text: L("天", Math.abs(days) === 1 ? (days > 0 ? "day left" : "day ago") : (days > 0 ? "days left" : "days ago")) });
      }
      hero.createDiv({ cls: "qh-countdown-date", text: target.toLocaleDateString(dateLocale(), { year: "numeric", month: "long", day: "numeric", weekday: "short" }) });
      hero.toggleClass("is-past", days < 0);
    } else card.createDiv({ cls: "qh-card-empty", text: L("设置一个值得期待的日期", "Choose a date to look forward to") });
    cardAction(card, data.date ? (L("更改日期", "Change date")) : (L("设置日期", "Set date")),
      () => new ModuleOptionsModal(this.plugin, currentPage(this.plugin.settings).id, "countdown", L("倒计时", "Countdown")).open(), "calendar", !data.date);
  }

  private renderDiscovery(parent: HTMLElement, id: DiscoveryModuleId): void {
    const base = DISCOVERY_MODULES[id];
    const config = { ...base, sites: [...base.sites, ...(id === "multi-search" ? customSearchSites(moduleOptions(this.plugin.settings, id).customSites ?? []) : [])] };
    const card = this.nativeCard(parent, id, L(config.zh, config.en), config.icon);
    if (id === "dev-inbox") renderGithubInbox(card, this.plugin, moduleOptions(this.plugin.settings, id).limit);
    const withSearch = config.sites.some((site) => site.search);
    let submit = () => {};
    const input = withSearch ? fieldRow(card, { type: "search", placeholder: L("输入关键词，回车搜索", "Search, then press Enter"),
      label: L("{zh}关键词", "{en} query", { en: config.en, zh: config.zh }), icon: "search", action: L("搜索", "Search"), onSubmit: () => submit() }).input : null;
    if (input) {
      const key = `${currentPage(this.plugin.settings).id}:${id}`;
      input.value = this.discoveryDrafts.get(key) ?? "";
      input.addEventListener("input", () => this.discoveryDrafts.set(key, input.value));
    }
    const sites = card.createDiv({ cls: "qh-discovery-sites" });
    const savedSites = moduleOptions(this.plugin.settings, id).sites;
    const selected = new Set(savedSites ?? defaultSites(config.sites));
    const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
    // Other cards use the saved list to hide sources; multi-search keeps every source visible as a toggle.
    const shown = id === "multi-search" ? config.sites : config.sites.filter((site) => selected.has(site.id));
    for (const site of shown) {
      const button = sites.createEl("button", { cls: "qh-discovery-site" });
      setIcon(button.createSpan(), site.icon);
      button.createSpan({ text: L(site.zh, site.en) });
      if (id === "multi-search") { button.setAttr("aria-pressed", String(selected.has(site.id))); button.addEventListener("click", () => {
        if (selected.has(site.id)) selected.delete(site.id); else selected.add(site.id);
        button.setAttr("aria-pressed", String(selected.has(site.id)));
        const page = currentPage(this.plugin.settings);
        const previous = page.moduleOptions[id];
        page.moduleOptions[id] = { ...moduleOptions(this.plugin.settings, id), sites: [...selected] };
        void this.plugin.saveSettings({ rerender: false }).catch(() => { if (previous) page.moduleOptions[id] = previous; else delete page.moduleOptions[id]; new Notice(t("layout.saveFailed")); });
      }); }
      else button.addEventListener("click", () => open(discoveryUrl(site, input?.value ?? "")));
    }
    if (id === "multi-search") {
      const openAll = moduleOptions(this.plugin.settings, id).openAll !== false;
      const run = () => {
        if (!input?.value.trim()) { input?.focus(); return; }
        const chosen = config.sites.filter((site) => selected.has(site.id));
        if (!chosen.length) { new Notice(L("请至少选择一个网站", "Choose at least one website")); return; }
        for (const site of openAll ? chosen : chosen.slice(0, 1)) open(discoveryUrl(site, input.value));
      };
      submit = run;
      card.createDiv({ cls: "qh-native-scope", text: openAll
        ? (L("点亮的网站会同时打开", "Highlighted sites open together"))
        : (L("回车用第一个点亮的网站搜索", "Enter searches the first highlighted site")) });
    } else if (input) {
      const first = shown.find((site) => site.search) ?? config.sites.find((site) => site.search)!;
      submit = () => { if (!input.value.trim()) { input.focus(); return; } open(discoveryUrl(first, input.value)); };
      card.createDiv({ cls: "qh-native-scope", text: L("回车用「{zh}」搜索，或点选其他来源", "Enter searches {en}, or pick a source", { en: first.en, zh: first.zh }) });
    } else if (id === "ai-learning") {
      card.createDiv({ cls: "qh-native-scope", text: L("课程和学习进度保留在原网站", "Courses and progress stay at the source") });
    }
  }

  private renderUnavailable(parent: HTMLElement, item: HomeModule): void {
    const card = parent.createDiv({ cls: "qh-card qh-card-compact" });
    card.dataset.module = item.id;
    const head = card.createDiv({ cls: "qh-card-head" });
    setIcon(head.createSpan({ cls: "qh-card-icon" }), item.icon);
    head.createSpan({ cls: "qh-card-title", text: item.title });
    const known = KNOWN_PLUGINS.find((plugin) => plugin.id === item.sourceId);
    if (known && commandExists(this.app, known.openCommand)) this.actionButton(head,
      { id: "open", label: t("legacy.open"), icon: "arrow-up-right", run: () => { runCommand(this.app, known.openCommand); } }, "qh-card-more", true);
    if ((item.status === "absent" || item.status === "disabled") && item.sourceId) {
      renderPluginGuide(card, this.app, { pluginId: item.sourceId, pluginName: known ? localized(known.name) : item.source,
        pitch: known ? localized(known.pitch) : item.description, state: item.status, repo: known?.repo });
      return;
    }
    const message = item.status === "ready" ? "layout.emptySource" : connectionState(this.app, item.sourceId!) === "incompatible" ? "legacy.incompatible" : "legacy.unavailable";
    card.createDiv({ cls: "qh-card-empty", text: t(message) });
    this.actionButton(head, { id: "retry", label: t("legacy.retry"), icon: "refresh-cw", run: () => this.refreshContent() }, "qh-card-more", false);
  }

  private renderRecommendations(parent: HTMLElement): void {
    const settings = this.plugin.settings;
    if (!currentPage(settings).showRecommendations) return;
    const missing = KNOWN_PLUGINS
      .map((plugin) => ({ plugin, state: installState(this.app, plugin.id) }))
      .filter(({ plugin, state }) => state !== "enabled" && !settings.hiddenRecommendations.includes(plugin.id));
    if (!missing.length) return;
    const card = parent.createDiv({ cls: "qh-card qh-card-recommend" });
    card.dataset.module = "recommendations";
    const head = card.createDiv({ cls: "qh-card-head" });
    setIcon(head.createSpan({ cls: "qh-card-icon" }), "sparkles");
    head.createSpan({ cls: "qh-card-title", text: t("section.recommend") });
    const list = card.createDiv({ cls: "qh-list" });
    for (const { plugin, state } of missing) {
      const row = list.createDiv({ cls: "qh-item qh-item-static" });
      setIcon(row.createDiv({ cls: "qh-thumb is-icon" }), plugin.icon);
      const body = row.createDiv({ cls: "qh-item-body" });
      body.createDiv({ cls: "qh-item-title", text: localized(plugin.name) });
      body.createDiv({ cls: "qh-item-sub", text: state === "disabled" ? t("recommend.installed") : localized(plugin.pitch) });
      const primary = row.createEl("button", { cls: "qh-pill", text: state === "disabled" ? t("recommend.enable") : t("recommend.install") });
      primary.addEventListener("click", () => state === "disabled" ? openCommunityPluginSettings(this.app) : openPluginPage(plugin.id));
      const hide = row.createEl("button", { cls: "qh-icon-button qh-item-action" });
      setIcon(hide, "x");
      hiddenLabel(hide, t("recommend.hide"));
      hide.addEventListener("click", () => {
        settings.hiddenRecommendations = [...settings.hiddenRecommendations, plugin.id];
        void this.plugin.saveSettings();
      });
    }
  }
}
