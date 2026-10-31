import * as obsidian from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type QiaomuHomePlugin from "../src/main";
import { GITHUB_QUERIES, loadInbox } from "../src/github";

const request = vi.spyOn(obsidian, "requestUrl");
const plugin = {
  settings: { githubSecret: "github-token" },
  app: { secretStorage: { getSecret: () => "test-token" } },
} as unknown as QiaomuHomePlugin;
type Response = Awaited<ReturnType<typeof obsidian.requestUrl>>;
const response = (status: number, json: unknown) => ({ status, json }) as Response;

afterEach(() => request.mockReset());

describe("GitHub inbox requests", () => {
  it("sends three explicitly typed queries and routes their results to the right tabs", async () => {
    const expected = {
      reviews: "is:open is:pr review-requested:@me archived:false",
      assigned: "is:open is:issue assignee:@me archived:false",
      mine: "is:open is:pr author:@me archived:false",
    };
    expect(GITHUB_QUERIES).toEqual(expected);
    request.mockImplementation(async ({ url }) => {
      if (url.endsWith("/user")) return response(200, { login: "octocat" });
      const params = new URL(url).searchParams;
      expect(params.get("sort")).toBe("updated");
      expect(params.get("order")).toBe("desc");
      expect(params.get("per_page")).toBe("6");
      const tab = Object.entries(expected).find(([, query]) => query === params.get("q"))?.[0];
      expect(tab).toBeDefined();
      return response(200, { items: [{ title: tab, html_url: "https://github.com/o/r/issues/1" }] });
    });
    const inbox = await loadInbox(plugin, true);
    expect(inbox.login).toBe("octocat");
    for (const tab of ["reviews", "assigned", "mine"] as const) expect(inbox[tab][0].title).toBe(tab);
    expect(request).toHaveBeenCalledTimes(4);
    for (const [options] of request.mock.calls) {
      expect(options).toMatchObject({ throw: false, headers: {
        Authorization: "Bearer test-token", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      } });
    }
  });

  it("reports the failing Assigned query and validation detail, then allows a retry", async () => {
    request.mockImplementation(async ({ url }) => {
      if (url.endsWith("/user")) return response(200, { login: "octocat" });
      if (new URL(url).searchParams.get("q") === GITHUB_QUERIES.assigned) {
        return response(422, { message: "Validation Failed", errors: [{ message: "Search query rejected" }, { message: "Choose an issue type" }] });
      }
      return response(200, { items: [] });
    });
    await expect(loadInbox(plugin, true)).rejects.toThrow(
      /GitHub HTTP 422.*search\/issues.*assignee.*Search query rejected; Choose an issue type/,
    );
    request.mockClear();
    request.mockImplementation(async ({ url }) => response(200, url.endsWith("/user") ? { login: "octocat" } : { items: [] }));
    await expect(loadInbox(plugin)).resolves.toMatchObject({ login: "octocat", assigned: [] });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([
    [401, "GitHub 令牌无效或已过期，请重新连接"],
    [403, "GitHub 请求过于频繁或权限不足，稍后再试"],
  ])("preserves the localized guidance for HTTP %i", async (status, message) => {
    request.mockResolvedValue(response(status, { message: "API error" }));
    await expect(loadInbox(plugin, true)).rejects.toThrow(message);
  });

  it.each([
    [{ message: "Validation Failed" }, ": Validation Failed"],
    [{ message: "Validation Failed", errors: [null, "bad", { message: 42 }] }, ": Validation Failed"],
    [null, ""],
    [{}, ""],
  ])("falls back safely for error body %j", async (body, suffix) => {
    request.mockResolvedValue(response(422, body));
    await expect(loadInbox(plugin, true)).rejects.toThrow(`GitHub HTTP 422 (/user)${suffix}`);
  });

  it("preserves HTTP status when the error body is not JSON", async () => {
    request.mockResolvedValue({ status: 502, get json() { throw new SyntaxError("not JSON"); } } as Response);
    await expect(loadInbox(plugin, true)).rejects.toThrow("GitHub HTTP 502 (/user)");
  });

  it("propagates network failures", async () => {
    request.mockRejectedValue(new Error("network unavailable"));
    await expect(loadInbox(plugin, true)).rejects.toThrow("network unavailable");
  });
});
