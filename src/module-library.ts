import { ShortcutEditorModal } from "./shortcut-ui";
import { shortcutModuleId } from "./shortcuts";
import { Modal, Notice, Setting, setIcon } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { isChinese, t } from "./i18n";
import { builtinModules, pluginModules, type HomeModule } from "./module-catalog";
import { connectionSnapshot, connectionsChanged } from "./connections";
import { moduleOptions, moduleSource } from "./settings";
import { moveModule, setModule } from "./layout";
import { openCommunityPluginSettings, openPluginPage } from "./ecosystem";

export class ModuleLibrary extends Modal {
  private list!: HTMLElement;
  private modules: HomeModule[] = [];
  private query = "";
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
    this.list = this.contentEl.createDiv({ cls: "qh-library-grid" });
    void this.load();
    this.snapshot = connectionSnapshot(this.app);
    this.timer = window.setInterval(() => {
      const next = connectionSnapshot(this.app);
      if (connectionsChanged(this.snapshot, next)) { this.snapshot = next; void this.load(); }
    }, 1500);
  }

  private baseModules(): HomeModule[] {
    const page = this.plugin.settings.pages.find((item) => item.id === this.pageId);
    return [...builtinModules(), { id: "new-shortcuts", title: isChinese() ? "快捷方式" : "Shortcuts", source: "Home", icon: "link", description: isChinese() ? "自定义笔记、文件夹和网址入口。" : "Your notes, folders and websites.", status: "ready" },
      ...(page?.shortcutGroups ?? []).map((group): HomeModule => ({ id: shortcutModuleId(group.id), title: group.name, source: "Home", icon: "link", description: isChinese() ? "已添加的快捷方式" : "Saved shortcuts", status: "ready", preview: group.items.map((item) => item.name || item.target) }))];
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

  private renderList(): void {
    if (!this.list) return;
    this.list.empty();
    const page = this.plugin.settings.pages.find((item) => item.id === this.pageId);
    if (!page) { this.close(); return; }
    const query = this.query.trim().toLocaleLowerCase();
    const modules = this.modules.filter((item) => `${item.title} ${item.source} ${item.description}`.toLocaleLowerCase().includes(query));
    if (!modules.length) this.list.createDiv({ cls: "qh-library-empty", text: t("library.noResults") });
    for (const item of modules) {
      const card = this.list.createDiv({ cls: "qh-library-module" });
      card.dataset.module = item.id;
      const head = card.createDiv({ cls: "qh-library-heading" });
      setIcon(head.createSpan(), item.icon);
      head.createSpan({ text: item.title });
      card.createDiv({ cls: "qh-library-source", text: item.source });
      const preview = card.createDiv({ cls: "qh-library-preview" });
      const names = item.section?.items.slice(0, 3).map((entry) => entry.title) ?? [...(item.preview ?? [])];
      if (item.id === "recent") names.push(...this.app.workspace.getLastOpenFiles().slice(0, 3).map((path) => path.split("/").pop() ?? path));
      if (names.length) for (const name of names) preview.createDiv({ cls: "qh-library-preview-line", text: name });
      else {
        for (let i = 0; i < 3; i++) {
          const line = preview.createDiv({ cls: "qh-library-skeleton", attr: { "aria-hidden": "true" } });
          setIcon(line.createSpan(), item.icon);
          line.createSpan({ cls: "qh-library-skeleton-text" });
        }
      }
      card.createDiv({ cls: "qh-library-description", text: item.description });
      const added = item.id !== "new-shortcuts" && moduleOptions(this.plugin.settings, item.id, this.pageId).visible;
      const ready = item.status === "ready";
      const label = ready ? (added ? t("library.added") : t("library.add"))
        : item.status === "absent" ? t("library.install") : item.status === "disabled" ? t("library.enable") : t("legacy.retry");
      if (!ready) card.createDiv({ cls: "qh-library-status", text: t(item.status === "absent" ? "library.needsPlugin" : item.status === "disabled" ? "library.disabled" : "legacy.unavailable") });
      const button = card.createEl("button", { text: label });
      button.disabled = ready && added;
      button.addEventListener("click", () => {
        if (item.id === "new-shortcuts") { this.close(); new ShortcutEditorModal(this.plugin, this.pageId).open(); return; }
        if (!ready) {
          if (item.status === "absent" && item.sourceId) openPluginPage(item.sourceId);
          else if (item.status === "disabled") {
            openCommunityPluginSettings(this.app);
          } else void this.load();
          return;
        }
        const target = this.plugin.settings.pages.find((entry) => entry.id === this.pageId);
        if (!target) { this.close(); return; }
        button.disabled = true;
        const previous = target.moduleOptions[item.id];
        const hadOrderEntry = target.moduleOrder.includes(item.id);
        // Materialize current order before appending, so adding does not move existing cards.
        if (!target.moduleOrder.length) target.moduleOrder = this.modules.filter((entry) => moduleOptions(this.plugin.settings, entry.id, target.id).visible).map((entry) => entry.id);
        if (!target.moduleOrder.includes(item.id)) target.moduleOrder.push(item.id);
        setModule(this.plugin.settings, target.id, item.id, { visible: true });
        const addedOption = target.moduleOptions[item.id];
        void this.plugin.saveSettings().then(() => { if (this.list.isConnected) this.renderList(); })
          .catch(() => {
            if (target.moduleOptions[item.id] === addedOption) {
              if (previous) target.moduleOptions[item.id] = previous;
              else delete target.moduleOptions[item.id];
              if (!hadOrderEntry) target.moduleOrder = target.moduleOrder.filter((id) => id !== item.id);
            }
            new Notice(t("layout.saveFailed"));
            if (this.list.isConnected) this.renderList();
          });
      });
    }
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
    new Setting(this.contentEl).setName(t("layout.count"))
      .addDropdown((dropdown) => dropdown.addOptions(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])))
        .setValue(String(moduleOptions(this.plugin.settings, this.moduleId, this.pageId).limit))
        .onChange(async (value) => {
          if (!setModule(this.plugin.settings, this.pageId, this.moduleId, { limit: Number(value) })) { this.close(); return; }
          try { await this.plugin.saveSettings(); }
          catch { new Notice(t("layout.saveFailed")); }
        }));
  }
  onClose(): void { this.contentEl.empty(); }
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
