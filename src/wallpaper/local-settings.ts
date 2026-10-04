import { AbstractInputSuggest, FuzzySuggestModal, Setting, TFile, TFolder, normalizePath, setIcon, type App } from "obsidian";
import { L } from "../i18n";
import type QiaomuHomePlugin from "../main";
import type { WallpaperRotation } from "../settings";
import { isImagePath, localImage } from "./wallpaper";

function candidates(app: App, folder: boolean): Array<TFile | TFolder> {
  return folder ? app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder)
    : app.vault.getFiles().filter(file => isImagePath(file.path));
}

class PathSuggest extends AbstractInputSuggest<TFile | TFolder> {
  constructor(app: App, private input: HTMLInputElement, private folder: boolean, private pick: (path: string) => void) { super(app, input); }
  protected getSuggestions(query: string) {
    return candidates(this.app, this.folder).filter(file => file.path.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  }
  renderSuggestion(file: TFile | TFolder, el: HTMLElement): void { el.setText(file.path); }
  selectSuggestion(file: TFile | TFolder): void { this.input.value = file.path; this.pick(file.path); this.close(); }
}

class PathPicker extends FuzzySuggestModal<TFile | TFolder> {
  constructor(app: App, private folder: boolean, private pick: (path: string) => void) {
    super(app); this.modalEl.addClass("qh-ui");
    this.setPlaceholder(folder ? L("选择壁纸图片文件夹", "Choose a wallpaper folder") : L("选择壁纸图片", "Choose a wallpaper image"));
  }
  getItems() { return candidates(this.app, this.folder); }
  getItemText(file: TFile | TFolder) { return file.path; }
  onChooseItem(file: TFile | TFolder) { this.pick(file.path); }
}

export function renderLocalWallpaper(container: HTMLElement, plugin: QiaomuHomePlugin, rerender: () => void): () => void {
  const wall = plugin.settings.wallpaper, app = plugin.app;
  const folder = wall.localMode === "folder";
  const persist = async () => { await plugin.saveSettings({ rerender: false }); await plugin.wallpaper.refreshLocal(); refresh(); };
  new Setting(container).setName(L("使用方式", "Use images from"))
    .addDropdown(dropdown => dropdown.addOptions({ folder: L("图片文件夹", "Image folder"), file: L("单张图片", "Single image") })
      .setValue(wall.localMode).onChange(async value => {
        wall.localMode = value as "folder" | "file";
        await persist(); rerender();
      }));
  const pathSetting = new Setting(container).setName(folder ? L("图片文件夹", "Image folder") : L("图片路径", "Image path"));
  const preview = pathSetting.descEl.createDiv({ cls: "qh-wallpaper-preview" });
  const thumb = preview.createEl("img", { cls: "qh-wallpaper-thumb", attr: { alt: L("壁纸预览", "Wallpaper preview") } });
  const status = preview.createSpan({ attr: { role: "status" } });
  let failedPath = "";
  const apply = async (value: string) => {
    const path = value.trim() === "/" ? "/" : value.trim() ? normalizePath(value.trim()) : "";
    if (folder) wall.localFolder = path; else wall.localPath = path;
    failedPath = "";
    try { await persist(); }
    catch { status.setText(L("壁纸设置保存失败，请重试。", "Could not save wallpaper settings. Try again.")); }
  };
  pathSetting.addText(text => {
    text.setPlaceholder(folder ? "Attachments/Wallpapers" : "Attachments/wallpaper.jpg").setValue(folder ? wall.localFolder : wall.localPath);
    const input = text.inputEl;
    const labelId = `qh-wallpaper-path-${crypto.randomUUID()}`;
    pathSetting.nameEl.id = labelId; input.setAttr("aria-labelledby", labelId);
    new PathSuggest(app, input, folder, path => { input.value = path; void apply(path); });
    input.addEventListener("blur", () => {
      const stored = folder ? wall.localFolder : wall.localPath;
      if (input.value.trim() !== stored) void apply(input.value);
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) void apply(input.value);
    });
    const button = pathSetting.controlEl.createEl("button", { cls: "clickable-icon qh-setting-icon", attr: { type: "button" } });
    setIcon(button, folder ? "folder-open" : "image");
    button.createSpan({ cls: "qh-sr-only", text: folder ? L("选择图片文件夹", "Choose an image folder") : L("选择图片", "Choose an image") });
    button.addEventListener("click", () => new PathPicker(app, folder, path => { input.value = path; void apply(path); }).open());
  });
  if (folder) new Setting(container).setName(L("包含子文件夹", "Include subfolders"))
    .addToggle(toggle => toggle.setValue(wall.localRecursive).onChange(async value => { wall.localRecursive = value; await persist(); }));
  const rotation = new Setting(container).setName(L("更换频率", "Change"))
    .addDropdown(dropdown => dropdown.addOptions({ daily: L("每天一张", "Once a day"), open: L("每次打开", "Every time Home opens"), fixed: L("手动更换", "Only when I ask") })
      .setValue(wall.rotation).onChange(async value => { wall.rotation = value as WallpaperRotation; await persist(); }));
  function refresh() {
    if (plugin.settings.wallpaper !== wall) return;
    const files = folder ? plugin.wallpaper.localFiles() : [];
    rotation.settingEl.hidden = !folder || files.length < 2;
    const path = folder ? wall.localFolder : wall.localPath;
    const selected = path ? app.vault.getAbstractFileByPath(path) : null;
    const url = localImage(app, folder ? wall.localCurrent : wall.localPath);
    thumb.hidden = !url || failedPath === path;
    if (url && thumb.getAttribute("src") !== url) thumb.src = url;
    if (!path) status.setText(folder ? L("选择一个包含壁纸图片的文件夹。", "Choose a folder containing wallpaper images.") : L("选择一张库中的图片。", "Choose an image from your vault."));
    else if (folder && !(selected instanceof TFolder)) status.setText(L("文件夹不存在，请重新选择。", "Folder not found. Choose another folder."));
    else if (!folder && !url) status.setText(L("图片不存在或格式不支持，请重新选择。", "Image missing or unsupported. Choose another image."));
    else if (failedPath === path) status.setText(L("图片无法加载，请换一张。", "Image could not load. Choose another image."));
    else if (folder && !files.length) status.setText(L("此文件夹没有可用图片。", "This folder has no supported images."));
    else if (folder && files.length === 1) status.setText(L("已找到 1 张图片，将固定显示。", "Found 1 image. It will stay as your wallpaper."));
    else if (folder) status.setText(L("已找到 {count} 张图片。", "Found {count} images.", { count: files.length }));
    else status.setText(selected?.name ?? "");
  }
  thumb.addEventListener("error", () => { failedPath = folder ? wall.localFolder : wall.localPath; refresh(); });
  refresh();
  return refresh;
}
