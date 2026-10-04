import { HomeTaskIndex } from "./task-index";
import { AmbientPlayer } from "./ambient";
import { moment, Notice, Plugin, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { appendToDaily } from "./today";
import { L, setLanguage, t, type LanguagePreference } from "./i18n";
import { renameShortcutTargets } from "./shortcuts";
import { DEFAULT_SETTINGS, normalizeSettings, type HomeSettings } from "./settings";
import { HomeSettingTab } from "./settings-tab";
import { HOME_VIEW_TYPE, HomeView } from "./view";
import { WallpaperService } from "./wallpaper/service";
import { currentFocusText } from "./daily-focus";

/** Two soft tones, synthesized so no audio file ships with the plugin. */
function playChime(): void {
  try {
    const context = new AudioContext();
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const start = context.currentTime + index * 0.22;
      oscillator.type = "sine"; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start); oscillator.stop(start + 0.65);
    });
    window.setTimeout(() => void context.close(), 1500);
  } catch { /* audio unavailable */ }
}

/** How long to wait after a layout change before claiming an empty tab, so a plugin that is opening its own view wins. */
const CLAIM_DELAY_MS = 40;

export default class QiaomuHomePlugin extends Plugin {
  settings: HomeSettings = structuredClone(DEFAULT_SETTINGS);
  wallpaper!: WallpaperService;
  taskIndex!: HomeTaskIndex;
  readonly ambient = new AmbientPlayer();
  private completingFocus = false;
  private homeSettingTab!: HomeSettingTab;
  private saveQueue: Promise<void> = Promise.resolve();
  private claimTimer: number | null = null;
  private claiming = new WeakSet<WorkspaceLeaf>();

