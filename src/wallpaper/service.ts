import { Notice } from "obsidian";
import { L } from "../i18n";
import { folderImages, nextLocal } from "./local";
import type { Photo } from "../settings";
import { localDay } from "../settings";
import type QiaomuHomePlugin from "../main";
import { WallpaperCache, curatedPhotos, localImage, nextCurated, randomFromUnsplash, reportUnsplashUse, sizedUrl, targetWidth } from "./wallpaper";

export interface ShownWallpaper {
  url: string;
  color?: string;
  /** Present for Unsplash photos, which must be credited. */
  photo?: Photo;
}

/** Owns which wallpaper is current, rotation, and the on-disk cache. Views ask it what to show. */
export class WallpaperService {
  readonly cache: WallpaperCache;
  private choosing: Promise<void> | null = null;
  private lastError = "";
  private localChoosing: Promise<void> | null = null;

  constructor(private plugin: QiaomuHomePlugin) {
    this.cache = new WallpaperCache(plugin.app, `${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/wallpapers`);
  }

  canRotate(): boolean {
    const wall = this.plugin.settings.wallpaper;
    return wall.source === "curated" || wall.source === "unsplash"
      || wall.source === "local" && wall.localMode === "folder" && this.localFiles().length > 1;
  }

  /** The reason the last Unsplash request failed, for the settings page. Empty when it worked. */
  error(): string { return this.lastError; }

  /** Called whenever a Home page opens: rotates the photo when the rotation rule says it is time. */
  async prepareForView(): Promise<void> {
    const wall = this.plugin.settings.wallpaper;
    if (wall.source === "local") { await this.prepareLocal(true); return; }
    if (!this.canRotate()) return;
    const due = !wall.current
      || (wall.source === "curated") !== wall.current.id.startsWith("curated:")
      || wall.rotation === "open"
      || wall.rotation === "daily" && wall.chosenOn !== localDay();
    if (due) await this.choose();
  }

  /** User asked for another photo. */
  async next(): Promise<void> {
    if (this.plugin.settings.wallpaper.source === "local") await this.prepareLocal(false, true);
    else if (this.canRotate()) await this.choose();
  }

  localFiles() {
    const wall = this.plugin.settings.wallpaper;
    return wall.localFolder ? folderImages(this.plugin.app, wall.localFolder, wall.localRecursive) : [];
  }

  /** Vault events/configuration changes repair a missing choice without triggering open rotation. */
  async refreshLocal(): Promise<void> {
    await this.prepareLocal(false);
    if (this.plugin.settings.wallpaper.source === "local") this.plugin.eachView(view => void view.renderPhoto());
  }

  private async prepareLocal(open: boolean, force = false): Promise<void> {
    if (this.localChoosing) {
      await this.localChoosing;
      if (open || force) return;
    }
    this.localChoosing = this.pickLocal(open, force).finally(() => { this.localChoosing = null; });
    await this.localChoosing;
  }

  private async pickLocal(open: boolean, force: boolean): Promise<void> {
    const wall = this.plugin.settings.wallpaper;
    if (wall.source !== "local" || wall.localMode !== "folder") return;
    const paths = this.localFiles().map(file => file.path);
    const key = JSON.stringify([wall.localFolder, wall.localRecursive]);
    const changed = wall.localSelectionKey !== key;
    const due = changed || (paths.length ? !paths.includes(wall.localCurrent) : !!wall.localCurrent) || force && paths.length > 1
      || open && paths.length > 1 && (wall.rotation === "open" || wall.rotation === "daily" && wall.localChosenOn !== localDay());
    const seen = wall.localSeen.filter(path => paths.includes(path));
    if (!due && seen.length === wall.localSeen.length) return;
    const before = { localCurrent: wall.localCurrent, localSeen: wall.localSeen, localChosenOn: wall.localChosenOn, localSelectionKey: wall.localSelectionKey };
    if (due) {
      const next = nextLocal(paths, wall.localCurrent, changed ? [] : seen);
      wall.localCurrent = next.current;
      wall.localSeen = next.seen;
      wall.localChosenOn = next.current ? localDay() : "";
      wall.localSelectionKey = key;
    } else wall.localSeen = seen;
    try {
      await this.plugin.saveSettings({ rerender: false });
      this.plugin.eachView(view => void view.renderPhoto());
    }
    catch {
      Object.assign(wall, before);
      new Notice(L("壁纸设置保存失败，请重试。", "Could not save wallpaper settings. Try again."));
    }
  }

  private choose(): Promise<void> {
    // Several Home tabs opening together (startup, split) share one choice instead of each picking a photo.
    this.choosing ??= this.pick().finally(() => { this.choosing = null; });
    return this.choosing;
  }

  private async pick(): Promise<void> {
    const wall = this.plugin.settings.wallpaper;
    let photo: Photo | null = null;
    if (wall.source === "unsplash") {
      const key = this.accessKey();
      if (key) {
        try {
          photo = await randomFromUnsplash(key, wall.query);
          this.lastError = "";
          void reportUnsplashUse(photo, key);
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
        }
      } else this.lastError = "unsplash-no-key";
    }
    // Without a key, or when Unsplash is unreachable, the built-in gallery keeps Home beautiful.
    photo ??= nextCurated(wall.current?.id);
    wall.current = photo;
    wall.chosenOn = localDay();
    await this.plugin.saveSettings({ rerender: false });
    this.plugin.eachView((view) => void view.renderPhoto());
  }

  accessKey(): string {
    const id = this.plugin.settings.wallpaper.unsplashSecret;
    if (!id) return "";
    try { return this.plugin.app.secretStorage.getSecret(id) ?? ""; }
    catch { return ""; }
  }

  /** What a Home page in this window should display right now. Prefers the local copy; downloads one for next time. */
  async resolve(win: Window): Promise<ShownWallpaper | null> {
    const wall = this.plugin.settings.wallpaper;
    if (wall.source === "none") return null;
    if (wall.source === "local") {
      const path = wall.localMode === "file" ? wall.localPath : wall.localCurrent;
      const url = path ? localImage(this.plugin.app, path) : null;
      return url ? { url } : null;
    }
    const photo = wall.current ?? curatedPhotos()[0];
    const width = targetWidth(win.screen?.width ?? 1920, win.devicePixelRatio || 1);
    const cached = await this.cache.cached(photo, width);
    if (!cached) void this.cache.fetch(photo, width);
    return { url: cached ?? sizedUrl(photo, width), photo, ...(photo.color ? { color: photo.color } : {}) };
  }
}
