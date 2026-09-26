import type { App } from "obsidian";
import { KNOWN_PLUGINS, installState, localized, pluginName } from "./ecosystem";
import { isChinese, t } from "./i18n";
import { findHomeProviders, type HomeSection } from "./protocol/qiaomu-home";
import { sectionKey } from "./settings";
import { loadSections } from "./sources";

export type ModuleStatus = "ready" | "disabled" | "absent" | "unavailable";
export interface HomeModule {
  id: string;
  title: string;
  source: string;
  sourceId?: string;
  icon: string;
  description: string;
  status: ModuleStatus;
  section?: HomeSection;
  preview?: string[];
}

export function builtinModules(): HomeModule[] {
  return [
    { id:"beginner-plugins", title:isChinese()?"新手必装":"Starter plugins", source:"Home", icon:"compass", status:"ready", preview:["Calendar", "Advanced Tables", "Omnisearch"], description:isChinese()?"20 个常用插件，按用途了解，再按需安装。":"Discover 20 useful plugins and choose what fits." },
    { id: "todo", title: isChinese() ? "今日代办" : "Today’s tasks", source: "Home", icon: "list-todo", status: "ready", description: isChinese() ? "快速添加和勾选，保存在任务笔记中。" : "Add and complete tasks in a Markdown note." },
    { id: "recent", title: t("section.recent"), source: "Obsidian", icon: "history", status: "ready", description: t("library.recent") },
  ];
}

export async function pluginModules(app: App, savedSources: string[] = []): Promise<HomeModule[]> {
  const providers = new Map(findHomeProviders(app));
  const ids = [...new Set([...KNOWN_PLUGINS.map((plugin) => plugin.id), ...providers.keys(), ...savedSources])];
  const groups = await Promise.all(ids.map(async (id): Promise<HomeModule[]> => {
    const known = KNOWN_PLUGINS.find((plugin) => plugin.id === id);
    const labels: Record<string, [string, string]> = {
      "qiaomu-reader": ["继续阅读", "Continue reading"], "qiaomu-ai-rss": ["未读文章", "Unread articles"],
      "qiaomu-radio": ["最近电台", "Recent stations"], "qiaomu-agent": ["最近对话", "Recent conversations"],
    };
    const base = { id, sourceId: id, title: labels[id]?.[isChinese() ? 0 : 1] ?? pluginName(app, id),
      source: pluginName(app, id), icon: known?.icon ?? "puzzle", description: known ? localized(known.pitch) : t("library.plugin") };
    const provider = providers.get(id);
    if (!provider) {
      const state = installState(app, id);
      return [{ ...base, status: state === "enabled" ? "unavailable" : state }];
    }
    const result = await loadSections(provider);
    if (result.status === "error") return [{ ...base, status: "unavailable" }];
    if (!result.sections.length) return [{ ...base, status: "ready" }];
    return result.sections.map((section) => ({ ...base, id: sectionKey(id, section.id), title: section.title, section, status: "ready" }));
  }));
  return groups.flat();
}
