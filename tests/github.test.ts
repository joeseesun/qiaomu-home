import * as obsidian from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type QiaomuHomePlugin from "../src/main";
import { loadInbox } from "../src/github";

const request = vi.spyOn(obsidian, "requestUrl");
const plugin = {
  settings: { githubSecret: "github-token" },
  app: { secretStorage: { getSecret: () => "test-token" } },
} as QiaomuHomePlugin;

afterEach(() => request.mockReset());

describe("GitHub inbox API errors", () => {
  it("shows the failing search query and GitHub's validation details", async () => {
    request.mockImplementation(async ({ url }) => ({
      status: url.endsWith("/user") ? 200 : 422,
      json: url.endsWith("/user")
        ? { login: "octocat" }
        : { message: "Validation Failed", errors: [{ message: "Search query rejected" }] },
    }) as Awaited<ReturnType<typeof obsidian.requestUrl>>);

    await expect(loadInbox(plugin, true)).rejects.toThrow(
      /GitHub HTTP 422.*search\/issues.*review-requested.*Search query rejected/,
    );
  });
});