  async onload(): Promise<void> {
    const data: unknown = await this.loadData();
    // The language decides default page and shortcut names, so it is set before settings are normalized.
    setLanguage((data as { language?: LanguagePreference } | null)?.language ?? "auto");
    this.settings = normalizeSettings(data);
    this.wallpaper = new WallpaperService(this);
    this.taskIndex = new HomeTaskIndex(this.app);
    this.register(() => this.taskIndex.clear());
    this.register(() => this.ambient.destroy());
    this.registerInterval(window.setInterval(() => this.completeFocusIfDue(), 1000));
    // A note removed from "Recently opened" comes back once it is opened again.
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!file || !this.settings.recentHidden.includes(file.path)) return;
      this.settings.recentHidden = this.settings.recentHidden.filter((path) => path !== file.path);
      void this.saveSettings({ rerender: false });
    }));
    const refreshWallpaper = (file?: TAbstractFile) => {
      const wall = this.settings.wallpaper;
      if (wall.source !== "local") return;
      const target = wall.localMode === "folder" ? wall.localFolder : wall.localPath;
      if (file && target !== "/" && file.path !== target && !file.path.startsWith(`${target}/`) && !target.startsWith(`${file.path}/`)) return;
      void this.wallpaper.refreshLocal().then(() => this.homeSettingTab?.refreshWallpaper());
    };
    this.registerEvent(this.app.vault.on("create", refreshWallpaper));
    this.registerEvent(this.app.vault.on("delete", refreshWallpaper));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      let todoRenamed = false;
      const renamed = (path: string) => path === oldPath || path.startsWith(`${oldPath}/`) ? file.path + path.slice(oldPath.length) : path;
      for (const page of this.settings.pages) for (const options of Object.values(page.moduleOptions)) {
        for (const key of ["path", "folder"] as const) if (options[key] && renamed(options[key]) !== options[key]) { options[key] = renamed(options[key]); todoRenamed = true; }
        if (options.paths) { const next = options.paths.map(renamed); if (next.some((path, index) => path !== options.paths![index])) { options.paths = next; todoRenamed = true; } }
      }
      for (const key of ["captureInboxPath", "reviewFolder", "createFolder"] as const) if (this.settings[key] && renamed(this.settings[key]) !== this.settings[key]) { this.settings[key] = renamed(this.settings[key]); todoRenamed = true; }
      for (const key of ["recentPinned", "recentHidden", "reviewExcluded"] as const) {
        const next = this.settings[key].map(renamed);
        if (next.some((path, index) => path !== this.settings[key][index])) { this.settings[key] = next; todoRenamed = true; }
      }
      const wall = this.settings.wallpaper;
      let wallpaperRenamed = false;
      for (const key of ["localPath", "localFolder", "localCurrent"] as const) {
        if (wall[key] && renamed(wall[key]) !== wall[key]) { wall[key] = renamed(wall[key]); todoRenamed = true; wallpaperRenamed = true; }
      }
      const localSeen = wall.localSeen.map(renamed);
      if (localSeen.some((path, index) => path !== wall.localSeen[index])) { wall.localSeen = localSeen; todoRenamed = true; }
      if (wallpaperRenamed) wall.localSelectionKey = JSON.stringify([wall.localFolder, wall.localRecursive]);
      refreshWallpaper();
      const seen = Object.entries(this.settings.reviewSeen);
      if (seen.some(([path]) => renamed(path) !== path)) { this.settings.reviewSeen = Object.fromEntries(seen.map(([path, day]) => [renamed(path), day])); todoRenamed = true; }
      if (this.settings.todoPath === oldPath || this.settings.todoPath.startsWith(`${oldPath}/`)) {
        this.settings.todoPath = file.path + this.settings.todoPath.slice(oldPath.length); todoRenamed = true;
      }
      if (renameShortcutTargets(this.settings, oldPath, file.path) || todoRenamed) void this.saveSettings().catch(() => new Notice(t("layout.saveFailed")));
    }));
    this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));

    this.addRibbonIcon("house", t("ribbon.open"), () => void this.openHome());
    this.addCommand({ id: "open", name: t("cmd.open"), callback: () => void this.openHome() });
    this.addCommand({ id: "focus-search", name: t("cmd.focusSearch"), callback: () => void this.openHome().then((view) => view?.focusSearch()) });
    this.addCommand({
      id: "next-wallpaper", name: t("cmd.nextWallpaper"),
      checkCallback: (checking) => {
        if (!this.wallpaper.canRotate()) return false;
        if (!checking) void this.wallpaper.next();
        return true;
      },
    });
    this.homeSettingTab = new HomeSettingTab(this.app, this);
    this.addSettingTab(this.homeSettingTab);

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openOnStartup) void this.openHome({ startup: true });
      this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleClaim()));
      this.scheduleClaim();
    });
  }

  onunload(): void {
    if (this.claimTimer !== null) window.clearTimeout(this.claimTimer);
  }

  /** Runs once per finished session, even with several Home tabs open or after a restart. */
  private completeFocusIfDue(): void {
    const session = this.settings.focusSession;
    if (this.completingFocus || !session.endAt || Date.now() < session.endAt) return;
    this.completingFocus = true;
    const endAt = session.endAt, minutes = session.durationMinutes;
    const recent = Date.now() - endAt < 10 * 60000;
    if (recent && this.settings.focusSound) playChime();
    if (session.kind === "break") {
      // A break is not counted; Home is ready for the next focus session of the chosen length.
      this.settings.focusSession = { ...session, kind: "focus", durationMinutes: session.focusMinutes, endAt: 0, remainingMs: session.focusMinutes * 60000 };
      if (recent) new Notice(L("休息结束，开始下一段专注吧", "Break over. Ready for the next session."));
      void this.saveSettings({ rerender: false }).finally(() => { this.completingFocus = false; });
      return;
    }
    this.settings.focusSession = { ...session, endAt: 0, remainingMs: 0 };
    // Count the session on the day it ended.
    const day = (moment as unknown as (time: number) => { format(pattern: string): string })(endAt).format("YYYY-MM-DD");
    const stats = this.settings.focusStats.day === day ? this.settings.focusStats : { day, count: 0, minutes: 0 };
    this.settings.focusStats = { day, count: stats.count + 1, minutes: stats.minutes + minutes };
    if (recent) new Notice(L("专注 {minutes} 分钟完成，休息一下吧", "{minutes}-minute focus complete. Take a break.", { minutes }));
    void (async () => {
      await this.saveSettings({ rerender: false });
      if (!this.settings.focusLog) return;
      const format = (time: number) => (moment as unknown as (time: number) => { format(pattern: string): string })(time).format("HH:mm");
      const label = session.label || await currentFocusText(this);
      await appendToDaily(this.app, `- ${format(endAt - minutes * 60000)}–${format(endAt)} ${L("专注 {minutes} 分钟", "Focused {minutes} min", { minutes })}${label ? ` · ${label}` : ""}`);
    })().catch((error: unknown) => new Notice(L("专注记录未写入：{v}", "Focus log not written: {v}", { v: error instanceof Error ? error.message : String(error) })))
      .finally(() => { this.completingFocus = false; });
  }

  eachView(callback: (view: HomeView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
      if (leaf.view instanceof HomeView) callback(leaf.view);
    }
  }

  async saveSettings(options: { rerender?: boolean } = {}): Promise<void> {
    const snapshot = structuredClone(this.settings);
    const save = this.saveQueue.catch(() => {}).then(() => this.saveData(snapshot));
    this.saveQueue = save;
    await save;
    setLanguage(this.settings.language);
    if (options.rerender !== false) this.eachView((view) => view.render());
  }

  /** Opens this plugin's page in Obsidian settings. */
  openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open?(): void; openTabById?(id: string): unknown } }).setting;
    setting?.open?.();
    setting?.openTabById?.(this.manifest.id);
  }

  /** Opens Home: focuses the Home tab already in front, reuses an empty tab, or opens a new tab. */
  async openHome(options: { startup?: boolean } = {}): Promise<HomeView | null> {
    const workspace = this.app.workspace;
    const current = workspace.getMostRecentLeaf();
    let leaf: WorkspaceLeaf | null = current?.view.getViewType() === HOME_VIEW_TYPE ? current : null;
    if (!leaf && options.startup) leaf = workspace.getLeavesOfType(HOME_VIEW_TYPE).find((candidate) => candidate.getRoot() === workspace.rootSplit) ?? null;
    if (!leaf && current?.view.getViewType() === "empty") leaf = current;
    if (!leaf) leaf = workspace.getLeaf("tab");
    if (leaf.view.getViewType() !== HOME_VIEW_TYPE) await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
    return leaf.view instanceof HomeView ? leaf.view : null;
  }

  private scheduleClaim(): void {
    if (!this.settings.replaceNewTab || this.claimTimer !== null) return;
    this.claimTimer = window.setTimeout(() => {
      this.claimTimer = null;
      this.claimEmptyTabs();
    }, CLAIM_DELAY_MS);
  }

  /** Turns every empty tab in the main area (and pop-out windows) into Home. Sidebars are left alone. */
  private claimEmptyTabs(): void {
    if (!this.settings.replaceNewTab) return;
    const workspace = this.app.workspace;
    const recent = workspace.getMostRecentLeaf();
    workspace.iterateAllLeaves((leaf) => {
      if (leaf.view.getViewType() !== "empty" || this.claiming.has(leaf)) return;
      const root = leaf.getRoot();
      if (root === workspace.leftSplit || root === workspace.rightSplit) return;
      this.claiming.add(leaf);
      void leaf.setViewState({ type: HOME_VIEW_TYPE, active: leaf === recent })
        .catch((error: unknown) => console.error("Qiaomu Home: could not open in a new tab", error))
        .finally(() => this.claiming.delete(leaf));
    });
  }
}
