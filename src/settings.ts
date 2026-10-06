import { DISCOVERY_MODULES, parseSearchTemplates, type SearchTemplate } from "./discovery";
import { EXTRA_MODULES } from "./extra-catalog";
import { INTEGRATIONS } from "./integration-catalog";
import { calendarUrl, clockMinutes, validZone, type WeatherLocation, type ZoneEntry } from "./extra-data";
import { WEATHER_COUNTRIES } from "./weather-location";
import { PRODUCTIVITY_MODULES } from "./productivity-catalog";
import { normalizeFocus, type FocusSession } from "./productivity-data";
import { L, isChinese, isLanguage, type LanguagePreference } from "./i18n";
import { defaultHomeShortcuts, FAVICON, normalizeShortcutGroups, type ShortcutGroup } from "./shortcuts";
export type WallpaperSource = "curated" | "unsplash" | "local" | "none";
export type WallpaperRotation = "daily" | "open" | "fixed";
export type Headline = "clock" | "custom";
export interface FocusItem { text: string; done: boolean }

/** A photo Home is showing or has cached. `url` is the image; `page` credits the photographer. */
export interface Photo {
  id: string;
  url: string;
  author: string;
  authorUrl: string;
  page: string;
  color?: string;
  /** Unsplash API only: must be pinged once when the photo is shown, per the API guidelines. */
  downloadLocation?: string;
}

export interface CustomCommand {
  id: string;
  label: string;
  icon: string;
}

export interface ModuleOptions {
  visible: boolean; limit: number; folder?: string; path?: string; query?: string; sites?: string[]; paths?: string[]; customSites?: SearchTemplate[];
  /** Moment format, e.g. the weekly note name. */
  format?: string;
  /** Remote .ics calendar; fetched only after the user saves it. */
  url?: string;
  zones?: ZoneEntry[];
  /** Work hours as HH:mm. */
  start?: string; end?: string;
  location?: WeatherLocation;
  unit?: "c" | "f";
  countryCode?: string;
  /** Recently modified: leave out daily notes and the notes Home writes to. Unset means true. */
  excludeDaily?: boolean;
  /** Due today: also list overdue tasks. Unset follows whether an Overdue card is on the page. */
  includeOverdue?: boolean;
  /** Multi-search: Enter opens every highlighted site (true) or only the first (false). Unset means true. */
  openAll?: boolean;
  /** Dataview card: what the query shows. Unset means notes. */
  view?: "notes" | "table" | "tasks";
  /** Dataview card: what the query ranges over. Unset means the whole vault. */
  sourceKind?: "all" | "tag" | "folder";
  /** Dataview card: tag name (no #) or folder path. */
  sourceValue?: string;
  /** Dataview card: comma-separated frontmatter fields for the table view. */
  fields?: string;
  /** Dataview card: hide completed tasks. Unset means true. */
  onlyOpen?: boolean;
  /** Dataview card: result order. Unset means recent edits first. */
  sortBy?: "mtime" | "ctime" | "name";
}
export const DEFAULT_MODULE_OPTIONS: ModuleOptions = { visible: true, limit: 3 };

export interface HomePage {
  id: string;
  name: string;
  moduleOptions: Record<string, ModuleOptions>;
  moduleOrder: string[];
  shortcutGroups: ShortcutGroup[];
  /** Existing layouts show newly discovered modules; a new blank page opts in. */
  defaultVisible: boolean;
  showRecommendations: boolean;
}

