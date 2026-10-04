import { setLanguage } from "../src/i18n";
import { describe, expect, it } from "vitest";
import {
  activityDays, agenda, calendarUrl, dailyIndex, heatLevel, parseFlashcards, parseForecast, parseGeocoding, parseIcs, parseQuotes,
  parseSnippets, parseVideoUrl, parseZones, timeProgress, videoNote, weatherLabel, zoneTime,
} from "../src/extra-data";
import { fillNoise } from "../src/ambient";
import { DISCOVERY_MODULES, defaultSites, discoveryUrl, translateTarget } from "../src/discovery";
import { EXTRA_MODULES } from "../src/extra-catalog";
import { MODULE_CATEGORIES, moduleCategory } from "../src/module-categories";
import { builtinModules } from "../src/module-catalog";
import { DEFAULT_SETTINGS, moduleOptions, normalizeSettings } from "../src/settings";

describe("time cards", () => {
  it("reports work, week and year progress from local wall time", () => {
    const progress = timeProgress(new Date(2026, 8, 30, 13, 30), "09:00", "18:00"); // Wednesday
    expect(progress.work).toBeCloseTo(0.5);
    expect(progress.workState).toBe("during");
    expect(progress.workLeft).toBe(270);
    expect(progress.week).toBeCloseTo((2 + 13.5 / 24) / 7, 3);
    expect(timeProgress(new Date(2026, 0, 1, 0, 0)).year).toBe(0);
    expect(timeProgress(new Date(2026, 8, 30, 8), "09:00", "18:00").workState).toBe("before");
    expect(timeProgress(new Date(2026, 8, 30, 8), "18:00", "09:00").work).toBeNull();
  });
  it("validates time zones line by line and reports day offsets", () => {
    expect(parseZones("东京 | Asia/Tokyo\nEurope/Paris")).toEqual([{ label: "东京", zone: "Asia/Tokyo" }, { label: "Paris", zone: "Europe/Paris" }]);
    setLanguage("en");
    expect(() => parseZones("Nowhere | Mars/Base")).toThrow(/Line 1/);
    setLanguage("auto");
    const now = new Date(Date.UTC(2026, 8, 27, 23, 30));
    expect(zoneTime(now, "UTC").time).toBe("23:30");
    expect(zoneTime(now, "Pacific/Kiritimati").time).toBe("13:30");
  });
});

describe("note-backed cards", () => {
  it("reads single-line flashcards but not fences, frontmatter or triple colons", () => {
    const text = "---\nq:: yaml\n---\n- 光合作用发生在哪里 :: 叶绿体\n```\nfake :: card\n```\nA ::: B\nCapital of France?::Paris";
    expect(parseFlashcards(text)).toEqual([
      { question: "光合作用发生在哪里", answer: "叶绿体", line: 3 },
      { question: "Capital of France?", answer: "Paris", line: 8 },
    ]);
  });
  it("turns heading sections into snippets and keeps code blocks intact", () => {
    const text = "intro\n## Summarize\nSummarize this:\n```\n# not a heading\n```\n## Empty\n### Translate\nTranslate to English";
    expect(parseSnippets(text).map(item => [item.title, item.body])).toEqual([
      ["Summarize", "Summarize this:\n```\n# not a heading\n```"],
      ["Translate", "Translate to English"],
    ]);
  });
  it("collects quotes from lines, lists and blockquotes and picks one stable item a day", () => {
    expect(parseQuotes("# Quotes\n- First\n> Second\n| table |\n![[img.png]]\nThird")).toEqual(["First", "Second", "Third"]);
    expect(dailyIndex("2026-09-27", 5)).toBe(dailyIndex("2026-09-27", 5));
    expect(dailyIndex("2026-09-27", 5, 1)).toBe((dailyIndex("2026-09-27", 5) + 1) % 5);
    expect(dailyIndex("x", 0)).toBe(-1);
  });
});

