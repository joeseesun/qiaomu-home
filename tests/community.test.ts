import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXTENSION_PROMPT_EN, EXTENSION_PROMPT_ZH } from "../src/extension-prompt";
import { activityStreak } from "../src/extra-data";
import { GITHUB_QUERIES, parseSearch } from "../src/github";
import { INTEGRATIONS } from "../src/integration-catalog";
import { kanbanSummary, quickAddChoices } from "../src/integrations";
import { moduleCategory } from "../src/module-categories";
import { addPresetPage } from "../src/pages";
import { PAGE_TEMPLATES, moduleOptions, normalizeSettings } from "../src/settings";
import { parseRegistry } from "../src/registry";

describe("community registry", () => {
  it("ships a registry file that parses without dropping entries", () => {
    const json = JSON.parse(readFileSync("registry/extensions.json", "utf8")) as { extensions: unknown[] };
    expect(parseRegistry(json)).toHaveLength(json.extensions.length);
  });
  it("drops unsafe or malformed entries instead of failing the list", () => {
    const entries = parseRegistry({ version: 1, extensions: [
      { id: "good-one", name: { zh: "好" }, description: { en: "Fine" }, repo: "https://github.com/a/b", store: true },
      { id: "good-one", name: { zh: "重复" }, description: { zh: "x" }, repo: "https://github.com/a/c" },
      { id: "Bad Id", name: { zh: "x" }, description: { zh: "x" }, repo: "https://github.com/a/d" },
      { id: "evil", name: { zh: "x" }, description: { zh: "x" }, repo: "javascript:alert(1)" },
      { id: "no-name", description: { zh: "x" }, repo: "https://github.com/a/e" },
    ] });
    expect(entries).toEqual([{ id: "good-one", repo: "https://github.com/a/b", name: { zh: "好", en: "好" }, description: { zh: "Fine", en: "Fine" }, author: "", icon: "puzzle", store: true }]);
    expect(parseRegistry({ version: 2, extensions: [] })).toEqual([]);
  });
  it("keeps the in-app prompt and the published guide identical", () => {
    const doc = readFileSync("docs/build-an-extension.md", "utf8");
    expect(doc).toContain(EXTENSION_PROMPT_ZH);
    expect(doc).toContain(EXTENSION_PROMPT_EN);
    for (const prompt of [EXTENSION_PROMPT_ZH, EXTENSION_PROMPT_EN]) expect(prompt).toContain("protocol/qiaomu-home.ts");
  });
  it("files community entries and the build card under their own category", () => {
    expect(moduleCategory("community:qiaomu-reader")).toBe("community");
    expect(moduleCategory("build-extension")).toBe("community");
    for (const id of Object.keys(INTEGRATIONS)) expect(moduleCategory(id)).toBe("plugins");
  });
});

describe("integration parsers", () => {
  it("flattens QuickAdd multi-choices and skips malformed ones", () => {
    expect(quickAddChoices([{ name: "Log", type: "Capture" }, { name: "Folder", type: "Multi", choices: [{ name: "Meeting", type: "Template" }] }, { type: "Macro" }, null]))
      .toEqual([{ name: "Log", type: "Capture" }, { name: "Meeting", type: "Template" }]);
    expect(quickAddChoices(undefined)).toEqual([]);
  });
  it("counts Kanban lanes and open cards outside code fences", () => {
    const board = "---\nkanban-plugin: basic\n---\n## Todo\n- [ ] A\n- [ ] B\n## Done\n- [x] C\n```\n- [ ] not a card\n```\n%% kanban:settings %%";
    expect(kanbanSummary(board)).toEqual({ lanes: 2, cards: 3, open: 2 });
  });
  it("parses GitHub search results and rejects non-GitHub links", () => {
    expect(parseSearch({ items: [
      { title: "Fix bug", html_url: "https://github.com/o/r/pull/3", repository_url: "https://api.github.com/repos/o/r", number: 3, updated_at: "2026-09-27T00:00:00Z", pull_request: {} },
      { title: "Evil", html_url: "https://evil.example/x" },
    ] })).toEqual([{ title: "Fix bug", url: "https://github.com/o/r/pull/3", repo: "o/r", number: 3, updated: "2026-09-27T00:00:00Z", pull: true }]);
    expect(GITHUB_QUERIES.reviews).toContain("review-requested:@me");
  });
});

describe("page templates", () => {
  it("adds template pages with fresh ids and independent shortcut groups", () => {
    const settings = normalizeSettings(null);
    const first = addPresetPage(settings, "home", "工作台");
    const second = addPresetPage(settings, "home");
    expect(first.id).not.toBe(second.id);
    expect(first.name).toBe("工作台");
    expect(first.shortcutGroups[0].id).not.toBe(second.shortcutGroups[0].id);
    expect(moduleOptions(settings, `shortcut:${first.shortcutGroups[0].id}`, first.id).visible).toBe(true);
    expect(moduleOptions(settings, "focus-timer", addPresetPage(settings, "focus").id).visible).toBe(true);
    expect(Object.keys(PAGE_TEMPLATES)).toEqual(["home", "focus", "knowledge", "reading", "entertainment", "explore"]);
  });
});

describe("activity streak", () => {
  it("counts consecutive days and forgives a quiet today", () => {
    expect(activityStreak([{ count: 1 }, { count: 0 }, { count: 2 }, { count: 3 }])).toBe(2);
    expect(activityStreak([{ count: 1 }, { count: 2 }, { count: 0 }])).toBe(2);
    expect(activityStreak([{ count: 0 }, { count: 0 }])).toBe(0);
  });
});

import { habitNames, habitProblem, habitStreak, MAX_HABITS } from "../src/habits";
describe("habits", () => {
  it("parses saved names, dropping duplicates and reserved keys", () => {
    expect(habitNames("运动, 阅读，运动\n冥想, tags, __proto__")).toEqual(["运动", "阅读", "冥想"]);
    expect(habitNames(undefined)).toEqual([]);
  });
  it("explains why a new habit cannot be added", () => {
    expect(habitProblem("  ", [])).not.toBeNull();
    expect(habitProblem("a,b", [])).not.toBeNull();
    expect(habitProblem("阅读", ["阅读"])).not.toBeNull();
    expect(habitProblem("新习惯", Array.from({ length: MAX_HABITS }, (_, i) => `h${i}`))).not.toBeNull();
    expect(habitProblem("跑步 30 分钟", ["阅读"])).toBeNull();
  });
  it("counts streaks from past days plus today", () => {
    const past = [undefined, true, true, false, true];
    expect(habitStreak(offset => past[offset], true)).toBe(3);
    expect(habitStreak(offset => past[offset], false)).toBe(2);
    expect(habitStreak(() => undefined, false)).toBe(0);
  });
});
