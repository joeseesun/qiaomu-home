import { BookmarkImportModal } from "./bookmark-import";
import { PRODUCTIVITY_MODULES, type ProductivityId } from "./productivity-catalog";
import { DISCOVERY_MODULES, defaultSites, parseSearchTemplates, type DiscoveryModuleId } from "./discovery";
import { isExtra } from "./extra-catalog";
import { INTEGRATIONS, isIntegration } from "./integrations";
import { FilePicker, defaultFolderLabel, folderDropdown, renderExtraOptions } from "./extra-ui";
import { renderTodoPreferences } from "./todo-ui";
import { SYNTAX_EXAMPLES, autoSave, flushFields } from "./option-fields";
import { renderHabitEditor } from "./habits";
import { GithubConnectModal, githubConnected } from "./github";
import { EXTENSION_PROMPT_EN, EXTENSION_PROMPT_ZH } from "./extension-prompt";
import { loadRegistry, SUBMIT_URL } from "./registry";
import { dailyOptions } from "./today";
import { MODULE_CATEGORIES, moduleCategory, type ModuleCategory } from "./module-categories";
import { validDay } from "./productivity-data";
import { ShortcutEditorModal } from "./shortcut-ui";
import { recentlyModified, reviewCandidates } from "./home-native-modules";
import { shortcutModuleId } from "./shortcuts";
import { Modal, Notice, Setting, setIcon } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { L, isChinese, t } from "./i18n";
import { builtinModules, pluginModules, type HomeModule } from "./module-catalog";
import { connectionSnapshot, connectionsChanged } from "./connections";
import { moduleOptions, moduleSource } from "./settings";
import { moveModule, setModule } from "./layout";
import { installState, openCommunityPluginSettings, openPluginPage } from "./ecosystem";

export class ModuleLibrary extends Modal {
  private list!: HTMLElement;
  private filters!: HTMLElement;
  private modules: HomeModule[] = [];
  private query = "";
  /** Remembered across openings in this session. */
  private static category: ModuleCategory | "all" = "all";
  private static onlyNew = false;
  private community: HomeModule[] = [];
  private communityState: "idle" | "loading" | "ready" | "error" = "idle";
  private generation = 0;
  private timer: number | null = null;
  private snapshot: unknown[] = [];

  constructor(private plugin: QiaomuHomePlugin, private pageId: string) {
    super(plugin.app); this.modalEl.addClass("qh-ui");
    plugin.register(() => this.close());
  }

  onOpen(): void {
    this.modalEl.addClass("qh-library-modal");
    const page = this.plugin.settings.pages.find((item) => item.id === this.pageId);
    this.setTitle(t("library.title"));
    this.contentEl.createDiv({ cls: "qh-library-context", text: t("library.target", { name: page?.name || t("pages.default") }) });
    new Setting(this.contentEl).setName(t("library.search"))
      .addSearch((input) => input.setPlaceholder(t("library.searchHint")).onChange((query) => { this.query = query; this.renderList(); }));
    this.filters = this.contentEl.createDiv({ cls: "qh-library-filters" });
    this.filters.setAttr("role", "toolbar");
    this.filters.setAttr("aria-label", L("按分类筛选", "Filter by category"));
    this.list = this.contentEl.createDiv({ cls: "qh-library-list" });
    void this.load();
    this.snapshot = connectionSnapshot(this.app);
    this.timer = window.setInterval(() => {
      const next = connectionSnapshot(this.app);
      if (connectionsChanged(this.snapshot, next)) { this.snapshot = next; void this.load(); }
    }, 1500);
  }

  private baseModules(): HomeModule[] {
    const page = this.plugin.settings.pages.find((item) => item.id === this.pageId);
    return [...builtinModules(), { id: "build-extension", title: L("用 AI 开发一个组件", "Build a card with AI"), source: L("乔木 Home 社区", "Qiaomu Home community"), icon: "wand-sparkles", status: "ready",
      description: L("复制开发提示词发给你的 Agent，做好后提交到社区，所有人都能用。", "Copy a prompt for your coding agent, then submit the result so everyone can use it.") }, ...this.community, { id: "import-bookmarks", title: L("导入浏览器书签", "Import browser bookmarks"), source: "Home", icon: "file-input", description: L("预览浏览器导出的 HTML，将网址加入快捷方式。", "Preview exported HTML bookmarks and import shortcuts."), status: "ready" }, { id: "new-shortcuts", title: L("快捷方式", "Shortcuts"), source: "Home", icon: "link", description: L("自定义笔记、文件夹和网址入口。", "Your notes, folders and websites."), status: "ready" },
      ...(page?.shortcutGroups ?? []).map((group): HomeModule => ({ id: shortcutModuleId(group.id), title: group.name, source: "Home", icon: "link", description: L("已添加的快捷方式", "Saved shortcuts"), status: "ready", preview: group.items.map((item) => item.name || item.target) }))];
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.modules = this.baseModules();
    this.renderList();
    const sources = await pluginModules(this.app, this.plugin.settings.pages.flatMap((page) => Object.keys(page.moduleOptions).map(moduleSource).filter((id): id is string => Boolean(id))));
    if (generation !== this.generation) return;
    this.modules = [...this.baseModules(), ...sources];
    this.renderList();
  }