export interface HomeSettings {
  /** Interface language; "auto" follows Obsidian. */
  language: LanguagePreference;
  openOnStartup: boolean;
  replaceNewTab: boolean;
  headline: Headline;
  customHeadline: string;
  wallpaper: {
    source: WallpaperSource;
    rotation: WallpaperRotation;
    /** 0–0.8: how much the photo is darkened behind text. */
    dim: number;
    /** SecretStorage id holding the Unsplash Access Key; never the key itself. */
    unsplashSecret: string;
    query: string;
    localPath: string;
    localMode: "folder" | "file";
    localFolder: string;
    localRecursive: boolean;
    localCurrent: string;
    localSeen: string[];
    localChosenOn: string;
    localSelectionKey: string;
    current: Photo | null;
    /** Local day (YYYY-MM-DD) the current photo was chosen, for daily rotation. */
    chosenOn: string;
  };
  /** Ordered ids of create actions: built-ins ("builtin:note"), provider actions ("<pluginId>:<actionId>") and commands ("command:<id>"). */
  actions: string[];
  hiddenActions: string[];
  commands: CustomCommand[];
  tabsEnabled: boolean;
  activePageId: string;
  homePageId: string;
  homeShortcutsSeeded: boolean;
  /** 0.5.0 turned website shortcuts that still had the generic globe into site icons, once. */
  shortcutFavicons: boolean;
  pages: HomePage[];
  /** Show the "today" button next to search (when the daily notes command exists). */
  captureTarget: "daily" | "inbox";
  captureInboxPath: string;
  todoPath: string;
  /** Where Home puts notes it creates (video notes, weekly reviews, templates) unless a card chooses its own folder. */
  createFolder: string;
  /** SecretStorage id holding a GitHub token; never the token itself. */
  githubSecret: string;
  todoDaily: boolean;
  todoAutoCarry: boolean;
  /** Empty string reviews the whole vault except common template folders. */
  reviewFolder: string;
  focusSession: FocusSession;
  /** Append a line to today's daily note when a focus session completes. */
  focusLog: boolean;
  /** Finished sessions today, for the focus card. */
  focusStats: { day: string; count: number; minutes: number };
  /** Used only when Daily notes is off; otherwise focus lives in the daily note's `focus` / `focus_done` properties. */
  dailyFocus: { day: string; items: FocusItem[] };
  /** Open notes from cards in a new tab instead of Home's own tab. ⌘/Ctrl-click always opens a new tab. */
  openInNewTab: boolean;
  /** How many past days of daily notes the Todo card looks at for unfinished tasks. */
  todoCarryDays: number;
  /** Line format for Quick capture and ⇧↵ in search. */
  captureFormat: "plain" | "time" | "task";
  /** Recently opened: pinned paths first, hidden paths left out until opened again. */
  recentPinned: string[];
  recentHidden: string[];
  /** Review a note: day each note was last reviewed, notes never to show again, and whether daily notes are skipped. */
  reviewSeen: Record<string, string>;
  reviewExcluded: string[];
  reviewExcludeDaily: boolean;
  /** Play a short chime when a focus or break session ends. */
  focusSound: boolean;
  ambient: { kind: "white" | "pink" | "brown"; volume: number };
  countdown: { label: string; date: string };
  hiddenRecommendations: string[];
}

export const BUILTIN_ACTIONS = ["builtin:daily", "builtin:canvas", "builtin:base", "builtin:folder", "builtin:import"] as const;

export type PageTemplate = "home" | "focus" | "knowledge" | "reading" | "entertainment" | "explore";
/** Ready-made pages. Every card here works without setup or explains its one missing step (a plugin, a note). */
export const PAGE_TEMPLATES: Record<PageTemplate, { zh: string; en: string; icon: string; descZh: string; descEn: string; modules: string[] }> = {
  home: { zh: "主页", en: "Home", icon: "house", descZh: "今日重点、待办、快速记录和常用入口", descEn: "Focus, tasks, capture and shortcuts",
    modules: ["daily-focus", "todo", "quick-capture", "recent"] },
  focus: { zh: "专注", en: "Focus", icon: "timer", descZh: "专注计时、白噪音、到期与逾期任务", descEn: "Timer, ambient sound, due and overdue tasks",
    modules: ["focus-timer", "ambient-sound", "due-today", "overdue", "day-progress", "countdown"] },
  knowledge: { zh: "知识", en: "Knowledge", icon: "library", descZh: "最近修改、回顾旧笔记、周回顾和整理", descEn: "Recent edits, review, weekly review and upkeep",
    modules: ["recently-modified", "review-note", "weekly-review", "activity-heatmap", "tag-cloud", "orphan-notes"] },
  reading: { zh: "阅读", en: "Reading", icon: "book-open", descZh: "继续阅读、未读文章、找书找论文、查词翻译", descEn: "Reading, unread articles, books, papers, words",
    modules: ["qiaomu-reader", "qiaomu-ai-rss", "book-finder", "paper-finder", "word-finder", "translate"] },
  entertainment: { zh: "娱乐", en: "Entertainment", icon: "clapperboard", descZh: "电台、找视频电影、音乐和常用网站", descEn: "Radio, video, music and favorite sites",
    modules: ["qiaomu-radio", "watch-finder", "music-finder"] },
  explore: { zh: "探索", en: "Explore", icon: "compass", descZh: "新手必装插件、QuickAdd 动作、多站搜索、学 AI", descEn: "Starter plugins, QuickAdd, search and AI courses",
    modules: ["beginner-plugins", "quickadd-actions", "multi-search", "ai-learning", "world-clock"] },
};

