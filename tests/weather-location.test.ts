import { describe, expect, it, vi } from "vitest";
import { coordinateLocation, localWeatherPlaces, searchWeatherPlaces, weatherQueryVariants } from "../src/weather-location";
import { forecastUrl, parseForecast, parseGeocoding } from "../src/extra-data";
import { moduleOptions, normalizeSettings } from "../src/settings";

describe("weather place search", () => {
  it("resolves short/full Chinese names, pinyin and a province qualifier to the same WGS84 location offline", async () => {
    const fetch = vi.fn(async () => { throw new Error("offline"); });
    for (const query of ["温州", "温州市", "Wenzhou", "wen zhou", "浙江省温州市", "溫州市"]) {
      const results = await searchWeatherPlaces(query, "CN", "zh", fetch);
      expect(results[0]).toMatchObject({ name: "温州市", latitude: 27.99942, longitude: 120.66682, detail: "浙江 · 中国" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("covers county-level names and ranks the city before similarly named districts", () => {
    for (const query of ["杭州", "杭州市", "泉州", "苏州", "乐清", "瑞安", "苍南", "永嘉"]) {
      expect(localWeatherPlaces(query, "CN")[0].name).toMatch(new RegExp(`^${query.replace(/市$/, "")}`));
    }
    expect(localWeatherPlaces("Quanzhou", "CN", false)[0].latitude).toBeCloseTo(24.91389);
    expect(localWeatherPlaces("温州", "US")).toEqual([]);
    expect(localWeatherPlaces("", "CN")).toEqual([]);
  });
  it("sends the chosen country/region filter and retains valid results when another alias request fails", async () => {
    const fetch = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      expect(params.get("countryCode")).toBe("JP");
      if (params.get("name") === "东京") throw new Error("one alias unavailable");
      return JSON.stringify({ results: [{ name: "Tokyo", latitude: 35.68, longitude: 139.69, country_code: "JP", country: "Japan" }, { name: "Tokyo", latitude: 30, longitude: -90, country_code: "US" }] });
    });
    expect(await searchWeatherPlaces("东京", "JP", "en", fetch)).toHaveLength(1);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(5);
    expect(weatherQueryVariants("杭州市")).toContain("杭州");
  });
  it("distinguishes an empty search from a complete network failure", async () => {
    expect(await searchWeatherPlaces("Paris", "FR", "fr", async () => "{}")).toEqual([]);
    await expect(searchWeatherPlaces("Paris", "FR", "fr", async () => { throw new Error("offline"); })).rejects.toThrow();
    expect(await searchWeatherPlaces("  ", "FR", "fr", async () => { throw new Error("must not fetch"); })).toEqual([]);
  });
  it("validates manual coordinates and remote coordinates, including blanks, NaN and out-of-range numbers", () => {
    expect(coordinateLocation("温州", "28", "120.6")).toEqual({ name: "温州", latitude: 28, longitude: 120.6 });
    for (const values of [["", "28", "120"], ["x", "", "120"], ["x", "91", "0"], ["x", "NaN", "0"], ["x", "0", "181"]]) expect(coordinateLocation(...values as [string, string, string])).toBeNull();
    expect(parseGeocoding({ results: [{ name: "bad", latitude: NaN, longitude: 0 }, { name: "bad", latitude: 0, longitude: 181 }] })).toEqual([]);
  });
  it("preserves an old selected city and persists only valid region codes", () => {
    const location = { name: "Old custom name", latitude: 28, longitude: 120 };
    const saved = (countryCode?: string) => normalizeSettings({ pages: [{ id: "home", name: "Home", moduleOptions: { weather: { visible: true, limit: 3, location, countryCode } } }] });
    expect(moduleOptions(saved(), "weather").location).toEqual(location);
    expect(moduleOptions(saved("JP"), "weather").countryCode).toBe("JP");
    expect(moduleOptions(saved(""), "weather").countryCode).toBe("");
    expect(moduleOptions(saved("not-a-region"), "weather").countryCode).toBeUndefined();
  });
});

describe("hourly weather", () => {
  it("uses forecast-local time to choose the next hours across midnight, skipping incomplete points", () => {
    const forecast = parseForecast({ current: { temperature_2m: 20, apparent_temperature: 19, weather_code: 2, time: "2026-10-04T23:15", relative_humidity_2m: 75, wind_speed_10m: 8 }, hourly: {
      time: ["2026-10-04T22:00", "2026-10-04T23:00", "2026-10-05T00:00", "2026-10-05T01:00"], temperature_2m: [21, 20, 19, null], weather_code: [0, 2, 3, 3], precipitation_probability: [0, 10, 20, 30],
    } });
    expect(forecast.hours.map(hour => hour.time)).toEqual(["2026-10-04T23:00", "2026-10-05T00:00"]);
    expect(forecast.current).toMatchObject({ humidity: 75, wind: 8 });
    const params = new URL(forecastUrl({ name: "x", latitude: 28, longitude: 120 }, "f")).searchParams;
    expect(params.get("temperature_unit")).toBe("fahrenheit");
    expect(params.get("hourly")).toContain("precipitation_probability");
  });
});
