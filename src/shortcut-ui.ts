import { openTodayNote } from "./today";
import { DragFeedback, dropAfter } from "./drag-feedback";
import { FuzzySuggestModal, Menu, Modal, Notice, Setting, TFile, TFolder, setIcon, type TAbstractFile } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { isChinese, t } from "./i18n";
import { NewPageModal } from "./page-dialogs";
import { defaultShortcutIcon, moveShortcutGroup, reorderShortcut, SHORTCUT_ICONS, shortcutModuleId, webTarget, type Shortcut, type ShortcutGroup, type ShortcutKind } from "./shortcuts";

const L = (zh: string, en: string): string => isChinese() ? zh : en;
const groupName = (group: ShortcutGroup): string => group.name || L("常用入口", "Shortcuts");
function label(button: HTMLElement, text: string): void { button.createSpan({ cls: "qh-sr-only", text }); }
function findGroup(plugin: QiaomuHomePlugin, pageId: string, groupId: string): ShortcutGroup | undefined {
  return plugin.settings.pages.find((page) => page.id === pageId)?.shortcutGroups.find((group) => group.id === groupId);
}
function save(plugin: QiaomuHomePlugin): void { void plugin.saveSettings().catch(() => new Notice(t("layout.saveFailed"))); }

class TargetPicker extends FuzzySuggestModal<TAbstractFile> {
  constructor(private plugin: QiaomuHomePlugin, private kind: ShortcutKind, private choose: (file: TAbstractFile) => void) {
    super(plugin.app); this.modalEl.addClass("qh-ui"); this.setPlaceholder(L("搜索文件或文件夹", "Find a file or folder"));
  }
  getItems(): TAbstractFile[] { return this.plugin.app.vault.getAllLoadedFiles().filter((file) => this.kind === "folder" ? file instanceof TFolder : file instanceof TFile); }
  getItemText(file: TAbstractFile): string { return file.path || "/"; }
  onChooseItem(file: TAbstractFile): void { this.choose(file); }
}