describe("video notes", () => {
  it("accepts YouTube and Bilibili video URLs only", () => {
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=5")?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parseVideoUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
    expect(parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD/?p=2")?.url).toBe("https://www.bilibili.com/video/BV1xx411c7mD/?p=2");
    expect(parseVideoUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
    const note = videoNote(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")!, "2026-09-27");
    expect(note).toContain("source: https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(note).toContain("## 高亮与时间戳");
  });
});

describe("activity heatmap", () => {
  it("counts each note once per day and keeps the window aligned to today", () => {
    const day = (d: number, h = 10) => new Date(2026, 8, d, h).getTime();
    const days = activityDays([{ ctime: day(27), mtime: day(27, 12) }, { ctime: day(20), mtime: day(27) }], 7, new Date(2026, 8, 27, 9));
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toEqual({ day: "2026-09-27", count: 2 });
    expect(days[0]).toEqual({ day: "2026-09-21", count: 0 });
    expect(heatLevel(0, 5)).toBe(0);
    expect(heatLevel(5, 5)).toBe(4);
    expect(heatLevel(1, 5)).toBe(1);
  });
});

describe("weather", () => {
  it("maps WMO codes and parses Open-Meteo responses strictly", () => {
    expect(weatherLabel(0)).toEqual({ text: "晴", icon: "sun" });
    expect(weatherLabel(95).icon).toBe("cloud-lightning");
    const forecast = parseForecast({ current: { temperature_2m: 21.4, apparent_temperature: 20, weather_code: 2 }, daily: { time: ["2026-09-27"], weather_code: [61], temperature_2m_max: [24], temperature_2m_min: [17], precipitation_probability_max: [80] } });
    expect(forecast.days[0]).toEqual({ day: "2026-09-27", code: 61, max: 24, min: 17, rain: 80, sunrise: null, sunset: null });
    expect(() => parseForecast({ current: {} })).toThrow();
    expect(parseGeocoding({ results: [{ name: "Hangzhou", latitude: 30.29, longitude: 120.16, country: "China", admin1: "Zhejiang" }, { bad: true }] }))
      .toEqual([{ name: "Hangzhou", latitude: 30.29, longitude: 120.16, detail: "Zhejiang · China", countryCode: undefined }]);
  });
});

describe("ics agenda", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT", "UID:a", "SUMMARY:Standup\\, team", "DTSTART:20260928T090000", "DTEND:20260928T091500", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", "EXDATE:20260930T090000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a", "RECURRENCE-ID:20261005T090000", "SUMMARY:Standup moved", "DTSTART:20261005T100000", "DTEND:20261005T101500", "END:VEVENT",
    "BEGIN:VEVENT", "UID:b", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261001", "DTEND;VALUE=DATE:20261002", "END:VEVENT",
    "BEGIN:VEVENT", "UID:c", "SUMMARY:Cancelled", "STATUS:CANCELLED", "DTSTART:20260929T090000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:d", "SUMMARY:Long", "DTSTART:20260927T080000", "DURATION:PT3H", "BEGIN:VALARM", "SUMMARY:alarm", "END:VALARM", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  it("expands weekly rules, honours EXDATE, overrides and cancellations", () => {
    const events = agenda(parseIcs(ics), new Date(2026, 8, 27, 10), 14, 20);
    expect(events.map(event => `${event.title}@${event.start.getMonth() + 1}/${event.start.getDate()} ${event.start.getHours()}`)).toEqual([
      "Long@9/27 8", "Standup, team@9/28 9", "Holiday@10/1 0", "Standup moved@10/5 10", "Standup, team@10/7 9",
    ]);
    expect(events.find(event => event.title === "Holiday")?.allDay).toBe(true);
  });
  it("converts UTC times and accepts webcal subscriptions", () => {
    const [event] = parseIcs("BEGIN:VEVENT\nSUMMARY:UTC\nDTSTART:20260927T120000Z\nEND:VEVENT");
    expect(event.start.date.getTime()).toBe(Date.UTC(2026, 8, 27, 12));
    expect(calendarUrl("webcal://example.com/cal.ics")).toBe("https://example.com/cal.ics");
    expect(calendarUrl("http://example.com/cal.ics")).toBeNull();
    expect(calendarUrl("https://user:pw@example.com/cal.ics")).toBeNull();
  });
});

describe("catalog, categories and settings", () => {
  it("keeps every new card opt-in and gives every built-in module a real category", () => {
    // Upgraded layouts that show newly discovered modules still never receive built-in cards on their own.
    const upgraded = normalizeSettings({ pages: [{ id: "mine", name: "Mine", defaultVisible: true, moduleOptions: {}, moduleOrder: [], shortcutGroups: [] }] });
    for (const id of [...Object.keys(EXTRA_MODULES), "quickadd-actions", "dataview-query"]) expect(moduleOptions(upgraded, id).visible).toBe(false);
    void DEFAULT_SETTINGS;
    const known = new Set(MODULE_CATEGORIES.map(category => category.id));
    for (const item of builtinModules()) expect(known.has(moduleCategory(item.id))).toBe(true);
    expect(moduleCategory("weather")).toBe("tools");
    expect(moduleCategory("translate")).toBe("web");
    expect(moduleCategory("anything", "qiaomu-reader")).toBe("plugins");
    expect(moduleCategory("shortcut:abc")).toBe("links");
  });
  it("normalizes new per-card options and drops unsafe values", () => {
    const settings = normalizeSettings({ pages: [{ id: "home", moduleOptions: {
      "world-clock": { visible: true, zones: [{ label: "Tokyo", zone: "Asia/Tokyo" }, { label: "Bad", zone: "Mars/Base" }] },
      "calendar-next": { visible: true, url: "webcal://example.com/a.ics" },
      "weather": { visible: true, location: { name: "X", latitude: 999, longitude: 0 }, unit: "k" },
      "day-progress": { visible: true, start: "25:00", end: "18:30" },
    } }], focusLog: true, ambient: { kind: "pink", volume: 3 } });
    expect(moduleOptions(settings, "world-clock").zones).toEqual([{ label: "Tokyo", zone: "Asia/Tokyo" }]);
    expect(moduleOptions(settings, "calendar-next").url).toBe("https://example.com/a.ics");
    expect(moduleOptions(settings, "weather").location).toBeUndefined();
    expect(moduleOptions(settings, "weather").unit).toBeUndefined();
    expect(moduleOptions(settings, "day-progress").start).toBeUndefined();
    expect(moduleOptions(settings, "day-progress").end).toBe("18:30");
    expect(settings.focusLog).toBe(true);
    expect(settings.ambient).toEqual({ kind: "pink", volume: 1 });
  });
});

describe("new search sources", () => {
  it("translates Chinese to English and everything else to Chinese", () => {
    expect(translateTarget("你好")).toBe("en");
    expect(translateTarget("hello")).toBe("zh");
    const [google, deepl] = DISCOVERY_MODULES.translate.sites;
    expect(discoveryUrl(google, "你好")).toContain("tl=en");
    expect(discoveryUrl(deepl, "a/b")).toBe("https://www.deepl.com/translator#auto/zh/a%5C%2Fb");
  });
  it("keeps newly added multi-search sites off until chosen", () => {
    const defaults = defaultSites(DISCOVERY_MODULES["multi-search"].sites);
    expect(defaults).toEqual(["google", "bing", "duckduckgo", "wikipedia"]);
    expect(defaultSites(DISCOVERY_MODULES["dev-inbox"].sites)).toHaveLength(5);
  });
});

describe("ambient noise", () => {
  it("generates bounded samples for every kind", () => {
    for (const kind of ["white", "pink", "brown"] as const) {
      const data = new Float32Array(4096);
      let seed = 1;
      fillNoise(data, kind, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
      expect(Math.max(...data.map(Math.abs))).toBeLessThan(1);
      expect(data.some(value => value !== 0)).toBe(true);
    }
  });
});
