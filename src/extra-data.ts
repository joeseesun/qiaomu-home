import { L } from "./i18n";
/** Pure helpers behind the second wave of Home cards. Nothing here touches Obsidian APIs. */

// Time ------------------------------------------------------------------------

export function clockMinutes(value: string | undefined): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export interface TimeProgress { work: number | null; workState: "before" | "during" | "after" | "off"; workLeft: number; day: number; week: number; month: number; year: number }
/** Fractions in 0–1. Weeks start on Monday. A work range that ends before it starts is ignored. */
export function timeProgress(now: Date, start = "09:00", end = "18:00"): TimeProgress {
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const from = clockMinutes(start), to = clockMinutes(end);
  let work: number | null = null, workState: TimeProgress["workState"] = "off", workLeft = 0;
  if (from !== null && to !== null && to > from) {
    work = Math.min(1, Math.max(0, (minutes - from) / (to - from)));
    workState = minutes < from ? "before" : minutes >= to ? "after" : "during";
    workLeft = Math.max(0, Math.round(to - minutes));
  }
  const span = (a: Date, b: Date) => Math.min(1, Math.max(0, (now.getTime() - a.getTime()) / (b.getTime() - a.getTime())));
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(midnight); monday.setDate(midnight.getDate() - ((midnight.getDay() + 6) % 7));
  const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
  const tomorrow = new Date(midnight); tomorrow.setDate(midnight.getDate() + 1);
  return {
    work, workState, workLeft,
    day: span(midnight, tomorrow),
    week: span(monday, nextMonday),
    month: span(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    year: span(new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)),
  };
}

export interface ZoneEntry { label: string; zone: string }
export function validZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}
/** One zone per line: `Label | Area/City` or just `Area/City`. Invalid zones throw with the line number. */
export function parseZones(input: string): ZoneEntry[] {
  return input.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 8).map((line, index) => {
    const separator = line.indexOf("|");
    const zone = (separator >= 0 ? line.slice(separator + 1) : line).trim();
    const label = (separator >= 0 ? line.slice(0, separator).trim() : "") || zone.split("/").pop()!.replace(/_/g, " ");
    if (!validZone(zone)) throw new Error(L("第 {v} 行：无法识别时区「{zone}」", "Line {v}: unknown time zone “{zone}”", { v: index + 1, zone }));
    return { label: label.slice(0, 40), zone };
  });
}
export function zoneLines(zones: ZoneEntry[]): string { return zones.map(zone => `${zone.label} | ${zone.zone}`).join("\n"); }
export function defaultZones(chinese: boolean): ZoneEntry[] {
  return chinese
    ? [{ label: "北京", zone: "Asia/Shanghai" }, { label: "纽约", zone: "America/New_York" }, { label: "伦敦", zone: "Europe/London" }]
    : [{ label: L("纽约", "New York"), zone: "America/New_York" }, { label: L("伦敦", "London"), zone: "Europe/London" }, { label: L("东京", "Tokyo"), zone: "Asia/Tokyo" }];
}
/** Wall time in a zone plus its calendar-day offset from the local day (-1, 0, +1). */
export function zoneTime(now: Date, zone: string): { time: string; offset: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(part => [part.type, part.value]));
  const there = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const here = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return { time: `${parts.hour}:${parts.minute}`, offset: Math.round((there - here) / 86400000) };
}

// Notes -----------------------------------------------------------------------