  private loadCommunity(retry = false): void {
    // Load once per opening; after a failure only an explicit retry fetches again.
    if (this.communityState !== "idle" && !(retry && this.communityState === "error")) return;
    this.communityState = "loading";
    void loadRegistry().then(entries => {
      this.community = entries.map((entry): HomeModule => {
        const state = installState(this.app, entry.id);
        return { id: `community:${entry.id}`, title: L(entry.name.zh, entry.name.en), source: entry.author || entry.id, icon: entry.icon,
          description: L(entry.description.zh, entry.description.en), status: state === "enabled" ? "ready" : state, community: entry };
      });
      this.communityState = "ready";
    }).catch(() => { this.communityState = "error"; }).finally(() => { if (this.list?.isConnected) { this.modules = [...this.baseModules(), ...this.modules.filter(item => item.sourceId)]; this.renderList(); } });
  }

  private isAdded(item: HomeModule): boolean {
    if (item.community || item.id === "build-extension") return false;
    return !["new-shortcuts", "import-bookmarks"].includes(item.id) && moduleOptions(this.plugin.settings, item.id, this.pageId).visible;
  }

  private renderFilters(modules: HomeModule[]): void {
    const focused = this.filters.contains(this.filters.ownerDocument.activeElement) ? (this.filters.ownerDocument.activeElement as HTMLElement).dataset.category : null;
    this.filters.empty();
    const chip = (id: string, label: string, count: number, icon?: string) => {
      const button = this.filters.createEl("button", { cls: "qh-library-chip" });
      if (icon) setIcon(button.createSpan({ cls: "qh-library-chip-icon" }), icon);
      button.createSpan({ text: label });
      button.createSpan({ cls: "qh-library-count", text: String(count) });
      button.dataset.category = id;
      button.setAttr("aria-pressed", String(id === ModuleLibrary.category));
      button.addEventListener("click", () => { ModuleLibrary.category = id as ModuleCategory | "all"; this.renderList(); });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const chips = Array.from(this.filters.querySelectorAll<HTMLElement>(".qh-library-chip"));
        chips[(chips.indexOf(button) + (event.key === "ArrowRight" ? 1 : -1) + chips.length) % chips.length]?.focus();
        event.preventDefault();
      });
      if (focused === id) window.setTimeout(() => button.focus());
    };
    chip("all", L("全部", "All"), modules.length);
    for (const category of MODULE_CATEGORIES) {
      const count = modules.filter((item) => moduleCategory(item.id, item.sourceId) === category.id).length;
      if (count || ModuleLibrary.category === category.id || category.id === "community") chip(category.id, L(category.zh, category.en), count, category.icon);
    }
    const toggle = this.filters.createEl("label", { cls: "qh-library-only-new" });
    const box = toggle.createEl("input", { type: "checkbox" });
    box.checked = ModuleLibrary.onlyNew;
    toggle.createSpan({ text: L("只看未添加", "Not added only") });
    box.addEventListener("change", () => { ModuleLibrary.onlyNew = box.checked; this.renderList(); });
  }

  private renderList(): void {
    if (!this.list) return;
    this.list.empty();
    const page = this.plugin.settings.pages.find((item) => item.id === this.pageId);
    if (!page) { this.close(); return; }
    const query = this.query.trim().toLocaleLowerCase();
    const categoryName = (item: HomeModule) => {
      const category = MODULE_CATEGORIES.find((entry) => entry.id === moduleCategory(item.id, item.sourceId))!;
      return `${category.zh} ${category.en}`;
    };
    const searched = this.modules.filter((item) => !ModuleLibrary.onlyNew || !this.isAdded(item))
      .filter((item) => `${item.title} ${item.source} ${item.description} ${(item.preview ?? []).join(" ")} ${categoryName(item)}`.toLocaleLowerCase().includes(query));
    this.renderFilters(searched);
    const modules = searched.filter((item) => ModuleLibrary.category === "all" || moduleCategory(item.id, item.sourceId) === ModuleLibrary.category);
    if (ModuleLibrary.category === "community") {
      this.loadCommunity();
      const note = this.list.createDiv({ cls: "qh-library-note" });
      setIcon(note.createSpan(), this.communityState === "error" ? "wifi-off" : "globe");
      note.createSpan({ text: this.communityState === "loading" ? (L("正在从 GitHub 读取社区组件…", "Loading community extensions from GitHub…"))
        : this.communityState === "error" ? (L("社区列表暂时读取失败，请检查网络", "Could not load the community list; check your connection"))
        : (L("社区组件由作者维护，安装前可查看源码仓库。列表只在打开此分类时从 GitHub 读取。", "Community extensions are maintained by their authors; review the repository before installing. The list is fetched from GitHub only when you open this category.")) });
      if (this.communityState === "error") {
        const retry = note.createEl("button", { cls: "qh-library-retry", text: L("重试", "Retry") });
        retry.addEventListener("click", () => { this.loadCommunity(true); this.renderList(); });
      }
    }
    if (!modules.length) { this.list.createDiv({ cls: "qh-library-empty", text: t("library.noResults") }); return; }
    const groups = ModuleLibrary.category === "all" && !query
      ? MODULE_CATEGORIES.map((category) => ({ category, items: modules.filter((item) => moduleCategory(item.id, item.sourceId) === category.id) })).filter((group) => group.items.length)
      : [{ category: null, items: modules }];
    for (const group of groups) {
      if (group.category) {
        const heading = this.list.createEl("h3", { cls: "qh-library-group" });
        setIcon(heading.createSpan(), group.category.icon);
        heading.createSpan({ text: L(group.category.zh, group.category.en) });
        heading.createSpan({ cls: "qh-library-count", text: String(group.items.length) });
      }
      const grid = this.list.createDiv({ cls: "qh-library-grid" });
      for (const item of group.items) this.renderModule(grid, item);
    }
  }

  private renderModule(grid: HTMLElement, item: HomeModule): void {
    if (item.id === "build-extension") { this.renderBuildCard(grid, item); return; }
    const added = this.isAdded(item);
    const card = grid.createDiv({ cls: "qh-library-module" });
    card.dataset.module = item.id;
    card.toggleClass("is-added", added);
    const head = card.createDiv({ cls: "qh-library-heading" });
    setIcon(head.createSpan(), item.icon);
    head.createSpan({ text: item.title });
    if (added) head.createSpan({ cls: "qh-library-badge", text: t("library.added") });
    card.createDiv({ cls: "qh-library-source", text: item.source });
    const names = item.section?.items.slice(0, 3).map((entry) => entry.title) ?? [...(item.preview ?? [])];
    if (item.id === "recent") names.push(...this.app.workspace.getLastOpenFiles().slice(0, 3).map((path) => path.split("/").pop() ?? path));
    if (item.id === "recently-modified") names.push(...recentlyModified(this.app, 3).map((file) => file.basename));
    if (item.id === "review-note") names.push(...reviewCandidates(this.app, this.plugin.settings.reviewFolder).slice(0, 3).map((file) => file.basename));
    // Only real content earns a preview box; placeholders made 50+ cards hard to scan.
    if (names.length) {
      const preview = card.createDiv({ cls: "qh-library-preview" });
      for (const name of names.slice(0, 3)) preview.createDiv({ cls: "qh-library-preview-line", text: name });
    }
    card.createDiv({ cls: "qh-library-description", text: item.description });
    if (item.requires && installState(this.app, item.requires) !== "enabled") {
      const need = card.createDiv({ cls: "qh-library-requires" });
      setIcon(need.createSpan(), "package");
      need.createSpan({ text: L("需要 {source} 插件，添加后卡片会引导安装", "Uses {source}; the card guides installation", { source: item.source }) });
    }
    const ready = item.status === "ready";
    if (!ready) card.createDiv({ cls: "qh-library-status", text: t(item.status === "absent" ? "library.needsPlugin" : item.status === "disabled" ? "library.disabled" : "legacy.unavailable") });
    const actions = card.createDiv({ cls: "qh-library-actions" });
    if (ready && added) {
      const remove = actions.createEl("button", { text: L("从此页移除", "Remove") });
      remove.setAttr("aria-label", L("从此页移除{title}", "Remove {title} from this page", { title: item.title }));
      remove.addEventListener("click", () => this.setVisible(item, false, remove));
      return;
    }
    const label = item.community ? (ready ? (L("去插件联动添加卡片", "Add its cards")) : item.status === "disabled" ? t("library.enable") : item.community.store ? t("library.install") : (L("查看仓库", "View repository")))
      : ready ? t("library.add")
      : item.status === "absent" ? t("library.install") : item.status === "disabled" ? t("library.enable") : t("legacy.retry");
    const button = actions.createEl("button", { cls: ready || item.community ? "mod-cta" : "", text: label });
    if (item.community) {
      const repo = actions.createEl("button", { text: L("源码", "Source") });
      repo.addEventListener("click", () => window.open(item.community!.repo, "_blank", "noopener,noreferrer"));
    }
    button.setAttr("aria-label", `${label} ${item.title}`);
    button.addEventListener("click", () => {
      if (item.id === "import-bookmarks") { this.close(); new BookmarkImportModal(this.plugin, this.pageId).open(); return; }
      if (item.id === "new-shortcuts") { this.close(); new ShortcutEditorModal(this.plugin, this.pageId).open(); return; }
      if (item.community) {
        // Installed community plugins provide their cards under Integrations; send the user there.
        if (ready) { ModuleLibrary.category = "plugins"; this.query = ""; void this.load(); return; }
        if (item.status === "disabled") openCommunityPluginSettings(this.app);
        else if (item.community.store) openPluginPage(item.community.id);
        else window.open(item.community.repo, "_blank", "noopener,noreferrer");
        return;
      }
      if (!ready) {
        if (item.status === "absent" && item.sourceId) openPluginPage(item.sourceId);
        else if (item.status === "disabled") openCommunityPluginSettings(this.app);
        else void this.load();
        return;
      }
      this.setVisible(item, true, button);
    });
  }

  private renderBuildCard(grid: HTMLElement, item: HomeModule): void {
    const card = grid.createDiv({ cls: "qh-library-module qh-library-build" });
    card.dataset.module = item.id;
    const head = card.createDiv({ cls: "qh-library-heading" });
    setIcon(head.createSpan(), item.icon);
    head.createSpan({ text: item.title });
    card.createDiv({ cls: "qh-library-description", text: item.description });
    const steps = card.createEl("ol", { cls: "qh-library-steps" });
    for (const step of [L("复制提示词，填上你的想法", "Copy the prompt and add your idea"), L("发给 Claude Code、Codex 等 Agent", "Give it to Claude Code, Codex or another agent"),
      L("装进测试库，在「插件联动」添加", "Install it in a test vault and add it under Integrations"), L("提交到社区，审核后所有人可用", "Submit it; once accepted everyone can use it")]) steps.createEl("li", { text: step });
    const actions = card.createDiv({ cls: "qh-library-actions" });
    const copy = actions.createEl("button", { cls: "mod-cta", text: L("复制开发提示词", "Copy prompt") });
    copy.addEventListener("click", () => void navigator.clipboard.writeText(isChinese() ? EXTENSION_PROMPT_ZH : EXTENSION_PROMPT_EN)
      .then(() => { copy.setText(L("已复制 ✓", "Copied ✓")); window.setTimeout(() => copy.setText(L("复制开发提示词", "Copy prompt")), 2000); })
      .catch(() => new Notice(L("复制失败", "Copy failed"))));
    const submit = actions.createEl("button", { text: L("提交组件", "Submit") });
    submit.addEventListener("click", () => window.open(SUBMIT_URL, "_blank", "noopener,noreferrer"));
  }

  /** Adds or removes a card on the target page and rolls back if saving fails. */
  private setVisible(item: HomeModule, visible: boolean, button: HTMLButtonElement): void {
    const target = this.plugin.settings.pages.find((entry) => entry.id === this.pageId);
    if (!target) { this.close(); return; }
    button.disabled = true;
    const previous = target.moduleOptions[item.id];
    const previousOrder = [...target.moduleOrder];
    if (visible) {
      // Materialize current order before appending, so adding does not move existing cards.
      if (!target.moduleOrder.length) target.moduleOrder = this.modules.filter((entry) => moduleOptions(this.plugin.settings, entry.id, target.id).visible).map((entry) => entry.id);
      if (!target.moduleOrder.includes(item.id)) target.moduleOrder.push(item.id);
    }
    setModule(this.plugin.settings, target.id, item.id, { visible });
    const changed = target.moduleOptions[item.id];
    void this.plugin.saveSettings().then(() => {
      if (visible) new Notice(L("已添加「{title}」", "Added “{title}”", { title: item.title }));
      if (this.list.isConnected) this.renderList();
    }).catch(() => {
      if (target.moduleOptions[item.id] === changed) {
        if (previous) target.moduleOptions[item.id] = previous;
        else delete target.moduleOptions[item.id];
        target.moduleOrder = previousOrder;
      }
      new Notice(t("layout.saveFailed"));
      if (this.list.isConnected) this.renderList();
    });
  }

  onClose(): void {
    this.generation++;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.contentEl.empty();
  }
}

