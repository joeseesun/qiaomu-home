/** Cards powered by popular community plugins. Home never installs anything: without the plugin the card explains and links to it. */
export const INTEGRATIONS = {
  "quickadd-actions": { plugin: "quickadd", pluginName: "QuickAdd", zh: "QuickAdd 动作", en: "QuickAdd actions", icon: "zap", repo: "https://github.com/chhoumann/quickadd",
    description: "一键运行你在 QuickAdd 里配置的模板、捕获和宏。", descriptionEn: "Run your QuickAdd templates, captures and macros in one click." },
  "dataview-query": { plugin: "dataview", pluginName: "Dataview", zh: "Dataview 卡片", en: "Dataview card", icon: "database", repo: "https://github.com/blacksmithgu/obsidian-dataview",
    description: "把一个标签或文件夹变成笔记、属性或任务卡片。", descriptionEn: "Turn a tag or folder into a notes, properties or tasks card." },
  "kanban-boards": { plugin: "obsidian-kanban", pluginName: "Kanban", zh: "看板", en: "Kanban boards", icon: "columns-3", repo: "https://github.com/mgmeyers/obsidian-kanban",
    description: "最近的看板和每列卡片数，一键新建看板。", descriptionEn: "Recent boards with card counts; create a new board." },
  "excalidraw-drawings": { plugin: "obsidian-excalidraw-plugin", pluginName: "Excalidraw", zh: "手绘白板", en: "Excalidraw drawings", icon: "pen-tool", repo: "https://github.com/zsviczian/obsidian-excalidraw-plugin",
    description: "继续最近的 Excalidraw 绘图，或开一张新画布。", descriptionEn: "Continue recent drawings or start a new canvas." },
  "spaced-review": { plugin: "obsidian-spaced-repetition", pluginName: "Spaced Repetition", zh: "间隔复习", en: "Spaced repetition", icon: "brain", repo: "https://github.com/st3v3nmw/obsidian-spaced-repetition",
    description: "从首页开始今天的卡片或笔记复习。", descriptionEn: "Start today's flashcard or note review from Home." },
  "omnisearch": { plugin: "omnisearch", pluginName: "Omnisearch", zh: "全文搜索", en: "Full-text search", icon: "text-search", repo: "https://github.com/scambier/obsidian-omnisearch",
    description: "按正文内容搜索笔记，记不清标题也能找到。", descriptionEn: "Search note contents, even when you forget the title." },
} as const;
export type IntegrationId = keyof typeof INTEGRATIONS;
export function isIntegration(id: string): id is IntegrationId { return Object.hasOwn(INTEGRATIONS, id); }

