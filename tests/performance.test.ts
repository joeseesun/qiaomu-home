import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankNotes, type NoteCandidate } from "../src/search";
import { coverRect, shadeStops } from "../src/wallpaper/glass";

describe("rankNotes top-k", () => {
  it("returns exactly what sorting every match would", () => {
    const words = ["home", "Home plan", "homework", "hom", "notes", "ohm", "Hm", "h o m e", "主页 home", "holm"];
    const candidates: NoteCandidate[] = Array.from({ length: 600 }, (_, index) => {
      const basename = `${words[index % words.length]}${index % 7 ? "" : ` ${index}`}`;
      return { path: `f${index % 13}/${basename}.md`, basename, extension: index % 5 ? "md" : "pdf", aliases: index % 11 ? [] : ["home alias"], mtime: 0 };
    });
    const recent = candidates.slice(0, 30).map((file) => file.path);
    for (const query of ["h", "ho", "home", "o", "plan"]) {
      for (const limit of [1, 6, 50]) {
        const all = rankNotes(query, candidates, recent, Number.MAX_SAFE_INTEGER).slice(0, limit);
        expect(rankNotes(query, candidates, recent, limit)).toEqual(all);
      }
    }
  });
});

describe("baked glass", () => {
  it("crops like background-size: cover, centered", () => {
    expect(coverRect({ width: 1600, height: 900 }, { width: 800, height: 900 })).toEqual({ x: -400, y: 0, width: 1600, height: 900 });
    expect(coverRect({ width: 1000, height: 1000 }, { width: 400, height: 200 })).toEqual({ x: 0, y: -100, width: 400, height: 400 });
  });

  it("bakes the same shade gradient the stylesheet draws", () => {
    expect(shadeStops(0.4)).toEqual([[0, "rgba(0,0,0,0.30000000000000004)"], [0.55, "rgba(0,0,0,0.4)"], [1, "rgba(0,0,0,0.55)"]]);
    const css = readFileSync("styles.css", "utf8");
    expect(css).toContain("rgba(0, 0, 0, calc(var(--qh-dim) * 0.75)) 0%");
    expect(css).toContain("rgba(0, 0, 0, var(--qh-dim)) 55%");
    expect(css).toContain("rgba(0, 0, 0, calc(var(--qh-dim) + 0.15)) 100%");
    expect(css).toContain("--qh-blur: blur(22px) saturate(1.25);");
  });

  it("only replaces the live blur once the glass is ready, and never on the opaque results list", () => {
    const css = readFileSync("styles.css", "utf8");
    const results = css.slice(css.indexOf(".qh-results {"), css.indexOf("}", css.indexOf(".qh-results {")));
    expect(results).not.toContain("backdrop-filter");
    for (const rule of css.match(/[^}]*backdrop-filter: none;[^}]*}/g) ?? []) expect(rule).toContain(".qh-glass");
  });
});