export class ModuleOptionsModal extends Modal {
  constructor(private plugin: QiaomuHomePlugin, private pageId: string, private moduleId: string, private name: string) { super(plugin.app); this.modalEl.addClass("qh-ui"); }
  onOpen(): void {
    this.setTitle(this.name);
    const options = moduleOptions(this.plugin.settings, this.moduleId, this.pageId);
    const persist = async (change: Partial<typeof options>) => {
      const page = this.plugin.settings.pages.find(page => page.id === this.pageId);
      if (!page) { this.close(); return; }
      const previous = page.moduleOptions[this.moduleId];
      const next = { ...moduleOptions(this.plugin.settings, this.moduleId, this.pageId), ...change };
      page.moduleOptions[this.moduleId] = next;
      try { await this.plugin.saveSettings(); return true; }
      catch { if (page.moduleOptions[this.moduleId] === next) { if (previous) page.moduleOptions[this.moduleId] = previous; else delete page.moduleOptions[this.moduleId]; } new Notice(t("layout.saveFailed")); return false; }
    };
    const about = builtinModules().find(item => item.id === this.moduleId);
    if (about) this.contentEl.createEl("p", { cls: "qh-options-about", text: about.description });
    if (isExtra(this.moduleId)) { renderExtraOptions(this.contentEl, this.plugin, this.pageId, this.moduleId, persist); return; }
    if (isIntegration(this.moduleId)) {
      const integration = INTEGRATIONS[this.moduleId];
      const state = installState(this.app, integration.plugin);
      if (state !== "enabled") new Setting(this.contentEl).setName(L("需要 {pluginName}", "Requires {pluginName}", { pluginName: integration.pluginName }))
        .setDesc(state === "disabled" ? L("已安装但未启用", "Installed but off") : L("尚未安装", "Not installed"))
        .addButton(button => button.setButtonText(state === "disabled" ? L("去启用", "Turn on") : L("安装", "Install")).setCta()
          .onClick(() => state === "disabled" ? openCommunityPluginSettings(this.app) : openPluginPage(integration.plugin)));
      if (this.moduleId === "dataview-query") {
        const wrap = this.contentEl.createDiv();
        const render = () => {
          wrap.empty();
          const current = moduleOptions(this.plugin.settings, this.moduleId, this.pageId);
          const view = current.view ?? "notes", sourceKind = current.sourceKind ?? "all";
          new Setting(wrap).setName(L("显示内容", "Content")).setDesc(L("把符合条件的笔记、属性或任务放到卡片上。", "Show matching notes, properties, or tasks on the card."))
            .addDropdown(dropdown => dropdown.addOptions({ notes: L("笔记列表", "Notes"), table: L("属性表格", "Property table"), tasks: L("任务", "Tasks") })
              .setValue(view).onChange(value => { void persist({ view: value as "table" | "tasks" }); render(); }));
          new Setting(wrap).setName(L("范围", "Scope"))
            .addDropdown(dropdown => dropdown.addOptions({ all: L("整个知识库", "Whole vault"), tag: L("带某个标签的笔记", "Notes with a tag"), folder: L("某个文件夹", "A folder") })
              .setValue(sourceKind).onChange(value => { void persist({ sourceKind: value as "tag" | "folder" }); render(); }));
          if (sourceKind === "tag") {
            const setting = new Setting(wrap).setName(L("标签", "Tag")).setDesc(L("填笔记上已有的标签，不用带 # 号。", "A tag your notes already use, without the #."));
            setting.addText(input => { input.setPlaceholder(L("例如：项目", "e.g. project")); input.setValue(current.sourceValue ?? ""); autoSave(this.contentEl, setting, input.inputEl, value => persist({ sourceValue: value })); });
          }
          if (sourceKind === "folder") folderDropdown(wrap, this.plugin, L("文件夹", "Folder"), L("整个知识库", "Whole vault"), current.sourceValue ?? "", value => { void persist({ sourceValue: value }); });
          if (view === "table") {
            const setting = new Setting(wrap).setName(L("显示哪些属性", "Properties to show")).setDesc(L("笔记属性里的字段名，用逗号分隔。留空则按笔记列表显示。", "Frontmatter property names, comma separated. Empty falls back to notes."));
            setting.addText(input => { input.setPlaceholder(L("例如：状态, 截止", "e.g. status, due")); input.setValue(current.fields ?? ""); autoSave(this.contentEl, setting, input.inputEl, value => persist({ fields: value })); });
          }
          if (view === "tasks") new Setting(wrap).setName(L("只看未完成", "Only unfinished")).addToggle(toggle => toggle.setValue(current.onlyOpen ?? true).onChange(value => { void persist({ onlyOpen: value }); }));
          new Setting(wrap).setName(L("排序", "Sort")).addDropdown(dropdown => dropdown.addOptions({ mtime: L("最近修改优先", "Recently edited first"), ctime: L("最近创建优先", "Recently created first"), name: L("按名称", "By name") })
            .setValue(current.sortBy ?? "mtime").onChange(value => { void persist({ sortBy: value as "ctime" | "name" }); }));
        };
        render();
      }
      if (["dataview-query", "kanban-boards", "excalidraw-drawings", "omnisearch", "quickadd-actions"].includes(this.moduleId)) new Setting(this.contentEl).setName(t("layout.count"))
        .addDropdown(dropdown => dropdown.addOptions(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])))
          .setValue(String(moduleOptions(this.plugin.settings, this.moduleId, this.pageId).limit)).onChange(value => { void persist({ limit: Number(value) }); }));
      return;
    }
    if (this.moduleId === "countdown") {
      const save = async (change: Partial<typeof this.plugin.settings.countdown>) => {
        const previous = this.plugin.settings.countdown;
        this.plugin.settings.countdown = { ...previous, ...change };
        try { await this.plugin.saveSettings(); } catch (error) { this.plugin.settings.countdown = previous; throw error; }
      };
      const name = new Setting(this.contentEl).setName(L("日期名称", "Event name"));
      name.addText(input => { input.setPlaceholder(L("例如：旅行出发", "e.g. Trip starts")).setValue(this.plugin.settings.countdown.label); autoSave(this.contentEl, name, input.inputEl, value => save({ label: value.trim().slice(0, 80) })); });
      const day = new Setting(this.contentEl).setName(L("日期", "Date"));
      day.addText(input => { input.inputEl.type = "date"; input.setValue(this.plugin.settings.countdown.date);
        autoSave(this.contentEl, day, input.inputEl, value => { if (!validDay(value)) throw new Error(L("请选择有效日期", "Choose a valid date")); return save({ date: value }); }); });
      if (!this.plugin.settings.countdown.date) window.setTimeout(() => name.controlEl.querySelector("input")?.focus());
      return;
    }
    if (Object.hasOwn(DISCOVERY_MODULES, this.moduleId)) {
      const config = DISCOVERY_MODULES[this.moduleId as DiscoveryModuleId];
      if (this.moduleId === "dev-inbox") {
        new Setting(this.contentEl).setName(L("GitHub 账号", "GitHub account")).setDesc(githubConnected(this.plugin) ? L("已连接，卡片会列出你的 PR 和 Issue", "Connected; the card lists your pull requests and issues") : L("未连接，卡片只显示网页入口", "Not connected; the card shows links only"))
          .addButton(button => button.setButtonText(githubConnected(this.plugin) ? L("管理连接", "Manage") : L("连接 GitHub", "Connect GitHub")).setCta().onClick(() => { this.close(); new GithubConnectModal(this.plugin).open(); }));
        new Setting(this.contentEl).setName(t("layout.count")).addDropdown(dropdown => dropdown.addOptions(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])))
          .setValue(String(options.limit)).onChange(value => { void persist({ limit: Number(value) }); }));
      }
      const multi = this.moduleId === "multi-search";
      new Setting(this.contentEl).setHeading().setName(multi ? L("默认一起搜索的网站", "Sites searched together") : L("卡片上显示的来源", "Sources shown on the card"));
      for (const site of config.sites) new Setting(this.contentEl).setName(L(site.zh, site.en)).setDesc(new URL(site.home).hostname).addToggle(toggle => toggle.setValue((options.sites ?? defaultSites(config.sites)).includes(site.id)).onChange(async enabled => {
        const current = moduleOptions(this.plugin.settings, this.moduleId, this.pageId).sites ?? defaultSites(config.sites);
        const next = enabled ? [...new Set([...current, site.id])] : current.filter(id => id !== site.id);
        if (!multi && !next.some(id => config.sites.some(entry => entry.id === id))) { new Notice(L("至少保留一个来源", "Keep at least one source")); toggle.setValue(true); return; }
        await persist({ sites: next });
      }));
      if (multi) {
        new Setting(this.contentEl).setName(L("回车时", "On Enter")).addDropdown(dropdown => dropdown.addOptions({ all: L("打开所有点亮的网站", "Open every highlighted site"), first: L("只打开第一个点亮的网站", "Open only the first highlighted site") })
          .setValue(options.openAll === false ? "first" : "all").onChange(value => { void persist({ openAll: value === "all" }); }));
        const custom = new Setting(this.contentEl).setName(L("自定义搜索网站", "Custom search sites")).setDesc(L("每行一个，最多八个：名称 | https://example.com/?q={query}。离开输入框或按 ⌘↵ 保存。", "One per line, up to eight: Name | https://example.com/?q={query}. Saves when you leave the field or press ⌘↵."));
        custom.addTextArea(input => { input.inputEl.rows = 4; input.setPlaceholder("知乎 | https://www.zhihu.com/search?q={query}").setValue((options.customSites ?? []).map(site => `${site.name} | ${site.url}`).join("\n"));
          autoSave(this.contentEl, custom, input.inputEl, value => {
            const customSites = parseSearchTemplates(value);
            const previous = moduleOptions(this.plugin.settings, this.moduleId, this.pageId);
            const sites = [...(previous.sites ?? defaultSites(config.sites)).filter(id => !id.startsWith("custom:")), ...customSites.map(site => `custom:${site.url}`)];
            return persist({ customSites, sites });
          }); });
      } else if (config.sites.some(site => site.search)) this.contentEl.createEl("p", { cls: "qh-native-scope", text: L("按回车时使用第一个显示的来源；网络请求只在点击后发生。", "Enter uses the first shown source; nothing is requested until you click.") });
      return;
    }
    const config = PRODUCTIVITY_MODULES[this.moduleId as ProductivityId];
    if (config?.folder) folderDropdown(this.contentEl, this.plugin,
      this.moduleId === "template-create" ? L("新笔记保存到", "Save new notes to") : this.moduleId === "project-next" ? L("项目文件夹", "Project folder") : L("笔记范围", "Note folder"),
      this.moduleId === "template-create" ? defaultFolderLabel(this.plugin) : this.moduleId === "project-next" ? L("尚未选择", "Not chosen") : L("整个知识库", "Whole vault"),
      options.folder ?? "", value => { void persist({ folder: value }); });
    if (this.moduleId === "due-today") new Setting(this.contentEl).setName(L("同时列出逾期任务", "Include overdue tasks")).setDesc(L("默认在没有「逾期」卡片的页面上开启。", "On by default when this page has no Overdue card."))
      .addToggle(toggle => toggle.setValue(options.includeOverdue ?? !moduleOptions(this.plugin.settings, "overdue", this.pageId).visible).onChange(value => { void persist({ includeOverdue: value }); }));
    if (["due-today", "overdue", "milestones"].includes(this.moduleId)) this.contentEl.createEl("p", { cls: "qh-native-scope", text: L("识别 Tasks 插件的 📅 截止 / ⏳ 计划 / 🛫 开始日期，以及 Dataview 的 [due:: ] 或 (due:: )。启用 Tasks 插件时，勾选会写入完成日期并生成重复任务的下一次。", "Recognizes Tasks 📅 due / ⏳ scheduled / 🛫 start dates and Dataview [due:: ] or (due:: ). With the Tasks plugin on, completing adds the done date and creates the next recurrence.") });
    if (config?.path) {
      const setting = new Setting(this.contentEl).setName(this.moduleId === "template-create" ? L("模板笔记", "Template note") : L("来源笔记", "Source note")).setDesc(options.path || L("尚未选择", "Not selected"));
      setting.addButton(button => button.setButtonText(L("选择笔记", "Choose note")).onClick(() => new FilePicker(this.plugin, ["md"], file => { void persist({ path: file.path }).then(() => { setting.setDesc(moduleOptions(this.plugin.settings, this.moduleId, this.pageId).path ?? ""); }); }).open()));
    }
    if (this.moduleId === "habit-checkin") { renderHabitEditor(this.contentEl, this.plugin, this.pageId); return; }
    if (this.moduleId === "working-set") { this.contentEl.createEl("p", { text: L("在卡片上保存当前笔记组；恢复时会跳过已打开的笔记。", "Save open notes on the card. Restore skips notes already open.") }); return; }
    if (this.moduleId === "saved-search") {
      const setting = new Setting(this.contentEl).setName(L("搜索条件", "Search query")).setDesc(L('例如：tag:#工作 path:"Projects"。回车或离开输入框即保存。', 'For example: tag:#work path:"Projects". Saves on Enter or when you leave the field.'));
      setting.addText(input => { input.inputEl.placeholder = SYNTAX_EXAMPLES.search; input.setValue(options.query ?? ""); autoSave(this.contentEl, setting, input.inputEl, value => persist({ query: value.trim().slice(0, 500) })); window.setTimeout(() => input.inputEl.focus()); });
      return;
    }
    if (this.moduleId === "focus-timer") {
      new Setting(this.contentEl).setName(L("每次专注时长", "Session duration")).setDesc(L("正在运行的计时保持不变；重置或下次开始时采用新时长。", "Running sessions keep their deadline; reset or start again to use the new duration.")).addDropdown(dropdown => dropdown.addOptions(Object.fromEntries([5, 15, 25, 45, 60, 90].map(minutes => [String(minutes), L("{minutes} 分钟", "{minutes} minutes", { minutes })]))).setValue(String(this.plugin.settings.focusSession.durationMinutes)).onChange(async value => {
        const previous = this.plugin.settings.focusSession;
        const idle = !previous.endAt && previous.kind === "focus" && previous.remainingMs === previous.durationMinutes * 60000;
        this.plugin.settings.focusSession = { ...previous, focusMinutes: Number(value), ...(idle ? { durationMinutes: Number(value), remainingMs: Number(value) * 60000 } : {}) };
        try { await this.plugin.saveSettings(); } catch { this.plugin.settings.focusSession = previous; new Notice(t("layout.saveFailed")); }
      }));
      new Setting(this.contentEl).setName(L("结束提示音", "Chime when a session ends"))
        .addToggle(toggle => toggle.setValue(this.plugin.settings.focusSound).onChange(async value => {
          this.plugin.settings.focusSound = value;
          try { await this.plugin.saveSettings({ rerender: false }); } catch { this.plugin.settings.focusSound = !value; toggle.setValue(!value); new Notice(t("layout.saveFailed")); }
        }));
      new Setting(this.contentEl).setName(L("完成后记入今日日记", "Log to today's daily note")).setDesc(L("写入一行，例如「- 09:00–09:25 专注 25 分钟 · 今日重点」。需要启用日记核心插件。", "Adds a line such as “- 09:00–09:25 Focused 25 min · today's focus”. Requires Daily notes."))
        .addToggle(toggle => toggle.setValue(this.plugin.settings.focusLog).onChange(async value => {
          this.plugin.settings.focusLog = value;
          try { await this.plugin.saveSettings({ rerender: false }); } catch { this.plugin.settings.focusLog = !value; toggle.setValue(!value); new Notice(t("layout.saveFailed")); }
        }));
      return;
    }
    if (this.moduleId === "template-create") this.contentEl.createEl("p", { text: L("支持 {{title}}、{{date}}、{{time}}，不执行 Templater 脚本。留空文件夹时使用 Obsidian 默认新笔记位置。", "Supports {{title}}, {{date}} and {{time}}; Templater scripts are not executed. An empty folder uses the default new-note location.") });
    if (config && !config.count) return;
    if (this.moduleId === "daily-focus") { this.contentEl.createEl("p", { text: L("直接在卡片上编辑今天的重点。", "Edit today's focus directly on the card.") }); return; }
    if (this.moduleId === "review-note") {
      new Setting(this.contentEl).setName(L("跳过日记", "Skip daily notes")).setDesc(L("日记通常占库里大多数，跳过后更容易抽到值得回顾的笔记。", "Daily notes usually dominate a vault; skipping them surfaces notes worth revisiting."))
        .addToggle(toggle => toggle.setValue(this.plugin.settings.reviewExcludeDaily).onChange(async value => {
          this.plugin.settings.reviewExcludeDaily = value;
          try { await this.plugin.saveSettings(); } catch { this.plugin.settings.reviewExcludeDaily = !value; toggle.setValue(!value); new Notice(t("layout.saveFailed")); }
        }));
      if (this.plugin.settings.reviewExcluded.length) new Setting(this.contentEl).setName(L("已设为不再出现：{length} 篇", "Hidden from review: {length} notes", { length: this.plugin.settings.reviewExcluded.length }))
        .addButton(button => button.setButtonText(L("全部恢复", "Restore all")).onClick(async () => {
          const previous = this.plugin.settings.reviewExcluded;
          this.plugin.settings.reviewExcluded = [];
          try { await this.plugin.saveSettings(); this.contentEl.empty(); this.onOpen(); } catch { this.plugin.settings.reviewExcluded = previous; new Notice(t("layout.saveFailed")); }
        }));
      this.contentEl.createEl("p", { cls: "qh-native-scope", text: L("回顾过的笔记 30 天内不再抽到；越久没动过的笔记越容易被抽到。", "Reviewed notes rest for 30 days; notes untouched for longer come up more often.") });
      folderDropdown(this.contentEl, this.plugin, L("回顾范围", "Review folder"), L("整个知识库（不含模板）", "Whole vault (templates excluded)"), this.plugin.settings.reviewFolder, value => {
        const previous = this.plugin.settings.reviewFolder;
        this.plugin.settings.reviewFolder = value;
        void this.plugin.saveSettings().catch(() => { this.plugin.settings.reviewFolder = previous; new Notice(t("layout.saveFailed")); });
      });
      return;
    }
    if (this.moduleId === "todo") { renderTodoPreferences(this.contentEl, this.plugin, () => { this.contentEl.empty(); this.onOpen(); }); }
    if (this.moduleId === "inbox-preview") {
      const setting = new Setting(this.contentEl).setName(L("收件箱笔记", "Inbox note")).setDesc(this.plugin.settings.captureInboxPath);
      setting.addButton(button => button.setButtonText(L("选择笔记", "Choose note")).onClick(() => new FilePicker(this.plugin, ["md"], file => {
        const previous = this.plugin.settings.captureInboxPath;
        this.plugin.settings.captureInboxPath = file.path; setting.setDesc(file.path);
        void this.plugin.saveSettings().catch(() => { this.plugin.settings.captureInboxPath = previous; setting.setDesc(previous); new Notice(t("layout.saveFailed")); });
      }).open()));
      this.contentEl.createEl("p", { cls: "qh-native-scope", text: L("与快速记录、搜索框 ⇧↵ 记录共用同一篇笔记。", "Shared with Quick capture and Shift+Enter capture in search.") });
    }
    if (this.moduleId === "recently-modified") new Setting(this.contentEl).setName(L("不显示日记、收件箱和任务笔记", "Hide daily notes, Inbox and task note")).setDesc(L("它们天天在改，会把其他笔记挤出列表。", "They change every day and would push everything else out."))
      .addToggle(toggle => toggle.setValue(options.excludeDaily !== false).onChange(value => { void persist({ excludeDaily: value }); }));
    if (this.moduleId === "recently-modified") folderDropdown(this.contentEl, this.plugin, L("笔记范围", "Note folder"), L("整个知识库", "Whole vault"), options.folder ?? "", value => { void persist({ folder: value }); });
    if (["daily-preview", "daily-timeline", "daily-calendar", "habit-checkin"].includes(this.moduleId)) {
      const info = new Setting(this.contentEl).setName(L("日记位置", "Daily notes")).setDesc(L("读取中…", "Loading…"));
      // Braced bodies: Obsidian's Setting has a `then` method, so returning it from a promise callback loops forever.
      void dailyOptions(this.app).then(config => { info.setDesc(L("文件夹：{v} · 格式：{v2}（由日记核心插件设置）", "Folder: {v} · Format: {v2} (Daily notes core plugin)", { v: config.folder || "/", v2: config.format || "YYYY-MM-DD" })); })
        .catch(() => { info.setDesc(L("日记核心插件未启用", "Daily notes is not enabled")); });
      info.addButton(button => button.setButtonText(L("日记设置", "Daily notes settings")).onClick(() => {
        const setting = (this.app as unknown as { setting?: { open?(): void; openTabById?(id: string): void } }).setting;
        setting?.open?.(); setting?.openTabById?.("daily-notes");
      }));
    }
    new Setting(this.contentEl).setName(t("layout.count"))
      .addDropdown((dropdown) => dropdown.addOptions(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])))
        .setValue(String(moduleOptions(this.plugin.settings, this.moduleId, this.pageId).limit))
        .onChange(async (value) => {
          if (!setModule(this.plugin.settings, this.pageId, this.moduleId, { limit: Number(value) })) { this.close(); return; }
          try { await this.plugin.saveSettings(); }
          catch { new Notice(t("layout.saveFailed")); }
        }));
  }
  onClose(): void { flushFields(this.contentEl); this.contentEl.empty(); }
}

export class MoveModuleModal extends Modal {
  constructor(private plugin: QiaomuHomePlugin, private pageId: string, private moduleId: string) { super(plugin.app); this.modalEl.addClass("qh-ui"); }
  onOpen(): void {
    this.setTitle(t("layout.move"));
    const targets = this.plugin.settings.pages.filter((page) => page.id !== this.pageId);
    if (!targets.length) this.contentEl.createEl("p", { text: t("layout.singlePage") });
    for (const page of targets) {
      const exists = moduleOptions(this.plugin.settings, this.moduleId, page.id).visible;
      new Setting(this.contentEl).setName(page.name || t("pages.default"))
        .addButton((button) => button.setButtonText(t(exists ? "library.added" : "layout.move")).setDisabled(exists).onClick(async () => {
          if (!moveModule(this.plugin.settings, this.pageId, page.id, this.moduleId)) { this.close(); return; }
          button.setDisabled(true);
          try { await this.plugin.saveSettings(); this.close(); }
          catch { new Notice(t("layout.saveFailed")); this.close(); }
        }));
    }
  }
  onClose(): void { this.contentEl.empty(); }
}
