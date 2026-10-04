import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import type QiaomuHomePlugin from "../src/main";
import { normalizeSettings, localDay } from "../src/settings";
import { folderImages, nextLocal } from "../src/wallpaper/local";
import { WallpaperService } from "../src/wallpaper/service";

function fixture() {
  const file = (path: string) => Object.assign(new TFile(), { path, name: path.split("/").pop(), extension: path.split(".").pop() });
  const a = file("Walls/a.jpg"), b = file("Walls/b.PNG"), c = file("Walls/sub/c.webp");
  const nested = Object.assign(new TFolder(), { path: "Walls/sub", children: [c] });
  const folder = Object.assign(new TFolder(), { path: "Walls", children: [a, b, file("Walls/note.md"), nested] });
  const entries = new Map([folder, nested, a, b, c].map(item => [item.path, item]));
  const plugin = {
    settings: normalizeSettings({ wallpaper: { source: "local", localFolder: "Walls" } }),
    app: { vault: { configDir: ".obsidian", getAbstractFileByPath: (path: string) => entries.get(path), getResourcePath: (file: TFile) => `app://${file.path}` } },
    manifest: { id: "qiaomu-home" }, saveSettings: vi.fn(async () => {}), eachView: vi.fn(),
  } as unknown as QiaomuHomePlugin;
  const service = new WallpaperService(plugin);
  return { plugin, service, folder, nested, entries, file };
}

describe("local wallpaper", () => {
  it("keeps old single images and defaults new configuration to folders", () => {
    expect(normalizeSettings({ wallpaper: { localPath: "old.jpg" } }).wallpaper.localMode).toBe("file");
    expect(normalizeSettings(null).wallpaper.localMode).toBe("folder");
    expect(normalizeSettings({ wallpaper: { localMode: "folder", localPath: "old.jpg" } }).wallpaper.localMode).toBe("folder");
  });

  it("traverses only the chosen folder, filtering unsupported files and optionally including descendants", () => {
    const { plugin } = fixture();
    expect(folderImages(plugin.app, "Walls", false).map(file => file.path)).toEqual(["Walls/a.jpg", "Walls/b.PNG"]);
    expect(folderImages(plugin.app, "Walls", true)).toHaveLength(3);
    expect(folderImages(plugin.app, "missing", true)).toEqual([]);
    expect(folderImages(plugin.app, "Walls/a.jpg", true)).toEqual([]);
  });

  it("visits each image once per cycle, survives reload and avoids a repeat at the cycle boundary", () => {
    const paths = ["a", "b", "c"];
    let state = { current: "", seen: [] as string[] };
    const picked = [];
    for (let i = 0; i < 3; i++) { state = nextLocal(paths, state.current, JSON.parse(JSON.stringify(state.seen)), () => 0); picked.push(state.current); }
    expect(new Set(picked).size).toBe(3);
    expect(nextLocal(paths, state.current, state.seen, () => 0.99).current).not.toBe(state.current);
    expect(nextLocal([...paths, "d"], state.current, state.seen, () => 0).current).toBe("d");
    expect(nextLocal([], "a", ["a"])).toEqual({ current: "", seen: [] });
  });

  it("keeps today's image on refresh and reload, but rotates when opened on the next day", async () => {
    const { plugin, service } = fixture();
    await service.prepareForView();
    const first = plugin.settings.wallpaper.localCurrent;
    await service.refreshLocal(); await service.prepareForView();
    expect(plugin.settings.wallpaper.localCurrent).toBe(first);
    plugin.settings = normalizeSettings(JSON.parse(JSON.stringify(plugin.settings)));
    const reloaded = new WallpaperService(plugin);
    await reloaded.prepareForView(); expect(plugin.settings.wallpaper.localCurrent).toBe(first);
    plugin.settings.wallpaper.localChosenOn = "2000-01-01";
    await reloaded.prepareForView(); expect(plugin.settings.wallpaper.localCurrent).not.toBe(first);
    expect(plugin.settings.wallpaper.localChosenOn).toBe(localDay());
  });

  it("coalesces simultaneous opens, while refresh never advances open rotation", async () => {
    const { plugin, service } = fixture(); plugin.settings.wallpaper.rotation = "open";
    await Promise.all([service.prepareForView(), service.prepareForView()]);
    expect(plugin.settings.wallpaper.localSeen).toHaveLength(1);
    const first = plugin.settings.wallpaper.localCurrent;
    await service.refreshLocal(); expect(plugin.settings.wallpaper.localCurrent).toBe(first);
    await service.prepareForView(); expect(plugin.settings.wallpaper.localCurrent).not.toBe(first);
  });

  it("repairs deletion, handles an empty folder without repeated writes, and discovers added files", async () => {
    const { plugin, service, folder, file } = fixture();
    await service.prepareForView();
    folder.children = [];
    await service.refreshLocal();
    expect(plugin.settings.wallpaper.localCurrent).toBe(""); expect(service.canRotate()).toBe(false);
    const count = vi.mocked(plugin.saveSettings).mock.calls.length;
    await service.refreshLocal(); expect(plugin.saveSettings).toHaveBeenCalledTimes(count);
    folder.children.push(file("Walls/new.jpg")); await service.refreshLocal();
    expect(plugin.settings.wallpaper.localCurrent).toBe("Walls/new.jpg"); expect(service.canRotate()).toBe(false);
  });

  it("shows the old single image and never rotates it", async () => {
    const { plugin, service } = fixture();
    Object.assign(plugin.settings.wallpaper, { localMode: "file", localPath: "Walls/a.jpg" });
    expect(service.canRotate()).toBe(false); await service.next();
    expect(await service.resolve(window)).toEqual({ url: "app://Walls/a.jpg" });
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("repairs a deleted current image while another selection is being saved", async () => {
    const { plugin, service, folder, entries } = fixture();
    let saved!: () => void;
    vi.mocked(plugin.saveSettings).mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve; }));
    const pending = service.prepareForView();
    const removed = plugin.settings.wallpaper.localCurrent;
    folder.children = folder.children.filter(file => file.path !== removed); entries.delete(removed);
    const repair = service.refreshLocal(); saved();
    await Promise.all([pending, repair]);
    expect(plugin.settings.wallpaper.localCurrent).not.toBe(removed);
  });
});