export class ShortcutEditorModal extends Modal {
  constructor(private plugin: QiaomuHomePlugin, private pageId: string, private groupId?: string, private itemId?: string) {
    super(plugin.app); this.modalEl.addClass("qh-ui"); plugin.register(() => this.close());
  }
  onOpen(): void {
    this.modalEl.addClass("qh-shortcut-modal");
    this.setTitle(this.itemId ? L("编辑快捷入口", "Edit shortcut") : L("添加快捷入口", "Add shortcut"));
    const group = this.groupId ? findGroup(this.plugin, this.pageId, this.groupId) : undefined;
    const original = group?.items.find((item) => item.id === this.itemId);
    if ((this.groupId && !group) || (this.itemId && !original)) { this.close(); return; }
    let kind: ShortcutKind = original?.kind ?? "file", target = original?.target ?? "", name = original?.name ?? "", icon = original?.icon ?? defaultShortcutIcon(kind);
    let chosen = Boolean(original);
    const drafts = new Map<ShortcutKind, { target: string; name: string; icon: string }>();
    const types = this.contentEl.createDiv({ cls: "qh-shortcut-types", attr: { role: "group" } });
    const typeButtons: HTMLButtonElement[] = [];
    const targetSlot = this.contentEl.createDiv({ cls: "qh-shortcut-target" });
    const details = this.contentEl.createDiv({ cls: "qh-shortcut-details" });
    const detailsToggle = details.createEl("button", { cls: "qh-shortcut-customize", text: L("自定义名称和图标", "Customize name and icon"), attr: { "aria-expanded": String(Boolean(original)) } });
    const options = details.createDiv();
    options.hidden = !original;
    detailsToggle.addEventListener("click", () => { options.hidden = !options.hidden; detailsToggle.setAttr("aria-expanded", String(!options.hidden)); });
    let nameInput: HTMLInputElement;
    new Setting(options).setName(L("显示名称", "Display name")).addText((input) => {
      nameInput = input.inputEl;
      input.setValue(name).setPlaceholder(L("留空使用文件名或域名", "Use file name or domain")).onChange((value) => { name = value; });
    });
    options.createDiv({ text: L("图标", "Icon"), cls: "qh-shortcut-icon-label" });
    const icons = options.createDiv({ cls: "qh-shortcut-icons" });
    const iconNames = ["文件", "文件夹", "网页", "链接", "阅读", "星标", "喜欢", "工作", "写作", "代码", "学习", "主页", "日历", "音乐", "视频", "灵感"];
    const renderIcons = () => {
      icons.empty();
      SHORTCUT_ICONS.forEach((value, index) => {
        const button = icons.createEl("button", { cls: "qh-icon-choice", attr: { "aria-pressed": String(icon === value) } });
        setIcon(button, value); label(button, isChinese() ? iconNames[index] : value);
        button.addEventListener("click", () => {
          icon = value;
          icons.querySelectorAll("button").forEach((entry, at) => entry.setAttr("aria-pressed", String(SHORTCUT_ICONS[at] === icon)));
        });
      });
    };
    const renderTarget = () => {
      targetSlot.empty(); targetSlot.hidden = !chosen;
      details.hidden = !chosen;
      if (!chosen) return;
      const setting = new Setting(targetSlot).setName(kind === "url" ? L("网址", "Website") : L("目标", "Target"));
      if (kind === "daily") { target = "today"; setting.setName(L("今日日记", "Daily note")).setDesc(L("始终打开当天日记，不存在时自动创建。", "Opens today’s note and creates it if missing.")); }
      else if (kind === "url") setting.addText((input) => input.setValue(target).setPlaceholder("https://example.com").onChange((value) => { target = value; }));
      else setting.addButton((button) => button.setButtonText(target || (kind === "folder" ? L("选择文件夹", "Choose folder") : L("选择笔记 / 文件", "Choose note / file"))).onClick(() => {
        const selectedKind = kind;
        new TargetPicker(this.plugin, kind, (file) => {
          if (kind !== selectedKind || !this.contentEl.isConnected) return;
          target = file.path; button.setButtonText(target);
        }).open();
      }));
    };
    const typeChoices: [ShortcutKind, string, string][] = [["file", "file-text", L("笔记 / 文件", "Note / file")], ["folder", "folder", L("文件夹", "Folder")], ["url", "globe", L("网址", "Website")], ["daily", "calendar", L("今日日记", "Daily note")]];
    for (const [value, symbol, text] of typeChoices) {
      const button = types.createEl("button", { cls: "qh-shortcut-type", attr: { "aria-pressed": String(chosen && kind === value) } });
      setIcon(button.createSpan(), symbol); button.createSpan({ text }); typeButtons.push(button);
      button.addEventListener("click", () => {
        if (chosen) drafts.set(kind, { target, name, icon });
        chosen = true; kind = value;
        const draft = drafts.get(kind);
        target = draft?.target ?? ""; name = draft?.name ?? ""; icon = draft?.icon ?? defaultShortcutIcon(kind);
        nameInput.value = name;
        typeButtons.forEach((entry, index) => entry.setAttr("aria-pressed", String(typeChoices[index][0] === kind)));
        renderTarget(); renderIcons();
        footer.settingEl.hidden = false;
        error.empty();
      });
    }
    renderTarget(); renderIcons();
    const error = this.contentEl.createDiv({ cls: "qh-shortcut-error", attr: { role: "alert" } });
    const footer = new Setting(this.contentEl).addButton((button) => button.setButtonText(this.itemId ? L("保存", "Save") : t("library.add")).setCta().onClick(async () => {
      const page = this.plugin.settings.pages.find((entry) => entry.id === this.pageId);
      let current = this.groupId ? findGroup(this.plugin, this.pageId, this.groupId) : undefined;
      if (!page || (this.groupId && !current) || (this.itemId && !current?.items.some((item) => item.id === this.itemId))) { this.close(); return; }
      const url = kind === "url" ? webTarget(target) : null;
      const file = kind !== "url" ? this.app.vault.getAbstractFileByPath(target) : null;
      if (!chosen || !target || (kind === "daily" ? false : kind === "url" ? !url : kind === "folder" ? !(file instanceof TFolder) : !(file instanceof TFile))) {
        error.setText(kind === "url" ? L("请输入完整的 http 或 https 网址。", "Enter a full http or https URL.") : L("目标不存在，请重新选择。", "Target missing. Choose it again.")); return;
      }
      const before = structuredClone(page);
      if (!current) {
        current = { id: crypto.randomUUID(), name: L("常用入口", "Shortcuts"), items: [] };
        page.shortcutGroups.push(current);
        if (page.moduleOrder.length) page.moduleOrder.push(shortcutModuleId(current.id));
      }
      const item: Shortcut = { id: this.itemId ?? crypto.randomUUID(), kind, target: url ?? target, name: name.trim().slice(0, 120), icon };
      const index = current.items.findIndex((entry) => entry.id === item.id);
      if (index === -1) current.items.push(item); else current.items[index] = item;
      page.moduleOptions[shortcutModuleId(current.id)] = { visible: true, limit: 3 };
      button.setDisabled(true);
      try { await this.plugin.saveSettings(); this.close(); }
      catch {
        // Revert this item only, preserving unrelated edits made while saving.
        const at = current.items.indexOf(item);
        if (at >= 0) {
          const oldGroup = before.shortcutGroups.find((entry) => entry.id === current.id);
          const oldItem = oldGroup?.items.find((entry) => entry.id === item.id);
          if (oldItem) current.items[at] = oldItem;
          else current.items.splice(at, 1);
          if (!oldGroup && !current.items.length) {
            page.shortcutGroups = page.shortcutGroups.filter((entry) => entry !== current);
            const key = shortcutModuleId(current.id);
            page.moduleOrder = page.moduleOrder.filter((entry) => entry !== key);
            delete page.moduleOptions[key];
          }
        }
        error.setText(t("layout.saveFailed")); button.setDisabled(false);
      }
    }));
    footer.settingEl.hidden = !chosen;
  }
  onClose(): void { this.contentEl.empty(); }
}

