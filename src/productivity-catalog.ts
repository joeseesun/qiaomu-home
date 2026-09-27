export const PRODUCTIVITY_MODULES = {
  "template-create": { zh: "模板速建", en: "Create from template", icon: "file-plus-2", description: "用选定的 Markdown 模板创建新笔记。", descriptionEn: "Create a note from a chosen Markdown template.", folder: true, path: true, count: false },
  "habit-checkin": { zh: "今日习惯", en: "Daily habits", icon: "circle-check", description: "每天点一下，给几个小习惯打卡，记录保存在日记里。", descriptionEn: "Tap to check off a few daily habits; records live in your daily notes.", folder: false, path: false, count: false },
  "working-set": { zh: "笔记工作集", en: "Note working set", icon: "panels-top-left", description: "保存当前打开的笔记，下次一起恢复。", descriptionEn: "Save open notes and reopen them together.", folder: false, path: false, count: false },
  "due-today": { zh: "今日到期", en: "Due today", icon: "calendar-check", description: "汇总未完成、今天到期的 Markdown 任务。", descriptionEn: "Unfinished Markdown tasks due today.", folder: true, path: false, count: true },
  "overdue": { zh: "逾期任务", en: "Overdue tasks", icon: "calendar-x", description: "找到散落在笔记中、已经过期的任务。", descriptionEn: "Find overdue tasks across your notes.", folder: true, path: false, count: true },
  "project-next": { zh: "项目下一步", en: "Project next steps", icon: "list-start", description: "每篇项目笔记的第一项未完成任务。", descriptionEn: "The first unfinished task in each project note.", folder: true, path: false, count: true },
  "milestones": { zh: "近期里程碑", en: "Upcoming milestones", icon: "flag", description: "按日期查看未来到期的任务。", descriptionEn: "Upcoming dated tasks in chronological order.", folder: true, path: false, count: true },
  "focus-timer": { zh: "专注计时", en: "Focus timer", icon: "timer", description: "开始、暂停与继续，重载后仍保留进度。", descriptionEn: "Start, pause and resume; progress survives reloads.", folder: false, path: false, count: false },
  "daily-calendar": { zh: "日记日历", en: "Daily note calendar", icon: "calendar-days", description: "回看近七天已有的日记。", descriptionEn: "Revisit existing daily notes from the last seven days.", folder: false, path: false, count: false },
  "daily-timeline": { zh: "今日时间轴", en: "Today's timeline", icon: "clock-3", description: "查看今日日记中带时间戳的记录。", descriptionEn: "Timestamped entries from today's daily note.", folder: false, path: false, count: true },
  "goal-progress": { zh: "目标进度", en: "Goal progress", icon: "chart-no-axes-combined", description: "查看指定笔记内任务的完成比例。", descriptionEn: "Track task completion in a chosen note.", folder: false, path: true, count: false },
  "note-preview": { zh: "固定笔记", en: "Pinned note preview", icon: "sticky-note", description: "把公告、周回顾或常用笔记的正文放到首页。", descriptionEn: "Preview an announcement, review or other chosen note.", folder: false, path: true, count: true },
  "tag-cloud": { zh: "常用标签", en: "Frequent tags", icon: "tags", description: "从标签直接搜索相关笔记。", descriptionEn: "Search related notes by tag.", folder: true, path: false, count: true },
  "orphan-notes": { zh: "待连接笔记", en: "Unlinked notes", icon: "file-question", description: "找出没有内部链接连接的笔记。", descriptionEn: "Notes without incoming or outgoing internal links.", folder: true, path: false, count: true },
  "broken-links": { zh: "待补全链接", en: "Unresolved links", icon: "unlink", description: "查看尚无目标笔记的链接，打开来源整理。", descriptionEn: "Open the source of links with missing targets.", folder: true, path: false, count: true },
  "saved-search": { zh: "搜索预设", en: "Saved search", icon: "search-check", description: "一键重用常用的 Obsidian 搜索条件。", descriptionEn: "Reuse a saved Obsidian search query.", folder: false, path: false, count: false },
} as const;
export type ProductivityId = keyof typeof PRODUCTIVITY_MODULES;
