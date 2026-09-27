import { Modal, Notice, requestUrl, SecretComponent, Setting, setIcon } from "obsidian";
import type QiaomuHomePlugin from "./main";
import { cardAction } from "./card-ui";
import { isChinese, t } from "./i18n";

const L = (zh: string, en: string) => isChinese() ? zh : en;

/**
 * OAuth App client id for GitHub's device flow. Device flow needs no client secret, so the id is safe to ship.
 * Empty until a Qiaomu Home OAuth App is registered; the token option works without it.
 */
export const GITHUB_CLIENT_ID = "";
const SECRET_ID = "qiaomu-home-github";

export interface GithubItem { title: string; url: string; repo: string; number: number; updated: string; pull: boolean }
export interface GithubInbox { login: string; reviews: GithubItem[]; assigned: GithubItem[]; mine: GithubItem[] }

export function parseSearch(json: unknown): GithubItem[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap(raw => {
    const item = raw as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.html_url !== "string" || !/^https:\/\/github\.com\//.test(item.html_url)) return [];
    const repo = typeof item.repository_url === "string" ? item.repository_url.replace(/^https:\/\/api\.github\.com\/repos\//, "") : "";
    return [{ title: item.title.slice(0, 200), url: item.html_url, repo, number: typeof item.number === "number" ? item.number : 0,
      updated: typeof item.updated_at === "string" ? item.updated_at : "", pull: Boolean(item.pull_request) }];
  });
}

export const GITHUB_QUERIES = {
  reviews: "is:open is:pr review-requested:@me archived:false",
  assigned: "is:open is:issue assignee:@me archived:false",
  mine: "is:open is:pr author:@me archived:false",
} as const;

function token(plugin: QiaomuHomePlugin): string {
  const id = plugin.settings.githubSecret;
  if (!id) return "";
  try { return plugin.app.secretStorage.getSecret(id) ?? ""; } catch { return ""; }
}
export function githubConnected(plugin: QiaomuHomePlugin): boolean { return Boolean(token(plugin)); }

const cache = new Map<string, { at: number; value: Promise<GithubInbox> }>();
async function api(path: string, auth: string): Promise<unknown> {
  const response = await requestUrl({ url: `https://api.github.com${path}`, throw: false,
    headers: { Authorization: `Bearer ${auth}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (response.status === 401) throw new Error(L("GitHub 令牌无效或已过期，请重新连接", "GitHub token is invalid or expired; reconnect"));
  if (response.status === 403) throw new Error(L("GitHub 请求过于频繁或权限不足，稍后再试", "GitHub rate limit or missing permission; try later"));
  if (response.status < 200 || response.status >= 300) {
    const body = response.json as { message?: unknown; errors?: unknown };
    const details = Array.isArray(body?.errors)
      ? body.errors.map(error => error && typeof error === "object" ? (error as { message?: unknown }).message : undefined)
        .filter((message): message is string => typeof message === "string").join("; ")
      : "";
    const message = details || (typeof body?.message === "string" ? body.message : "");
    throw new Error(`GitHub HTTP ${response.status} (${path})${message ? `: ${message}` : ""}`);
  }
  return response.json;
}
/** At most one request set per five minutes, shared by every Home tab. */
export function loadInbox(plugin: QiaomuHomePlugin, force = false): Promise<GithubInbox> {
  const auth = token(plugin);
  if (!auth) return Promise.reject(new Error("not connected"));
  const hit = cache.get(auth);
  if (!force && hit && Date.now() - hit.at < 5 * 60000) return hit.value;
  const search = (query: string) => api(`/search/issues?${new URLSearchParams({ q: query, sort: "updated", order: "desc", per_page: "6" }).toString()}`, auth).then(parseSearch);
  const value = Promise.all([api("/user", auth), search(GITHUB_QUERIES.reviews), search(GITHUB_QUERIES.assigned), search(GITHUB_QUERIES.mine)])
    .then(([user, reviews, assigned, mine]) => ({ login: typeof (user as { login?: unknown }).login === "string" ? (user as { login: string }).login : "", reviews, assigned, mine }));
  cache.set(auth, { at: Date.now(), value });
  value.catch(() => { if (cache.get(auth)?.value === value) cache.delete(auth); });
  return value;
}

/** Live lists for the GitHub card. Links below the lists stay available whether or not the user connects. */
export function renderGithubInbox(card: HTMLElement, plugin: QiaomuHomePlugin, limit: number): void {
  const box = card.createDiv({ cls: "qh-github" });
  if (!githubConnected(plugin)) {
    const invite = box.createDiv({ cls: "qh-plugin-guide" });
    invite.createDiv({ cls: "qh-plugin-guide-pitch", text: L("连接 GitHub 后，这里直接列出待你审阅的 PR、分配给你的 Issue 和你的 PR。", "Connect GitHub to list review requests, assigned issues and your pull requests here.") });
    cardAction(invite, L("连接 GitHub", "Connect GitHub"), () => new GithubConnectModal(plugin).open(), "github", true);
    return;
  }
  const tabs = box.createDiv({ cls: "qh-segment" });
  tabs.setAttr("role", "tablist");
  const list = box.createDiv({ cls: "qh-native-preview" });
  list.createDiv({ cls: "qh-card-empty", text: L("正在读取 GitHub…", "Loading GitHub…") });
  const footer = box.createDiv({ cls: "qh-github-foot" });
  let active: keyof typeof GITHUB_QUERIES = "reviews";
  const paint = (inbox: GithubInbox) => {
    tabs.empty(); list.empty(); footer.empty();
    const labels: Record<keyof typeof GITHUB_QUERIES, string> = { reviews: L("待我审阅", "Reviews"), assigned: L("分配给我", "Assigned"), mine: L("我的 PR", "My PRs") };
    for (const key of Object.keys(labels) as Array<keyof typeof GITHUB_QUERIES>) {
      const tab = tabs.createEl("button", { cls: "qh-segment-item" });
      tab.setAttr("role", "tab"); tab.setAttr("aria-selected", String(key === active));
      tab.createSpan({ text: labels[key] });
      tab.createSpan({ cls: "qh-chip-count", text: String(inbox[key].length) });
      tab.addEventListener("click", () => { active = key; paint(inbox); tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); });
    }
    const items = inbox[active].slice(0, limit);
    if (!items.length) list.createDiv({ cls: "qh-card-empty", text: L("这里是空的，干得漂亮", "All clear") });
    for (const item of items) {
      const row = list.createEl("button", { cls: "qh-list-row" });
      setIcon(row.createSpan({ cls: "qh-list-row-icon" }), item.pull ? "git-pull-request" : "circle-dot");
      const text = row.createSpan({ cls: "qh-list-row-text" });
      text.createSpan({ cls: "qh-workflow-title", text: item.title });
      text.createSpan({ cls: "qh-item-sub", text: `${item.repo}#${item.number}` });
      row.addEventListener("click", () => window.open(item.url, "_blank", "noopener,noreferrer"));
    }
    footer.createSpan({ cls: "qh-native-scope", text: inbox.login ? `@${inbox.login}` : "" });
    cardAction(footer, L("刷新", "Refresh"), () => { list.empty(); list.createDiv({ cls: "qh-card-empty", text: L("正在刷新…", "Refreshing…") }); void loadInbox(plugin, true).then(value => { if (card.isConnected) paint(value); }).catch(fail); }, "refresh-cw");
  };
  const fail = (error: unknown) => {
    if (!card.isConnected) return;
    list.empty();
    list.createDiv({ cls: "qh-card-empty", text: error instanceof Error ? error.message : String(error) });
    cardAction(list, L("重新连接", "Reconnect"), () => new GithubConnectModal(plugin).open(), "github");
  };
  void loadInbox(plugin).then(inbox => { if (card.isConnected) paint(inbox); }).catch(fail);
}

interface DeviceCode { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }

export class GithubConnectModal extends Modal {
  private cancelled = false;
  constructor(private plugin: QiaomuHomePlugin) { super(plugin.app); this.modalEl.addClass("qh-ui"); }

  onOpen(): void {
    this.setTitle(L("连接 GitHub", "Connect GitHub"));
    const settings = this.plugin.settings;
    this.contentEl.createEl("p", { cls: "qh-options-about", text: L("Home 只读取你的 PR 和 Issue 列表，令牌保存在 Obsidian 的密钥库，不写入笔记或插件数据。", "Home only reads your pull request and issue lists. The token is kept in Obsidian's secret storage, never in notes or plugin data.") });
    if (GITHUB_CLIENT_ID) {
      new Setting(this.contentEl).setName(L("用 GitHub 账号登录", "Sign in with GitHub")).setDesc(L("推荐。浏览器里输入一次验证码即可。", "Recommended. Enter a one-time code in your browser."))
        .addButton(button => button.setButtonText(L("登录", "Sign in")).setCta().onClick(() => void this.deviceFlow(button.buttonEl)));
    }
    new Setting(this.contentEl).setName(L("使用个人访问令牌", "Use a personal access token"))
      .setDesc(createFragment(fragment => {
        fragment.appendText(L("选择或新建一个保存令牌的密钥。", "Choose or create the secret that holds your token. "));
        const link = fragment.createEl("a", { text: L("创建令牌（只需 repo 读取权限）", "Create a token (read access to repos)"), href: "https://github.com/settings/personal-access-tokens/new" });
        link.setAttr("target", "_blank");
      }))
      .addComponent(el => new SecretComponent(this.app, el).setValue(settings.githubSecret).onChange(async value => {
        settings.githubSecret = value; cache.clear();
        await this.plugin.saveSettings();
      }));
    if (settings.githubSecret) new Setting(this.contentEl).setName(L("断开连接", "Disconnect")).setDesc(L("只移除 Home 对该密钥的引用。", "Removes Home's reference to the secret."))
      .addButton(button => (button.buttonEl.addClass("mod-warning"), button).setButtonText(L("断开", "Disconnect")).onClick(async () => {
        settings.githubSecret = ""; cache.clear();
        try { await this.plugin.saveSettings(); this.close(); } catch { new Notice(t("layout.saveFailed")); }
      }));
  }

  private async deviceFlow(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const status = this.contentEl.createDiv({ cls: "qh-device-code" });
    try {
      const form = (data: Record<string, string>) => new URLSearchParams(data).toString();
      const start = await requestUrl({ url: "https://github.com/login/device/code", method: "POST", contentType: "application/x-www-form-urlencoded", headers: { Accept: "application/json" },
        body: form({ client_id: GITHUB_CLIENT_ID, scope: "repo read:user" }), throw: false });
      const code = start.json as DeviceCode;
      if (!code?.device_code) throw new Error(L("无法开始登录", "Could not start sign-in"));
      status.createDiv({ text: L("在打开的页面输入这个验证码：", "Enter this code on the page that opens:") });
      const value = status.createEl("button", { cls: "qh-device-code-value", text: code.user_code });
      value.addEventListener("click", () => void navigator.clipboard.writeText(code.user_code).then(() => new Notice(L("已复制验证码", "Code copied"))));
      await navigator.clipboard.writeText(code.user_code).catch(() => {});
      window.open(code.verification_uri, "_blank", "noopener,noreferrer");
      let interval = Math.max(5, code.interval) * 1000;
      const deadline = Date.now() + code.expires_in * 1000;
      while (!this.cancelled && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, interval));
        const poll = await requestUrl({ url: "https://github.com/login/oauth/access_token", method: "POST", contentType: "application/x-www-form-urlencoded", headers: { Accept: "application/json" },
          body: form({ client_id: GITHUB_CLIENT_ID, device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }), throw: false });
        const result = poll.json as { access_token?: string; error?: string };
        if (result.access_token) {
          this.app.secretStorage.setSecret(SECRET_ID, result.access_token);
          this.plugin.settings.githubSecret = SECRET_ID; cache.clear();
          await this.plugin.saveSettings();
          new Notice(L("已连接 GitHub", "GitHub connected"));
          this.close(); return;
        }
        if (result.error === "slow_down") interval += 5000;
        else if (result.error && result.error !== "authorization_pending") throw new Error(result.error === "access_denied" ? L("已取消授权", "Authorization cancelled") : result.error);
      }
      if (!this.cancelled) throw new Error(L("验证码已过期，请重试", "The code expired; try again"));
    } catch (error) {
      status.setText(error instanceof Error ? error.message : String(error));
      button.disabled = false;
    }
  }

  onClose(): void { this.cancelled = true; this.contentEl.empty(); }
}