export function shortcutName(item: Shortcut): string {
  return item.name || (item.kind === "daily" ? L("今日日记", "Daily note") : item.kind === "url" ? new URL(item.target).hostname : item.target.split("/").pop()?.replace(/\.md$/, "") || "/");
}
async function openShortcut(plugin: QiaomuHomePlugin, item: Shortcut, newTab: boolean): Promise<void> {
  if (item.kind === "daily") { await openTodayNote(plugin.app, plugin.app.workspace.getLeaf(newTab ? "tab" : false)); return; }
  if (item.kind === "url") { const url = webTarget(item.target); if (url) window.open(url, "_blank", "noopener,noreferrer"); return; }
  const file = plugin.app.vault.getAbstractFileByPath(item.target);
  if (item.kind === "file" && file instanceof TFile) { await plugin.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file); return; }
  if (item.kind === "folder" && file instanceof TFolder) {
    let leaf = plugin.app.workspace.getLeavesOfType("file-explorer")[0];
    if (!leaf) {
      const left = plugin.app.workspace.getLeftLeaf(false);
      if (!left) throw new Error("No file explorer leaf");
      await left.setViewState({ type: "file-explorer", active: true }); leaf = left;
    }
    await plugin.app.workspace.revealLeaf(leaf);
    const view = leaf.view as unknown as {
      revealInFolder?: (file: TAbstractFile) => Promise<void> | void;
      fileItems?: Record<string, { setCollapsed?(collapsed: boolean): Promise<void> | void }>;
    };
    if (!view.revealInFolder) throw new Error("File explorer unavailable");
    await view.revealInFolder(file);
    await view.fileItems?.[file.path]?.setCollapsed?.(false);
    return;
  }
  new Notice(L("目标已移除，可在快捷入口菜单中重新选择。", "Target missing. Edit the shortcut to choose another."));
}