export function presetPage(kind: PageTemplate): HomePage {
  const template = PAGE_TEMPLATES[kind];
  const modules = template.modules;
  const page: HomePage = { id: kind, name: L(template.zh, template.en), moduleOptions: Object.fromEntries(modules.map(id => [id, {visible:true, limit:3}])), moduleOrder:[...modules], shortcutGroups:[], defaultVisible:false, showRecommendations:false };
  if (kind === "home") {
    const group = defaultHomeShortcuts(isChinese());
    page.shortcutGroups.push(group);
    page.moduleOptions[`shortcut:${group.id}`] = {visible:true,limit:3};
    page.moduleOrder.push(`shortcut:${group.id}`);
  }
  if(kind === "entertainment") {
    const id="entertainment-links";
    page.shortcutGroups.push({id,name:L("常用网站", "Favorite websites"),items:[]});
    page.moduleOptions[`shortcut:${id}`]={visible:true,limit:3};page.moduleOrder.push(`shortcut:${id}`);
  }
  return page;
}

export const DEFAULT_SETTINGS: HomeSettings = {
  language: "auto",
  openOnStartup: true,
  replaceNewTab: true,
  headline: "clock",
  customHeadline: "",
  wallpaper: {
    source: "curated",
    rotation: "daily",
    dim: 0.35,
    unsplashSecret: "",
    query: "nature landscape",
    localPath: "",
    localMode: "folder",
    localFolder: "",
    localRecursive: false,
    localCurrent: "",
    localSeen: [],
    localChosenOn: "",
    localSelectionKey: "",
    current: null,
    chosenOn: "",
  },
  actions: [...BUILTIN_ACTIONS],
  hiddenActions: [],
  commands: [],
  tabsEnabled: true,
  activePageId: "home",
  homePageId: "home",
  homeShortcutsSeeded: true,
  shortcutFavicons: true,
  pages: (["home", "focus", "knowledge", "reading", "entertainment", "explore"] as const).map(presetPage),
  captureTarget: "inbox",
  captureInboxPath: "Inbox.md",
  todoPath: "Home Todo.md",
  createFolder: "",
  githubSecret: "",
  todoDaily: true,
  todoAutoCarry: false,
  reviewFolder: "",
  focusSession: normalizeFocus(null),
  focusLog: false,
  focusStats: { day: "", count: 0, minutes: 0 },
  dailyFocus: { day: "", items: [] },
  ambient: { kind: "brown", volume: 0.4 },
  countdown: { label: "", date: "" },
  hiddenRecommendations: [],
  openInNewTab: false,
  todoCarryDays: 7,
  captureFormat: "plain",
  recentPinned: [],
  recentHidden: [],
  reviewSeen: {},
  reviewExcluded: [],
  reviewExcludeDaily: true,
  focusSound: true,
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function photo(value: unknown): Photo | null {
  const raw = value as Partial<Photo> | null | undefined;
  if (!raw || typeof raw.id !== "string" || typeof raw.url !== "string" || !/^https:\/\//.test(raw.url)) return null;
  return {
    id: raw.id, url: raw.url, author: text(raw.author), authorUrl: text(raw.authorUrl), page: text(raw.page),
    ...(typeof raw.color === "string" ? { color: raw.color } : {}),
    ...(typeof raw.downloadLocation === "string" ? { downloadLocation: raw.downloadLocation } : {}),
  };
}

export function currentPage(settings: HomeSettings, pageId?: string): HomePage {
  const id = pageId ?? (settings.tabsEnabled ? settings.activePageId : settings.homePageId);
  return settings.pages.find((page) => page.id === id) ?? settings.pages[0];
}

export function moduleOptions(settings: HomeSettings, id: string, pageId?: string): ModuleOptions {
  const page = currentPage(settings, pageId);
  if (Object.hasOwn(page.moduleOptions, id)) return page.moduleOptions[id];
  const parent = moduleSource(id);
  if (parent && Object.hasOwn(page.moduleOptions, parent)) return page.moduleOptions[parent];
  return { ...DEFAULT_MODULE_OPTIONS, visible: OPT_IN.has(id) ? false : page.defaultVisible };
}

/** Built-in cards never appear on their own, even on pages that show newly discovered plugin sections. */
const OPT_IN = new Set([...Object.keys(PRODUCTIVITY_MODULES), ...Object.keys(EXTRA_MODULES), ...Object.keys(INTEGRATIONS), ...Object.keys(DISCOVERY_MODULES),
  "todo", "beginner-plugins", "daily-preview", "recently-modified", "review-note", "inbox-preview", "daily-focus", "countdown"]);

export function sectionKey(source: string, section: string): string {
  return `section:${encodeURIComponent(source)}:${encodeURIComponent(section)}`;
}

export function moduleSource(key: string): string | undefined {
  if (!key.startsWith("section:")) return undefined;
  try { return decodeURIComponent(key.split(":")[1]); } catch { return undefined; }
}

/** Migrate the single-page layout only when there are no usable saved pages. */
function normalizePages(raw: Record<string, unknown>, modules: Record<string, ModuleOptions>): HomePage[] {
  const pages: HomePage[] = [];
  if (Array.isArray(raw.pages)) for (const entry of raw.pages) {
    if (!entry || typeof entry !== "object") continue;
    const page = entry as Record<string, unknown>;
    if (typeof page.id !== "string" || !page.id || pages.some((saved) => saved.id === page.id)) continue;
    pages.push({ id: page.id, name: text(page.name).trim().slice(0, 80),
      shortcutGroups: normalizeShortcutGroups(page.shortcutGroups),
      moduleOptions: normalizeModules(page.moduleOptions), moduleOrder: [...new Set(strings(page.moduleOrder).filter(id => id !== "bookmarks"))], defaultVisible: page.defaultVisible !== false,
      showRecommendations: page.showRecommendations === true });
  }
  return pages.length ? pages : [{ id: "home", name: "", moduleOptions: modules, moduleOrder: [], shortcutGroups: [], defaultVisible: true,
    showRecommendations: typeof raw.showRecommendations === "boolean" ? raw.showRecommendations : true }];
}

function normalizeModules(value: unknown): Record<string, ModuleOptions> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, ModuleOptions> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!id || id === "bookmarks" || id === "__proto__" || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Partial<ModuleOptions>;
    result[id] = {
      ...(typeof candidate.folder === "string" ? { folder: candidate.folder.trim().replace(/\/$/, "") } : {}),
      ...(typeof candidate.path === "string" ? { path: candidate.path.trim() } : {}),
      ...(typeof candidate.query === "string" ? { query: candidate.query.slice(0, 500) } : {}),
      ...(Array.isArray(candidate.customSites) ? { customSites: candidate.customSites.flatMap(site => {
        try { return site && typeof site.name === "string" && typeof site.url === "string" ? parseSearchTemplates(`${site.name} | ${site.url}`) : []; } catch { return []; }
      }).slice(0, 8) } : {}),
      ...(Array.isArray(candidate.paths) ? { paths: [...new Set(strings(candidate.paths))].slice(0, 20) } : {}),
      ...(Array.isArray(candidate.sites) ? { sites: strings(candidate.sites) } : {}),
      ...(typeof candidate.format === "string" && candidate.format.trim() ? { format: candidate.format.trim().slice(0, 100) } : {}),
      ...(typeof candidate.url === "string" && calendarUrl(candidate.url) ? { url: calendarUrl(candidate.url)! } : {}),
      ...(Array.isArray(candidate.zones) ? { zones: candidate.zones.filter((zone): zone is ZoneEntry => Boolean(zone) && typeof zone.label === "string" && typeof zone.zone === "string" && validZone(zone.zone))
        .map(zone => ({ label: zone.label.slice(0, 40), zone: zone.zone })).slice(0, 8) } : {}),
      ...(clockMinutes(candidate.start) !== null ? { start: candidate.start } : {}),
      ...(clockMinutes(candidate.end) !== null ? { end: candidate.end } : {}),
      ...(candidate.location && typeof candidate.location.name === "string" && Math.abs(Number(candidate.location.latitude)) <= 90 && Math.abs(Number(candidate.location.longitude)) <= 180
        && Number.isFinite(candidate.location.latitude) && Number.isFinite(candidate.location.longitude)
        ? { location: { name: candidate.location.name.slice(0, 80), latitude: candidate.location.latitude, longitude: candidate.location.longitude } } : {}),
      ...(typeof candidate.countryCode === "string" && (candidate.countryCode === "" || WEATHER_COUNTRIES.includes(candidate.countryCode)) ? { countryCode: candidate.countryCode } : {}),
      ...(candidate.unit === "c" || candidate.unit === "f" ? { unit: candidate.unit } : {}),
      ...(typeof candidate.excludeDaily === "boolean" ? { excludeDaily: candidate.excludeDaily } : {}),
      ...(typeof candidate.includeOverdue === "boolean" ? { includeOverdue: candidate.includeOverdue } : {}),
      ...(typeof candidate.openAll === "boolean" ? { openAll: candidate.openAll } : {}),
      ...(candidate.view === "table" || candidate.view === "tasks" ? { view: candidate.view } : {}),
      ...(candidate.sourceKind === "tag" || candidate.sourceKind === "folder" ? { sourceKind: candidate.sourceKind } : {}),
      ...(typeof candidate.sourceValue === "string" ? { sourceValue: candidate.sourceValue.trim().replace(/^#/, "").replace(/^"|"$/g, "").slice(0, 200) } : {}),
      ...(typeof candidate.fields === "string" ? { fields: candidate.fields.slice(0, 200) } : {}),
      ...(typeof candidate.onlyOpen === "boolean" ? { onlyOpen: candidate.onlyOpen } : {}),
      ...(candidate.sortBy === "ctime" || candidate.sortBy === "name" ? { sortBy: candidate.sortBy } : {}),
      visible: typeof candidate.visible === "boolean" ? candidate.visible : true,
      limit: typeof candidate.limit === "number" && Number.isFinite(candidate.limit)
        ? Math.min(6, Math.max(1, Math.floor(candidate.limit))) : 3,
    };
  }
  return result;
}

/** Validates saved data field by field; unknown or broken values fall back to defaults without touching the rest. */
export function normalizeSettings(saved: unknown): HomeSettings {
  const raw = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const wall = (raw.wallpaper && typeof raw.wallpaper === "object" ? raw.wallpaper : {}) as Record<string, unknown>;
  const focus = (raw.dailyFocus && typeof raw.dailyFocus === "object" ? raw.dailyFocus : {}) as Record<string, unknown>;
  const ambient = (raw.ambient && typeof raw.ambient === "object" ? raw.ambient : {}) as Record<string, unknown>;
  const deadline = (raw.countdown && typeof raw.countdown === "object" ? raw.countdown : {}) as Record<string, unknown>;
  const defaults = DEFAULT_SETTINGS;
  const dim = typeof wall.dim === "number" && Number.isFinite(wall.dim) ? Math.min(0.8, Math.max(0, wall.dim)) : defaults.wallpaper.dim;
  const actions = Array.isArray(raw.actions) ? strings(raw.actions) : [...defaults.actions];
  const commands = Array.isArray(raw.commands)
    ? raw.commands.flatMap((item: unknown) => {
      const command = item as Partial<CustomCommand> | null;
      return command && typeof command.id === "string" && command.id
        ? [{ id: command.id, label: text(command.label, command.id), icon: text(command.icon, "terminal-square") }]
        : [];
    })
    : [];
  const modules = normalizeModules(raw.moduleOptions);
  if (!modules.recent && raw.showRecent === false) modules.recent = { visible: false, limit: 3 };
  const fresh = Object.keys(raw).length === 0;
  const pages = fresh ? structuredClone(defaults.pages) : normalizePages(raw, modules);
  const homePageId = pages.some(page => page.id === raw.homePageId) ? raw.homePageId as string : (pages.find(page => page.id === "home")?.id ?? pages[0].id);
  if (!fresh && raw.shortcutFavicons !== true) {
    for (const page of pages) for (const group of page.shortcutGroups) for (const item of group.items) if (item.kind === "url" && item.icon === "globe") item.icon = FAVICON;
  }
  if (!fresh && raw.homeShortcutsSeeded !== true) {
    const home = pages.find(page => page.id === homePageId)!;
    const defaults = defaultHomeShortcuts(isChinese());
    const existing = home.shortcutGroups.find(group => group.id === defaults.id || ["常用入口", "Shortcuts"].includes(group.name));
    if (existing) {
      for (const item of defaults.items) if (!existing.items.some(entry => entry.kind === item.kind && entry.target === item.target)) {
        let id = item.id;
        while (existing.items.some(entry => entry.id === id)) id += "-default";
        existing.items.push({...item,id});
      }
    } else {
      home.shortcutGroups.push(defaults);
      home.moduleOptions[`shortcut:${defaults.id}`] = {visible:true,limit:3};
      if (home.moduleOrder.length) home.moduleOrder.push(`shortcut:${defaults.id}`);
    }
  }
  return {
    language: isLanguage(raw.language) ? raw.language : "auto",
    openOnStartup: typeof raw.openOnStartup === "boolean" ? raw.openOnStartup : defaults.openOnStartup,
    replaceNewTab: typeof raw.replaceNewTab === "boolean" ? raw.replaceNewTab : defaults.replaceNewTab,
    headline: pick(raw.headline, ["clock", "custom"], defaults.headline),
    customHeadline: text(raw.customHeadline).slice(0, 120),
    wallpaper: {
      source: pick(wall.source, ["curated", "unsplash", "local", "none"], defaults.wallpaper.source),
      rotation: pick(wall.rotation, ["daily", "open", "fixed"], defaults.wallpaper.rotation),
      dim,
      unsplashSecret: text(wall.unsplashSecret),
      query: text(wall.query, defaults.wallpaper.query),
      localPath: text(wall.localPath),
      localMode: pick(wall.localMode, ["folder", "file"], text(wall.localPath) ? "file" : "folder"),
      localFolder: text(wall.localFolder),
      localRecursive: wall.localRecursive === true,
      localCurrent: text(wall.localCurrent),
      localSeen: [...new Set(strings(wall.localSeen))],
      localChosenOn: text(wall.localChosenOn),
      localSelectionKey: text(wall.localSelectionKey),
      current: photo(wall.current),
      chosenOn: text(wall.chosenOn),
    },
    actions: [...new Set(actions)],
    hiddenActions: strings(raw.hiddenActions),
    commands,
    tabsEnabled: fresh ? true : raw.tabsEnabled === true,
    homePageId,
    homeShortcutsSeeded: true,
    shortcutFavicons: true,
    activePageId: pages.some((page) => page.id === raw.activePageId) ? raw.activePageId as string : pages[0].id,
    pages,
    captureTarget: pick(raw.captureTarget, ["daily", "inbox"], defaults.captureTarget),
    captureInboxPath: text(raw.captureInboxPath, defaults.captureInboxPath),
    todoPath: text(raw.todoPath, defaults.todoPath),
    githubSecret: text(raw.githubSecret).slice(0, 200),
    createFolder: text(raw.createFolder).trim().replace(/^\/+|\/+$/g, "").slice(0, 300),
    todoDaily: raw.todoDaily !== false,
    todoAutoCarry: raw.todoAutoCarry === true,
    reviewFolder: text(raw.reviewFolder).trim().replace(/\/$/, ""),
    focusSession: normalizeFocus(raw.focusSession),
    focusLog: raw.focusLog === true,
    focusStats: (() => { const stats = (raw.focusStats && typeof raw.focusStats === "object" ? raw.focusStats : {}) as Record<string, unknown>;
      const count = typeof stats.count === "number" && Number.isFinite(stats.count) ? Math.max(0, Math.floor(stats.count)) : 0;
      const minutes = typeof stats.minutes === "number" && Number.isFinite(stats.minutes) ? Math.max(0, Math.floor(stats.minutes)) : 0;
      return { day: /^\d{4}-\d{2}-\d{2}$/.test(text(stats.day)) ? text(stats.day) : "", count, minutes }; })(),
    dailyFocus: { day: /^\d{4}-\d{2}-\d{2}$/.test(text(focus.day)) ? text(focus.day) : "", items: focusItems(focus) },
    openInNewTab: raw.openInNewTab === true,
    todoCarryDays: [1, 3, 7, 14, 30].includes(raw.todoCarryDays as number) ? raw.todoCarryDays as number : defaults.todoCarryDays,
    captureFormat: pick(raw.captureFormat, ["plain", "time", "task"], defaults.captureFormat),
    recentPinned: [...new Set(strings(raw.recentPinned))].slice(0, 20),
    recentHidden: [...new Set(strings(raw.recentHidden))].slice(-200),
    reviewSeen: (() => {
      const seen = raw.reviewSeen && typeof raw.reviewSeen === "object" && !Array.isArray(raw.reviewSeen) ? raw.reviewSeen as Record<string, unknown> : {};
      const entries = Object.entries(seen).filter((entry): entry is [string, string] => entry[0] !== "__proto__" && typeof entry[1] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry[1]));
      return Object.fromEntries(entries.sort((a, b) => b[1].localeCompare(a[1])).slice(0, 500));
    })(),
    reviewExcluded: [...new Set(strings(raw.reviewExcluded))].slice(0, 500),
    reviewExcludeDaily: raw.reviewExcludeDaily !== false,
    focusSound: raw.focusSound !== false,
    ambient: { kind: pick(ambient.kind, ["white", "pink", "brown"], defaults.ambient.kind),
      volume: typeof ambient.volume === "number" && Number.isFinite(ambient.volume) ? Math.min(1, Math.max(0, ambient.volume)) : defaults.ambient.volume },
    countdown: { label: text(deadline.label).slice(0, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(text(deadline.date)) ? text(deadline.date) : "" },
    hiddenRecommendations: strings(raw.hiddenRecommendations),
  };
}

/** Up to three focus items; older saves had a single `text` / `done`. */
export function focusItems(raw: Record<string, unknown>): FocusItem[] {
  if (Array.isArray(raw.items)) return raw.items.flatMap((item: unknown) => {
    const entry = item as Partial<FocusItem> | null;
    return entry && typeof entry.text === "string" && entry.text.trim() ? [{ text: entry.text.trim().slice(0, 240), done: entry.done === true }] : [];
  }).slice(0, 3);
  return typeof raw.text === "string" && raw.text.trim() ? [{ text: raw.text.trim().slice(0, 240), done: raw.done === true }] : [];
}

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
