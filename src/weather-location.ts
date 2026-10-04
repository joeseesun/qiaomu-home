import cities from "./data/weather-cities-cn.json";
import countryCodes from "./data/weather-country-codes.json";
import { parseGeocoding, type WeatherLocation } from "./extra-data";

export const WEATHER_COUNTRIES = countryCodes;
export interface WeatherPlace extends WeatherLocation { detail: string; countryCode?: string }
const normalize = (value: string) => value.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s,，·'’-]/g, "");
const shortName = (value: string) => value.replace(/(?:省|市|县|縣|区|區|自治县|自治縣|自治区|自治區)$/u, "");
function buildRecords() { return cities.map(row => {
  const [name, ascii, aliases, province, latitude, longitude, population, kind, provinceAscii] = row as [string, string, string, string, number, number, number, string, string];
  const keys = [...new Set(aliases.split("|").flatMap(alias => {
    const value = normalize(alias);
    return [value, shortName(value), value.replace(/(?:shi|xian|qu)$/, "")];
  }).filter(Boolean))];
  return { name, ascii, province, provinceAscii, latitude, longitude, population, kind, keys, region: shortName(normalize(province)) };
}); }
let records: ReturnType<typeof buildRecords> | undefined;

/** Names, pinyin and province-qualified names share one offline coordinate source. */
export function localWeatherPlaces(query: string, countryCode = "", chinese = true): WeatherPlace[] {
  const q = normalize(query.trim());
  if (q.length < 2 || (countryCode && countryCode !== "CN")) return [];
  records ??= buildRecords();
  return records.flatMap(place => {
    const terms = [q];
    if (place.region && q.includes(place.region)) terms.push(q.replace(place.region, "").replace(/^省/, ""));
    const exact = place.keys.some(key => terms.includes(key));
    const prefix = !exact && place.keys.some(key => terms.some(term => term.length >= 2 && key.startsWith(term)));
    if (!exact && !prefix) return [];
    return [{ place, score: (exact ? 2 : 0) + (place.kind.startsWith("P") ? 1 : 0) }];
  }).sort((a, b) => b.score - a.score || b.place.population - a.place.population)
    .slice(0, 12).map(({ place }) => ({
      name: chinese ? place.name : place.ascii, latitude: place.latitude, longitude: place.longitude, countryCode: "CN",
      detail: `${chinese ? place.province : place.provinceAscii} · ${chinese ? "中国" : "China"}`,
    }));
}

export function weatherQueryVariants(query: string): string[] {
  const value = query.trim().slice(0, 100);
  if (!value) return [];
  if (!/^[\u3400-\u9fff]+$/.test(value)) return [value];
  const base = shortName(value);
  return [...new Set([value, base, `${base}市`, `${base}县`, `${base}区`])].slice(0, 5);
}

export async function searchWeatherPlaces(query: string, countryCode: string, language: string, fetch: (url: string) => Promise<string>): Promise<WeatherPlace[]> {
  const local = localWeatherPlaces(query, countryCode, language === "zh");
  if (local.length) return local;
  const variants = weatherQueryVariants(query);
  if (!variants.length) return [];
  const responses = await Promise.allSettled(variants.map(async name => {
    const params = new URLSearchParams({ name, count: "12", language, format: "json" });
    if (WEATHER_COUNTRIES.includes(countryCode)) params.set("countryCode", countryCode);
    return parseGeocoding(JSON.parse(await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`)));
  }));
  if (responses.every(response => response.status === "rejected")) throw new Error("Location search unavailable");
  const unique = new Map<string, WeatherPlace>();
  for (const response of responses) if (response.status === "fulfilled") for (const place of response.value) {
    if (countryCode && place.countryCode !== countryCode) continue;
    const key = `${place.name}:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
    if (!unique.has(key)) unique.set(key, place);
  }
  return [...unique.values()].slice(0, 12);
}

export function coordinateLocation(name: string, latitude: string, longitude: string): WeatherLocation | null {
  if (!name.trim() || !latitude.trim() || !longitude.trim()) return null;
  const lat = Number(latitude), lon = Number(longitude);
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180
    ? { name: name.trim().slice(0, 80), latitude: lat, longitude: lon } : null;
}