export class MoveShortcutModal extends Modal {
  constructor(private plugin: QiaomuHomePlugin, private pageId: string, private groupId: string, private itemId?: string) { super(plugin.app); this.modalEl.addClass("qh-ui"); }
  onOpen(): void {
    this.setTitle(this.itemId ? L("移到其他分组", "Move to group") : t("layout.move"));
    let count = 0;
    for (const page of this.plugin.settings.pages) {
      if (!this.itemId) {
        if (page.id === this.pageId) continue;
        count++;
        const exists = page.shortcutGroups.some((group) => group.id === this.groupId);
        new Setting(this.contentEl).setName(page.name || t("pages.default")).addButton((button) => button.setButtonText(t(exists ? "library.added" : "layout.move")).setDisabled(exists).onClick(() => {
          if (moveShortcutGroup(this.plugin.settings, this.pageId, page.id, this.groupId)) save(this.plugin);
          this.close();
        }));
      } else for (const group of page.shortcutGroups) {
        if (page.id === this.pageId && group.id === this.groupId) continue;
        count++;
        new Setting(this.contentEl).setName(`${page.name || t("pages.default")} / ${groupName(group)}`).addButton((button) => button.setButtonText(t("layout.move")).onClick(() => {
          const source = findGroup(this.plugin, this.pageId, this.groupId), destination = findGroup(this.plugin, page.id, group.id);
          const item = source?.items.find((entry) => entry.id === this.itemId);
          if (source && destination && item) {
            source.items = source.items.filter((entry) => entry.id !== item.id);
            destination.items.push({ ...item, id: crypto.randomUUID() });
            page.moduleOptions[shortcutModuleId(destination.id)] = { visible: true, limit: 3 };
            save(this.plugin);
          }
          this.close();
        }));
      }
    }
    if (!count) this.contentEl.createEl("p", { text: L("请先创建另一个页签或快捷方式分组。", "Create another page or shortcut group first.") });
  }
  onClose(): void { this.contentEl.empty(); }
}

export function editShortcutGroup(plugin: QiaomuHomePlugin, pageId: string, id: string): void {
  const group = findGroup(plugin, pageId, id);
  if (!group) return;
  new NewPageModal(plugin.app, async (name) => {
    const current = findGroup(plugin, pageId, id);
    if (current) { current.name = name; await plugin.saveSettings(); }
  }, groupName(group), L("重命名分组", "Rename group")).open();
}