/** Lines outside YAML frontmatter and fenced code, with their 0-based line numbers. */
export function contentLines(markdown: string): Array<{ text: string; line: number }> {
  const lines = markdown.split(/\r?\n/);
  const result: Array<{ text: string; line: number }> = [];
  let index = 0, fence = false;
  if (/^\uFEFF?---\s*$/.test(lines[0] ?? "")) {
    const close = lines.findIndex((line, i) => i > 0 && /^---\s*$/.test(line));
    if (close > 0) index = close + 1;
  }
  for (; index < lines.length; index++) {
    const text = lines[index];
    if (/^\s*(```|~~~)/.test(text)) { fence = !fence; continue; }
    if (!fence) result.push({ text, line: index });
  }
  return result;
}

const listMarker = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/;
export interface Flashcard { question: string; answer: string; line: number }
/** Single-line cards in the common `question :: answer` form. `:::` and empty sides are ignored. */
export function parseFlashcards(markdown: string): Flashcard[] {
  const cards: Flashcard[] = [];
  for (const { text, line } of contentLines(markdown)) {
    const clean = text.replace(listMarker, "").replace(/^>\s?/, "").trim();
    const match = /^(.+?)\s*(?<!:)::(?!:)\s*(.+)$/.exec(clean);
    if (!match || /^#/.test(clean) || /^\[/.test(clean)) continue;
    cards.push({ question: match[1].trim().slice(0, 300), answer: match[2].trim().slice(0, 500), line });
  }
  return cards;
}

export interface Snippet { title: string; body: string; line: number }
/** Every heading starts a snippet; its body runs to the next heading. Code fences stay intact. */
export function parseSnippets(markdown: string): Snippet[] {
  const lines = markdown.split(/\r?\n/);
  const visible = new Set(contentLines(markdown).map(entry => entry.line));
  const snippets: Snippet[] = [];
  let current: { title: string; line: number; body: string[] } | null = null;
  const flush = () => { if (current) { const body = current.body.join("\n").trim(); if (body) snippets.push({ title: current.title, body, line: current.line }); } };
  let start = 0;
  if (/^\uFEFF?---\s*$/.test(lines[0] ?? "")) { const close = lines.findIndex((line, i) => i > 0 && /^---\s*$/.test(line)); if (close > 0) start = close + 1; }
  for (let index = start; index < lines.length; index++) {
    const heading = visible.has(index) ? /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index]) : null;
    if (heading) { flush(); current = { title: heading[1].slice(0, 120), line: index, body: [] }; }
    else current?.body.push(lines[index]);
  }
  flush();
  return snippets;
}

/** Quote candidates: plain lines, list items or blockquotes; headings, tables and embeds are skipped. */
export function parseQuotes(markdown: string): string[] {
  return contentLines(markdown).map(({ text }) => text.replace(listMarker, "").replace(/^>\s?/, "").trim())
    .filter(text => text.length > 1 && !/^(#|\||!\[|<|%%|---$)/.test(text)).map(text => text.slice(0, 400));
}

/** Stable pick for a day, so every Home tab shows the same item until the user asks for another. */
export function dailyIndex(day: string, length: number, offset = 0): number {
  if (length <= 0) return -1;
  let hash = 2166136261;
  for (const char of day) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (((hash >>> 0) + offset) % length + length) % length;
}

export const BUILTIN_QUOTES: Record<"zh" | "en", string[]> = {
  zh: [
    "学而不思则罔，思而不学则殆。——《论语》",
    "千里之行，始于足下。——《老子》",
    "知之者不如好之者，好之者不如乐之者。——《论语》",
    "不积跬步，无以至千里。——《荀子》",
    "吾生也有涯，而知也无涯。——《庄子》",
    "博学之，审问之，慎思之，明辨之，笃行之。——《中庸》",
    "业精于勤，荒于嬉；行成于思，毁于随。——韩愈",
    "纸上得来终觉浅，绝知此事要躬行。——陆游",
    "问渠那得清如许？为有源头活水来。——朱熹",
    "天下难事，必作于易；天下大事，必作于细。——《老子》",
  ],
  en: [
    "Well done is better than well said. — Benjamin Franklin",
    "Our life is frittered away by detail. Simplify, simplify. — Henry David Thoreau",
    "The only person you are destined to become is the person you decide to be. — Ralph Waldo Emerson",
    "Tell me and I forget. Teach me and I remember. Involve me and I learn. — Proverb",
    "What we achieve inwardly will change outer reality. — Plutarch",
    "It is not that we have a short time to live, but that we waste a lot of it. — Seneca",
    "Knowing is not enough; we must apply. — Johann Wolfgang von Goethe",
    "The secret of getting ahead is getting started. — Proverb",
  ],
};

// Video notes -----------------------------------------------------------------

export interface VideoLink { platform: "YouTube" | "Bilibili"; id: string; url: string }
export function parseVideoUrl(input: string): VideoLink | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be" || host === "youtube.com") {
    const id = host === "youtu.be" ? url.pathname.slice(1).split("/")[0]
      : url.pathname === "/watch" ? url.searchParams.get("v") ?? ""
      : (/^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1] ?? "");
    return /^[\w-]{11}$/.test(id) ? { platform: "YouTube", id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === "bilibili.com") {
    const id = /^\/video\/((?:BV|bv)[0-9A-Za-z]{10}|av\d+)/.exec(url.pathname)?.[1];
    if (!id) return null;
    const part = Number(url.searchParams.get("p"));
    return { platform: "Bilibili", id, url: `https://www.bilibili.com/video/${id}/${Number.isInteger(part) && part > 1 ? `?p=${part}` : ""}` };
  }
  return null;
}
export function videoNote(video: VideoLink, day: string): string {
  const [points, highlights, questions] = [L("要点", "Key points"), L("高亮与时间戳", "Highlights"), L("问题与行动", "Questions and actions")];
  return [
    "---", `source: ${video.url}`, `platform: ${video.platform}`, `created: ${day}`, "tags:", "  - video", "---", "",
    video.platform === "YouTube" ? `![](${video.url})` : `[${video.platform}](${video.url})`, "",
    `## ${points}`, "- ", "", `## ${highlights}`, "- [00:00] ", "", `## ${questions}`, "- ", "",
  ].join("\n");
}

// Activity --------------------------------------------------------------------

/** Count of notes created or edited on each of the last `days` local days, oldest first. Each note counts once per day. */
export function activityDays(stats: Array<{ ctime: number; mtime: number }>, days: number, today: Date): Array<{ day: string; count: number }> {
  const key = (time: number) => { const date = new Date(time); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
  const counts = new Map<string, number>();
  for (const stat of stats) for (const day of new Set([key(stat.ctime), key(stat.mtime)])) counts.set(day, (counts.get(day) ?? 0) + 1);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index), 12);
    const day = key(date.getTime());
    return { day, count: counts.get(day) ?? 0 };
  });
}
/** Consecutive active days ending today; a quiet today does not break yesterday's streak yet. */
export function activityStreak(days: Array<{ count: number }>): number {
  let index = days.length - 1;
  if (index >= 0 && days[index].count === 0) index--;
  let streak = 0;
  while (index >= 0 && days[index].count > 0) { streak++; index--; }
  return streak;
}
export function heatLevel(count: number, max: number): number {
  return count <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

// Weather ---------------------------------------------------------------------

export interface WeatherLocation { name: string; latitude: number; longitude: number }
export function weatherLabel(code: number): { text: string; icon: string } {
  const table: Array<[number[], string, string, string]> = /* i18n */ [
    [[0], "晴", "Clear", "sun"], [[1, 2], "多云间晴", "Partly cloudy", "cloud-sun"], [[3], "阴", "Overcast", "cloud"],
    [[45, 48], "雾", "Fog", "cloud-fog"], [[51, 53, 55, 56, 57], "毛毛雨", "Drizzle", "cloud-drizzle"],
    [[61, 63, 65, 66, 67], "雨", "Rain", "cloud-rain"], [[71, 73, 75, 77], "雪", "Snow", "cloud-snow"],
    [[80, 81, 82], "阵雨", "Showers", "cloud-rain-wind"], [[85, 86], "阵雪", "Snow showers", "cloud-snow"],
    [[95, 96, 99], "雷雨", "Thunderstorm", "cloud-lightning"],
  ];
  const match = table.find(([codes]) => codes.includes(code));
  return match ? { text: L(match[1], match[2]), icon: match[3] } : { text: L("未知", "Unknown"), icon: "cloud" };
}
export function forecastUrl(location: WeatherLocation, unit: "c" | "f"): string {
  const params = new URLSearchParams({
    latitude: location.latitude.toFixed(4), longitude: location.longitude.toFixed(4),
    current: "temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m", daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    timezone: "auto", forecast_days: "3", ...(unit === "f" ? { temperature_unit: "fahrenheit" } : {}),
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}
export interface Forecast {
  current: { temperature: number; feels: number; code: number; humidity: number | null; wind: number | null };
  days: Array<{ day: string; code: number; max: number; min: number; rain: number | null; sunrise: string | null; sunset: string | null }>;
  hours: Array<{ time: string; temperature: number; code: number; rain: number | null }>;
}
export function parseForecast(json: unknown): Forecast {
  const data = json as { current?: Record<string, unknown>; daily?: Record<string, unknown[]>; hourly?: Record<string, unknown[]> };
  const number = (value: unknown) => { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid forecast"); return value; };
  const optional = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const current = { humidity: optional(data.current?.relative_humidity_2m), wind: optional(data.current?.wind_speed_10m), temperature: number(data.current?.temperature_2m), feels: number(data.current?.apparent_temperature), code: number(data.current?.weather_code) };
  const daily = data.daily ?? {};
  const days = (daily.time ?? []).slice(0, 3).map((day, index) => ({
    day: String(day), code: number(daily.weather_code?.[index]), max: number(daily.temperature_2m_max?.[index]), min: number(daily.temperature_2m_min?.[index]),
    rain: optional(daily.precipitation_probability_max?.[index]),
    sunrise: typeof daily.sunrise?.[index] === "string" ? daily.sunrise[index] : null, sunset: typeof daily.sunset?.[index] === "string" ? daily.sunset[index] : null,
  }));
  const hourly = data.hourly ?? {};
  const currentHour = typeof data.current?.time === "string" ? data.current.time.slice(0, 13) : "";
  const hours = currentHour ? (hourly.time ?? []).flatMap((time, index) => {
    const temperature = optional(hourly.temperature_2m?.[index]), code = optional(hourly.weather_code?.[index]);
    if (typeof time !== "string" || time.slice(0, 13) < currentHour || temperature === null || code === null) return [];
    return [{ time, temperature, code, rain: optional(hourly.precipitation_probability?.[index]) }];
  }).slice(0, 8) : [];
  return { current, days, hours };
}
export function parseGeocoding(json: unknown): Array<WeatherLocation & { detail: string; countryCode?: string }> {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap(item => {
    const place = item as Record<string, unknown>;
    if (typeof place.name !== "string" || typeof place.latitude !== "number" || typeof place.longitude !== "number" || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) return [];
    return [{ name: place.name, latitude: place.latitude, longitude: place.longitude, countryCode: typeof place.country_code === "string" ? place.country_code : undefined, detail: [...new Set([place.admin2, place.admin1, place.country].filter(value => typeof value === "string" && value))].join(" · ") }];
  }).slice(0, 12);
}

// Calendar (.ics) -------------------------------------------------------------

interface IcsDate { date: Date; allDay: boolean }
interface IcsEvent { uid: string; title: string; location: string; start: IcsDate; end: Date | null; rule: Record<string, string> | null; exdates: number[]; recurrenceId: number | null }
export interface AgendaEvent { title: string; location: string; start: Date; end: Date; allDay: boolean }

/** Floating and TZID times are read as local time; UTC (`Z`) times are converted. */
function icsDate(value: string, params: string): IcsDate | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, z] = match;
  if (!hh || /VALUE=DATE(?!-)/i.test(params)) return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true };
  const parts = [Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0)] as const;
  return { date: z ? new Date(Date.UTC(...parts)) : new Date(...parts), allDay: false };
}
function duration(value: string): number {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return 0;
  const [, sign, w, d, h, m, s] = match;
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}
const unescapeText = (value: string) => value.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> & { cancelled?: boolean; duration?: number } | null = null;
  let depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) { current = { exdates: [], rule: null, recurrenceId: null, title: "", location: "", uid: "" }; depth = 0; continue; }
    if (!current) continue;
    if (/^BEGIN:/i.test(line)) { depth++; continue; }
    if (/^END:/i.test(line) && depth > 0) { depth--; continue; }
    if (/^END:VEVENT$/i.test(line)) {
      if (current.start && !current.cancelled) {
        const end = current.end ?? (current.duration ? new Date(current.start.date.getTime() + current.duration) : null);
        events.push({ uid: current.uid ?? "", title: current.title || "(untitled)", location: current.location ?? "", start: current.start, end, rule: current.rule ?? null, exdates: current.exdates ?? [], recurrenceId: current.recurrenceId ?? null });
      }
      current = null; continue;
    }
    if (depth > 0) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon), value = line.slice(colon + 1);
    const name = head.split(";")[0].toUpperCase(), params = head.slice(name.length);
    if (name === "SUMMARY") current.title = unescapeText(value).slice(0, 200);
    else if (name === "LOCATION") current.location = unescapeText(value).slice(0, 200);
    else if (name === "UID") current.uid = value.trim();
    else if (name === "STATUS") current.cancelled = /CANCELLED/i.test(value);
    else if (name === "DTSTART") current.start = icsDate(value, params) ?? undefined;
    else if (name === "DTEND") current.end = icsDate(value, params)?.date ?? null;
    else if (name === "DURATION") current.duration = duration(value);
    else if (name === "RECURRENCE-ID") current.recurrenceId = icsDate(value, params)?.date.getTime() ?? null;
    else if (name === "EXDATE") for (const item of value.split(",")) { const date = icsDate(item, params); if (date) current.exdates!.push(date.date.getTime()); }
    else if (name === "RRULE") current.rule = Object.fromEntries(value.split(";").map(part => part.split("=")).filter(pair => pair.length === 2).map(([key, val]) => [key.toUpperCase(), val]));
  }
  return events;
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function occurrences(event: IcsEvent, until: number): Date[] {
  const start = event.start.date;
  if (!event.rule) return [start];
  const rule = event.rule, interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = Number(rule.COUNT) || Infinity;
  const ruleEnd = rule.UNTIL ? icsDate(rule.UNTIL, "")?.date.getTime() ?? Infinity : Infinity;
  const last = Math.min(until, ruleEnd === Infinity ? Infinity : ruleEnd + (event.start.allDay ? 86399999 : 0));
  const days = rule.BYDAY ? rule.BYDAY.split(",").map(day => WEEKDAYS.indexOf(day.slice(-2).toUpperCase())).filter(day => day >= 0) : [];
  const result: Date[] = [];
  const at = (base: Date, dayShift: number, monthShift = 0, yearShift = 0) =>
    new Date(base.getFullYear() + yearShift, base.getMonth() + monthShift, base.getDate() + dayShift, base.getHours(), base.getMinutes(), base.getSeconds());
  for (let step = 0, made = 0; step < 5000 && made < count; step++) {
    let batch: Date[] = [];
    if (rule.FREQ === "DAILY") batch = [at(start, step * interval)];
    else if (rule.FREQ === "WEEKLY") {
      const weekStart = at(start, step * interval * 7 - start.getDay());
      batch = (days.length ? days : [start.getDay()]).sort((a, b) => a - b).map(day => at(weekStart, day)).filter(date => date >= start);
    } else if (rule.FREQ === "MONTHLY") { const date = at(start, 0, step * interval); batch = date.getDate() === start.getDate() ? [date] : []; }
    else if (rule.FREQ === "YEARLY") { const date = at(start, 0, 0, step * interval); batch = date.getMonth() === start.getMonth() ? [date] : []; }
    else return [start];
    if (batch.length && batch[0].getTime() > last) break;
    for (const date of batch) {
      if (made >= count || date.getTime() > last) break;
      made++;
      result.push(date);
    }
  }
  return result;
}

/** Events that have not ended yet and start within `days` of `from`, soonest first. */
export function agenda(events: IcsEvent[], from: Date, days: number, limit: number): AgendaEvent[] {
  const until = from.getTime() + days * 86400000;
  const overridden = new Set(events.filter(event => event.recurrenceId !== null).map(event => `${event.uid}@${event.recurrenceId}`));
  const result: AgendaEvent[] = [];
  for (const event of events) {
    const length = event.end ? Math.max(0, event.end.getTime() - event.start.date.getTime()) : event.start.allDay ? 86400000 : 0;
    for (const start of occurrences(event, until)) {
      if (event.recurrenceId === null && (event.exdates.includes(start.getTime()) || overridden.has(`${event.uid}@${start.getTime()}`))) continue;
      const end = new Date(start.getTime() + length);
      if (start.getTime() >= until || (length ? end.getTime() <= from.getTime() : start.getTime() < from.getTime())) continue;
      result.push({ title: event.title, location: event.location, start, end, allDay: event.start.allDay });
    }
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title)).slice(0, limit);
}

export function calendarUrl(input: string): string | null {
  const value = input.trim().replace(/^webcals?:\/\//i, "https://");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}
