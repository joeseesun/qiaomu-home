/** Curated 2026-09-27 from the official community directory. Popularity is not a quality ranking. */
export interface BeginnerPlugin { id:string; name:string; icon:string; zh:string; en:string; audienceZh:string; audienceEn:string }
export const BEGINNER_PLUGINS: readonly BeginnerPlugin[] = [
  {id:'calendar',name:'Calendar',icon:'calendar-days',zh:'在月历上打开和新建日记。',en:'Open daily notes from a monthly calendar.',audienceZh:'适合每天记一笔',audienceEn:'Daily journaling'},
  {id:'table-editor-obsidian',name:'Advanced Tables',icon:'table-2',zh:'用 Tab 和回车编辑 Markdown 表格。',en:'Navigate Markdown tables with Tab and Enter.',audienceZh:'适合常写表格',audienceEn:'Writing tables'},
  {id:'omnisearch',name:'Omnisearch',icon:'search',zh:'用全文搜索找回记不清标题的笔记。',en:'Find notes even when you forget their titles.',audienceZh:'适合笔记越来越多时',audienceEn:'Growing vaults'},
  {id:'obsidian-tasks-plugin',name:'Tasks',icon:'list-todo',zh:'集中查看到期任务、重复任务和完成情况。',en:'Query due dates, recurring tasks and completion.',audienceZh:'适合需要跨笔记管理任务',audienceEn:'Tasks across notes'},
  {id:'obsidian-excalidraw-plugin',name:'Excalidraw',icon:'pen-tool',zh:'画手绘风示意图，并与笔记建立链接。',en:'Sketch ideas and link drawings to notes.',audienceZh:'适合视觉思考',audienceEn:'Visual thinking'},
  {id:'quickadd',name:'QuickAdd',icon:'zap',zh:'为常用的新建、追加操作设置快捷动作。',en:'Create shortcuts for capturing and creating notes.',audienceZh:'适合反复做相同记录',audienceEn:'Repeated capture workflows'},
  {id:'templater-obsidian',name:'Templater',icon:'file-code',zh:'在模板里加入日期、变量和自动化动作。',en:'Add variables and automation to templates.',audienceZh:'适合已熟悉基础模板；需配置',audienceEn:'Advanced templates; setup needed'},
  {id:'obsidian-outliner',name:'Outliner',icon:'list-tree',zh:'折叠、缩进和移动列表，让大纲更好整理。',en:'Organize nested lists with outline controls.',audienceZh:'适合大纲写作',audienceEn:'Outline-based writing'},
  {id:'obsidian-kanban',name:'Kanban',icon:'columns-3',zh:'把 Markdown 清单变成可拖动的看板。',en:'Turn Markdown lists into draggable boards.',audienceZh:'适合轻量项目管理',audienceEn:'Lightweight projects'},
  {id:'tag-wrangler',name:'Tag Wrangler',icon:'tags',zh:'集中重命名、合并和查找标签。',en:'Rename, merge and find tags.',audienceZh:'适合整理已有标签',audienceEn:'Tidying existing tags'},
  {id:'obsidian-linter',name:'Linter',icon:'align-left',zh:'统一标题、空行和笔记属性的格式。',en:'Standardize headings, spacing and properties.',audienceZh:'适合格式整理；先选好规则',audienceEn:'Formatting; choose rules first'},
  {id:'editing-toolbar',name:'Editing Toolbar',icon:'text-cursor-input',zh:'通过工具栏完成常见文字排版操作。',en:'Use toolbar buttons for common formatting.',audienceZh:'适合刚接触 Markdown',audienceEn:'New to Markdown'},
  {id:'obsidian-icon-folder',name:'Iconize',icon:'folder-heart',zh:'为文件和文件夹设置容易辨认的图标。',en:'Give files and folders recognizable icons.',audienceZh:'适合视觉分类',audienceEn:'Visual organization'},
  {id:'obsidian-style-settings',name:'Style Settings',icon:'sliders-horizontal',zh:'调整支持它的主题和插件的外观。',en:'Customize compatible themes and plugins.',audienceZh:'需要主题或插件支持',audienceEn:'Requires a compatible theme/plugin'},
  {id:'obsidian-importer',name:'Importer',icon:'folder-input',zh:'把其他笔记工具的数据转换到 Obsidian。',en:'Bring notes from other apps into Obsidian.',audienceZh:'适合从其他工具迁移',audienceEn:'Moving from another app'},
  {id:'notebook-navigator',name:'Notebook Navigator',icon:'panel-left',zh:'用文件列表、文件夹和日历浏览笔记。',en:'Browse notes with folders, lists and a calendar.',audienceZh:'适合偏爱传统笔记列表',audienceEn:'A familiar note browser'},
  {id:'dataview',name:'Dataview',icon:'database',zh:'根据笔记属性生成动态列表和表格。',en:'Build dynamic lists and tables from note metadata.',audienceZh:'进阶选项；需学习查询语法',audienceEn:'Advanced; query syntax to learn'},
  {id:'periodic-notes',name:'Periodic Notes',icon:'calendar-range',zh:'为日记、周记和月记设置独立模板。',en:'Manage daily, weekly and monthly note templates.',audienceZh:'适合定期复盘',audienceEn:'Regular reflection'},
  {id:'obsidian-spaced-repetition',name:'Spaced Repetition',icon:'brain',zh:'按间隔重复复习卡片和笔记。',en:'Review flashcards and notes with spaced repetition.',audienceZh:'适合学习和备考',audienceEn:'Study and exam preparation'},
  {id:'pdf-plus',name:'PDF++',icon:'file-text',zh:'增强 PDF 阅读、批注及笔记链接。',en:'Improve PDF annotation and links to notes.',audienceZh:'适合阅读论文和资料',audienceEn:'Papers and reference material'},
];