export function renderShortcutGroup(parent: HTMLElement, plugin: QiaomuHomePlugin, pageId: string, group: ShortcutGroup, editing: boolean, feedback: DragFeedback, dragState: (active: boolean) => void): void {
  const card = parent.createDiv({ cls: "qh-card qh-shortcut-card", attr: { "data-module": shortcutModuleId(group.id) } });
  const head = card.createDiv({ cls: "qh-card-head" });
  setIcon(head.createSpan({ cls: "qh-card-icon" }), "link");
  head.createSpan({ cls: "qh-card-title", text: groupName(group) });
  const add = head.createEl("button", { cls: "qh-icon-button" }); setIcon(add, "plus"); label(add, L("添加快捷入口", "Add shortcut"));
  add.addEventListener("click", () => new ShortcutEditorModal(plugin, pageId, group.id).open());
  const grid = card.createDiv({ cls: "qh-shortcuts" });
  let dragged: string | null = null;
  for (const item of group.items) {
    const cell = grid.createDiv({ cls: "qh-shortcut-cell", attr: { "data-shortcut": item.id } });
    const button = cell.createEl("button", { cls: "qh-shortcut-link" });
    setIcon(button.createSpan({ cls: "qh-shortcut-icon" }), item.icon);
    button.createSpan({ cls: "qh-shortcut-name", text: shortcutName(item) });
    if (item.kind !== "url" && item.kind !== "daily" && !plugin.app.vault.getAbstractFileByPath(item.target)) {
      cell.addClass("is-missing"); button.createSpan({ cls: "qh-shortcut-status", text: L("目标已移除", "Target missing") });
    }
    const open = (newTab: boolean) => { void openShortcut(plugin, item, newTab).catch(() => new Notice(L("无法打开目标，请检查文件列表是否启用或重新选择目标。", "Unable to open. Enable the file explorer or choose the target again."))); };
    button.addEventListener("click", (event) => open(event.metaKey || event.ctrlKey));
    button.addEventListener("auxclick", (event) => { if (event.button === 1) open(true); });
    const menu = (event: MouseEvent, anchor: HTMLElement) => {
      event.preventDefault(); event.stopPropagation();
      const menu = new Menu();
      if (item.kind === "file") menu.addItem((entry) => entry.setTitle(L("在新标签页打开", "Open in new tab")).setIcon("external-link").onClick(() => open(true)));
      menu.addItem((entry) => entry.setTitle(L("编辑", "Edit")).setIcon("pencil").onClick(() => new ShortcutEditorModal(plugin, pageId, group.id, item.id).open()));
      menu.addItem((entry) => entry.setTitle(L("移到其他分组", "Move to group")).setIcon("panels-top-left").onClick(() => new MoveShortcutModal(plugin, pageId, group.id, item.id).open()));
      const index = group.items.indexOf(item);
      for (const delta of [-1, 1]) menu.addItem((entry) => entry.setTitle(t(delta < 0 ? "layout.earlier" : "layout.later")).setIcon(delta < 0 ? "arrow-left" : "arrow-right").setDisabled(index + delta < 0 || index + delta >= group.items.length).onClick(() => {
        const current = findGroup(plugin, pageId, group.id);
        const at = current?.items.findIndex((entry) => entry.id === item.id) ?? -1;
        if (current && at >= 0 && current.items[at + delta] && reorderShortcut(current, item.id, current.items[at + delta].id, delta > 0)) save(plugin);
      }));
      menu.addItem((entry) => entry.setTitle(L("移除入口", "Remove shortcut")).setIcon("minus-circle").onClick(() => {
        const current = findGroup(plugin, pageId, group.id);
        if (current) { current.items = current.items.filter((entry) => entry.id !== item.id); save(plugin); }
      }));
      const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
    };
    button.addEventListener("contextmenu", (event) => menu(event, button));
    if (editing) {
      const more = cell.createEl("button", { cls: "qh-icon-button qh-shortcut-more" }); setIcon(more, "ellipsis"); label(more, L("入口选项", "Shortcut options"));
      more.addEventListener("click", (event) => menu(event, more));
      const handle = cell.createEl("button", { cls: "qh-icon-button qh-shortcut-grip" });
      setIcon(handle, "grip-vertical"); label(handle, t("layout.drag"));
      handle.addEventListener("click", (event) => menu(event, handle));
      handle.draggable = true;
      handle.addEventListener("dragstart", (event) => { event.stopPropagation(); dragged = item.id; event.dataTransfer?.setData("application/x-qiaomu-shortcut", item.id); dragState(true); feedback.start(cell, event, shortcutName(item)); });
      cell.addEventListener("dragover", (event) => { if (dragged && dragged !== item.id) { event.preventDefault(); event.stopPropagation(); feedback.over(cell, event, "x"); } });
      cell.addEventListener("dragleave", (event) => feedback.leave(cell, event));
      cell.addEventListener("drop", (event) => {
        if (!dragged) return;
        event.preventDefault(); event.stopPropagation();
        const current = findGroup(plugin, pageId, group.id), rect = cell.getBoundingClientRect();
        const changed = current && reorderShortcut(current, dragged, item.id, dropAfter("x", rect, event));
        const movedId = dragged;
        dragged = null; dragState(false); feedback.clear();
        if (changed && current) {
          for (const entry of current.items) {
            const element = [...grid.children].find((child) => (child as HTMLElement).dataset.shortcut === entry.id);
            if (element) grid.appendChild(element);
          }
          if (movedId) plugin.eachView((view) => view.markMovedShortcut(movedId));
          save(plugin);
        }
      });
      handle.addEventListener("dragend", () => { dragged = null; dragState(false); feedback.clear(); });
    }
  }
  if (!group.items.length) grid.createEl("p", { cls: "qh-card-empty", text: L("点击＋添加笔记、文件夹或网址。", "Add notes, folders or websites with +.") });
}
