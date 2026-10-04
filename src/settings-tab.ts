import { folderDropdown } from "./extra-ui";
import { FuzzySuggestModal, PluginSettingTab, Notice, SecretComponent, Setting, setIcon, type App } from "obsidian";
import { listCommands } from "./ecosystem";
import { L, LANGUAGES, setLanguage, t, type LanguagePreference } from "./i18n";
import type QiaomuHomePlugin from "./main";
import { PAGE_TEMPLATES, currentPage, type Headline, type PageTemplate, type WallpaperRotation, type WallpaperSource } from "./settings";
import { collectActions } from "./view";
import { renderLocalWallpaper } from "./wallpaper/local-settings";



const REPO = "https://github.com/joeseesun/qiaomu-home";

function unsplashError(code: string): string {
  if (!code) return "";
  if (code === "unsplash-no-key") return L("还没有填写 Access Key，暂时使用内置图库。", "No Access Key yet; using the built-in gallery.");
  if (code === "unsplash-auth") return L("Access Key 无效，暂时使用内置图库。", "The Access Key was rejected; using the built-in gallery.");
  if (code === "unsplash-empty") return L("这个关键词没有找到照片，换个词试试。", "No photos match these keywords.");
  return L("暂时连不上 Unsplash，已使用内置图库。", "Unsplash is unreachable; using the built-in gallery.");
}

class CommandPicker extends FuzzySuggestModal<{ id: string; name: string; icon?: string }> {
  constructor(app: App, private onPick: (command: { id: string; name: string; icon?: string }) => void) {
    super(app); this.modalEl.addClass("qh-ui");
    this.setPlaceholder(L("选择要放到主页的命令", "Pick a command for Home"));
  }
  getItems() { return listCommands(this.app).sort((a, b) => a.name.localeCompare(b.name)); }
  getItemText(item: { name: string }) { return item.name; }
  onChooseItem(item: { id: string; name: string; icon?: string }) { this.onPick(item); }
}

function iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, disabled = false): void {
  const button = parent.createEl("button", { cls: "clickable-icon qh-setting-icon" });
  setIcon(button, icon);
  button.createSpan({ cls: "qh-sr-only", text: label });
  button.disabled = disabled;
  button.addEventListener("click", onClick);
}

import { addPresetPage, removePage } from "./pages";
import { NewPageModal, DeletePageModal } from "./page-dialogs";
import { renderTodoPreferences } from "./todo-ui";

type SettingsSection = "home" | "appearance" | "capture" | "about";
export class HomeSettingTab extends PluginSettingTab {
  private localWallpaperRefresh: (() => void) | null = null;
  refreshWallpaper(): void { this.localWallpaperRefresh?.(); }
  hide(): void { this.localWallpaperRefresh = null; }
  private activeSection: SettingsSection = "home";
  private readonly instance = `qh-settings-${crypto.randomUUID()}`;
  constructor(app: App, private plugin: QiaomuHomePlugin) { super(app, plugin); }
  private async save(rerender = true): Promise<void> {
    try { await this.plugin.saveSettings({rerender}); }
    catch { new Notice(L("设置保存失败，请重试。", "Could not save settings. Try again.")); }
  }
  display(): void { this.renderSettings(); }
  private renderSettings(): void {
    this.localWallpaperRefresh = null;
    const root=this.containerEl;
    root.empty();root.addClass("qh-settings", "qh-ui");
    const header=root.createDiv({cls:"qh-settings-header"});
    const identity=header.createDiv({cls:"qh-settings-identity"});
    setIcon(identity.createSpan({attr:{"aria-hidden":"true"}}),"tree-deciduous");
    new Setting(identity).setName(L("乔木 Home", "Qiaomu Home")).setHeading();
    const nav=header.createDiv({cls:"qh-settings-tabs",attr:{role:"tablist"}});
    const navLabel=nav.createSpan({cls:"qh-sr-only",text:L("设置分类", "Settings sections")});navLabel.id=`${this.instance}-label`;nav.setAttr("aria-labelledby",navLabel.id);
    const sections: {id:SettingsSection; label:string}[]=[{id:"home",label:L("主页", "Home")},{id:"appearance",label:L("外观", "Appearance")},{id:"capture",label:L("记录", "Capture")},{id:"about",label:L("关于", "About")}];
    const select=(id:SettingsSection)=>{this.activeSection=id;this.renderSettings();this.containerEl.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();};
    sections.forEach((section,index)=>{
      const selected=section.id===this.activeSection;
      const button=nav.createEl("button",{text:section.label,cls:"qh-settings-tab",attr:{type:"button",role:"tab","aria-selected":String(selected),"aria-controls":`${this.instance}-panel`,id:`${this.instance}-${section.id}`}});
      button.tabIndex=selected?0:-1;
      button.addEventListener("click",()=>select(section.id));
      button.addEventListener("keydown",event=>{
        let next:number;
        if(event.key==="ArrowRight")next=(index+1)%sections.length;else if(event.key==="ArrowLeft")next=(index+sections.length-1)%sections.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=sections.length-1;else return;
        event.preventDefault();select(sections[next].id);
      });
    });
    const body=root.createDiv({cls:"qh-settings-body",attr:{role:"tabpanel",id:`${this.instance}-panel`,"aria-labelledby":`${this.instance}-${this.activeSection}`}});
    if(this.activeSection==="home")this.renderHome(body);
    if(this.activeSection==="appearance")this.renderAppearance(body);
    if(this.activeSection==="capture")this.renderCapture(body);
    if(this.activeSection==="about")this.renderAbout(body);
  }
  private async arrange(pageId: string): Promise<void> {
    const setting=(this.app as unknown as {setting?:{close?():void}}).setting;
    setting?.close?.();(await this.plugin.openHome())?.editLayout(pageId);
  }
  private renderHome(containerEl: HTMLElement): void {
    const settings=this.plugin.settings, save=(rerender=true)=>this.save(rerender);
    new Setting(containerEl).setName(L("打开方式", "Opening")).setHeading();
    new Setting(containerEl)
      .setName(L("启动时打开主页", "Open on startup"))
      .setDesc(L("每次启动 Obsidian，都从主页开始。", "Start every Obsidian session on Home."))
      .addToggle((toggle) => toggle.setValue(settings.openOnStartup).onChange(async (value) => { settings.openOnStartup = value; await save(false); }));
    new Setting(containerEl)
      .setName(L("新标签页显示主页", "Show Home in new tabs"))
      .setDesc(L("代替 Obsidian 的空白新标签页。", "Replace Obsidian's empty new tab."))
      .addToggle((toggle) => toggle.setValue(settings.replaceNewTab).onChange(async (value) => { settings.replaceNewTab = value; await save(false); }));

    new Setting(containerEl).setName(L("页签与内容", "Pages and content")).setHeading();
    new Setting(containerEl).setName(L("显示页签", "Show pages")).setDesc(L("关闭后只显示主页，其他页签保留。", "When off, show Home and keep the other pages saved."))
      .addToggle(toggle=>toggle.setValue(settings.tabsEnabled).onChange(async value=>{settings.tabsEnabled=value;await save();}));
    const list=containerEl.createDiv({cls:"qh-settings-page-list"});
    for(const page of settings.pages){
      const row=new Setting(list).setName(page.name||t("pages.default"));
      if(page.id===settings.homePageId)row.setDesc(L("默认主页 · 不可删除", "Default Home · cannot be deleted"));
      row.addButton(button=>button.setButtonText(L("布置", "Customize")).onClick(()=>this.arrange(page.id)));
      iconButton(row.controlEl,"pencil",t("pages.rename"),()=>new NewPageModal(this.app,async name=>{const target=settings.pages.find(p=>p.id===page.id);if(target)target.name=name;await save();this.renderSettings();},page.name||t("pages.default"),t("pages.rename")).open());
      iconButton(row.controlEl,"trash-2",t("pages.delete"),()=>new DeletePageModal(this.app,page.name||t("pages.default"),async()=>{removePage(settings,page.id);await save();this.renderSettings();}).open(),page.id===settings.homePageId);
    }
    const preset=new Setting(containerEl).setName(L("添加预设页签", "Add a preset page")).setDesc(L("现有内容保持不变。新页签可改名、删除或重新布置。", "Keeps existing content. New preset pages can be renamed, removed or customized."));
    preset.addDropdown(dropdown=>{dropdown.addOption("",L("选择模板…", "Choose a template…"));for(const [kind,item] of Object.entries(PAGE_TEMPLATES))dropdown.addOption(kind,`${L(item.zh, item.en)} · ${L(item.descZh, item.descEn)}`);dropdown.onChange(async value=>{if(!value)return;dropdown.setDisabled(true);addPresetPage(settings,value as PageTemplate);await save();this.renderSettings();});});
    const page=currentPage(settings);
    new Setting(containerEl).setName(L("当前页显示插件推荐", "Show plugin suggestions on current page")).setDesc(page.name||t("pages.default"))
      .addToggle(toggle=>toggle.setValue(page.showRecommendations).onChange(async value=>{page.showRecommendations=value;await save();}));
    if(settings.hiddenRecommendations.length)new Setting(containerEl).setName(L("已隐藏的推荐", "Hidden suggestions")).addButton(button=>button.setButtonText(L("恢复", "Restore")).onClick(async()=>{settings.hiddenRecommendations=[];await save();this.renderSettings();}));
    const details=containerEl.createEl("details",{cls:"qh-settings-details"});
    details.createEl("summary",{text:L("新建菜单与命令", "Create menu and commands")});
    this.renderActions(details.createDiv());
  }
  private renderAppearance(containerEl: HTMLElement): void {
    const settings=this.plugin.settings,wall=settings.wallpaper,save=(rerender=true)=>this.save(rerender);
    new Setting(containerEl).setName(L("外观", "Appearance")).setHeading();
    const languageName = L("界面语言", "Language");
    new Setting(containerEl)
      // Always carry the English word so someone stuck in an unfamiliar language can find this row.
      .setName(languageName === "Language" ? languageName : `${languageName} · Language`)
      .setDesc(L("主页、卡片和设置使用的语言。命令面板里的命令名在重新加载插件后更新。", "Used by Home, its cards and these settings. Command names update after the plugin reloads."))
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", L("跟随 Obsidian", "Follow Obsidian"));
        for (const language of LANGUAGES) dropdown.addOption(language.id, language.name);
        dropdown.setValue(settings.language).onChange(async (value) => {
          settings.language = value as LanguagePreference;
          setLanguage(settings.language);
          await save();
          this.renderSettings();
        });
      });
    new Setting(containerEl)
      .setName(L("顶部显示", "Headline"))
      .addDropdown((dropdown) => dropdown
        .addOptions({ clock: L("时间与问候", "Time and greeting"), custom: L("自定义文本", "Custom text") })
        .setValue(settings.headline)
        .onChange(async (value) => { settings.headline = value as Headline; await save(); this.renderSettings(); }));
    if (settings.headline === "custom") new Setting(containerEl)
      .setName(L("自定义文本", "Custom text"))
      .setDesc(L("留空显示时间与问候。", "Leave blank to show time and greeting."))
      .addText(input => {
        input.inputEl.maxLength = 120;
        input.setValue(settings.customHeadline).setPlaceholder(L("今天，也做一点喜欢的事", "Make time for what matters"))
          .onChange(async value => {
            settings.customHeadline = value.slice(0,120);
            await save(false);
            this.plugin.eachView(view=>view.refreshHeadline());
          });
      });
    new Setting(containerEl)
      .setName(L("壁纸", "Wallpaper"))
      .addDropdown((dropdown) => dropdown
        .addOptions({
          curated: L("Unsplash 精选（内置）", "Unsplash picks (built in)"),
          unsplash: L("Unsplash 搜索（需要 Access Key）", "Unsplash search (Access Key)"),
          local: L("库中的图片", "Image from this vault"),
          none: L("不使用壁纸", "No wallpaper"),
        })
        .setValue(wall.source)
        .onChange(async (value) => {
          wall.source = value as WallpaperSource;
          await save(false);
          await this.plugin.wallpaper.prepareForView();
          this.plugin.eachView((view) => void view.renderPhoto());
          this.renderSettings();
        }));

    if (wall.source === "unsplash") {
      new Setting(containerEl)
        .setName("Unsplash Access Key")
        .setDesc(createFragment((fragment) => {
          fragment.appendText(L("在 Unsplash 开发者页面免费创建应用后获得。密钥保存在 Obsidian 的密钥库中。", "Create a free app on the Unsplash developer site. The key is kept in Obsidian's secret storage."));
          fragment.createEl("br");
          fragment.createEl("a", { text: "unsplash.com/developers", href: "https://unsplash.com/developers" });
        }))
        .addComponent((el) => new SecretComponent(this.app, el).setValue(wall.unsplashSecret).onChange(async (value) => {
          wall.unsplashSecret = value;
          await save(false);
        }));
      new Setting(containerEl)
        .setName(L("关键词", "Keywords"))
        .setDesc(L("例如：mountain、ocean night、minimal。", "For example: mountain, ocean night, minimal."))
        .addText((text) => text.setValue(wall.query).onChange(async (value) => { wall.query = value; await save(false); }));
      const status = unsplashError(this.plugin.wallpaper.error());
      if (status) containerEl.createDiv({ cls: "setting-item-description qh-setting-status", text: status });
    }

    if (wall.source === "local") {
      this.localWallpaperRefresh = renderLocalWallpaper(containerEl, this.plugin, () => this.renderSettings());
    }

    if (wall.source !== "local" && this.plugin.wallpaper.canRotate()) {
      new Setting(containerEl)
        .setName(L("更换频率", "Change"))
        .addDropdown((dropdown) => dropdown
          .addOptions({ daily: L("每天一张", "Once a day"), open: L("每次打开", "Every time Home opens"), fixed: L("手动更换", "Only when I ask") })
          .setValue(wall.rotation)
          .onChange(async (value) => { wall.rotation = value as WallpaperRotation; await save(false); }));
    }
    if (wall.source !== "none") {
      new Setting(containerEl)
        .setName(L("壁纸暗度", "Dim wallpaper"))
        .setDesc(L("让文字在明亮照片上也清楚。", "Keeps text readable on bright photos."))
        .addSlider((slider) => slider.setLimits(0, 80, 5).setValue(Math.round(wall.dim * 100))
          .onChange(async (value) => {
            wall.dim = value / 100;
            this.plugin.eachView((view) => view.containerEl.style.setProperty("--qh-dim", String(wall.dim)));
            await save(false);
          }));
    }

  }
  private renderCapture(containerEl: HTMLElement): void {
    const settings=this.plugin.settings,save=(rerender=true)=>this.save(rerender);
    new Setting(containerEl).setName(L("快速记录", "Quick capture")).setHeading();
    new Setting(containerEl)
      .setName(L("快速记录保存到", "Quick capture destination"))
      .setDesc(L("设置快速记录卡片的保存位置；搜索框 ⇧↵ 始终记录到今日日记。", "Choose the Quick capture card destination. Shift+Enter in search always saves to today’s daily note."))
      .addDropdown((dropdown) => dropdown
        .addOptions({ daily: L("今日日记", "Today's daily note"), inbox: "Inbox" })
        .setValue(settings.captureTarget)
        .onChange(async (value) => { settings.captureTarget = value as "daily" | "inbox"; await save(); this.renderSettings(); }));
    if (settings.captureTarget === "inbox") {
      new Setting(containerEl)
        .setName(L("Inbox 笔记路径", "Inbox note path"))
        .setDesc(L("库内 Markdown 路径，例如 Inbox.md 或 Inbox/速记.md。", "Vault Markdown path, for example Inbox.md."))
        .addText((input) => input.setValue(settings.captureInboxPath).onChange(async (value) => {
          settings.captureInboxPath = value.trim(); await save(false);
        }));
    }
    new Setting(containerEl).setName(L("记录格式", "Line format"))
      .addDropdown(dropdown => dropdown.addOptions({ plain: L("普通列表 - 内容", "List item - text"), time: L("带时间 - 14:30 内容", "With time - 14:30 text"), task: L("待办 - [ ] 内容", "Task - [ ] text") })
        .setValue(settings.captureFormat).onChange(async value => { settings.captureFormat = value as "plain" | "time" | "task"; await save(false); }));
    new Setting(containerEl).setName(L("新笔记位置", "Where new notes go")).setHeading();
    folderDropdown(containerEl,this.plugin,L("Home 新建的笔记", "Notes created by Home"),L("Obsidian 默认新笔记位置", "Obsidian's new-note location"),settings.createFolder,value=>{settings.createFolder=value;void save(false);})
      .setDesc(createFragment(f=>{f.createDiv({text:L("视频笔记、本周回顾和模板速建默认放在这里；卡片设置里可单独指定。", "Video notes, weekly reviews and template notes go here unless a card chooses its own folder.")});}));
    new Setting(containerEl).setName(L("打开笔记", "Opening notes")).setHeading();
    new Setting(containerEl).setName(L("从卡片打开笔记时用新标签页", "Open notes from cards in a new tab"))
      .setDesc(L("关闭时在主页所在的标签页打开，像浏览器起始页；⌘/Ctrl 点击或中键点击总是新标签页。", "Off: open in Home's own tab, like a browser start page. ⌘/Ctrl-click or middle-click always opens a new tab."))
      .addToggle(toggle=>toggle.setValue(settings.openInNewTab).onChange(async value=>{settings.openInNewTab=value;await save(false);}));
    new Setting(containerEl).setName(L("今日待办", "Today’s tasks")).setHeading();
    renderTodoPreferences(containerEl,this.plugin,()=>this.renderSettings());
  }
  private renderAbout(containerEl: HTMLElement): void {
    const release=containerEl.createDiv({cls:"qh-settings-release"});
    release.createSpan({text:L("当前版本", "Current version")});release.createEl("strong",{text:`v${this.plugin.manifest.version}`});
    const links=containerEl.createDiv({cls:"qh-settings-links"});
    for(const [icon,label,url] of [["history",L("更新日志", "Changelog"),`${REPO}/releases`],["bug",L("反馈问题", "Report an issue"),`${REPO}/issues/new`],["book-open",L("使用说明", "Help"),`${REPO}#readme`]]){
      const link=links.createEl("a",{href:url,attr:{target:"_blank",rel:"noopener noreferrer"}});setIcon(link.createSpan({attr:{"aria-hidden":"true"}}),icon);link.createSpan({text:label});
    }
    new Setting(containerEl).setName(L("插件接入", "Plugin integration")).setDesc(createFragment(f=>{f.createEl("a",{text:L("乔木 Home 协议", "Qiaomu Home protocol"),href:`${REPO}/blob/main/docs/qiaomu-home-protocol.md`});}));
    const support = containerEl.createDiv({cls:"qh-settings-support"});
    for (const [icon, title, caption, url] of [
      ["newspaper", L("关注公众号", "Follow Qiaomu"), L("微信搜索「向阳乔木推荐看」", "WeChat: 向阳乔木推荐看"), "https://radio.qiaomu.ai/assets/qiaomu_wechat_public_account_qr.jpg"],
      ["coffee", L("请我喝杯咖啡", "Buy me a coffee"), L("微信扫码，支持持续更新", "Scan in WeChat to support development"), "https://radio.qiaomu.ai/assets/qiaomu_reward_qr.png"],
    ]) {
      const card = support.createDiv({cls:"qh-settings-support-card"});
      const heading = card.createDiv({cls:"qh-settings-support-heading"});
      setIcon(heading.createSpan({attr:{"aria-hidden":"true"}}),icon);
      heading.createSpan({text:title});
      const image = card.createEl("img",{attr:{src:url,alt:title,loading:"lazy",width:"148",height:"148",referrerpolicy:"no-referrer"}});
      image.addEventListener("error",()=>{image.hidden=true;card.createEl("a",{text:L("打开二维码", "Open QR code"),href:url,attr:{target:"_blank",rel:"noopener noreferrer"}});},{once:true});
      card.createDiv({cls:"setting-item-description",text:caption});
    }
    const footer=containerEl.createDiv({cls:"qh-settings-footer"});footer.createEl("a",{text:"GitHub",href:REPO});footer.createSpan({text:" · "});footer.createEl("a",{text:"qiaomu.ai",href:"https://qiaomu.ai/"});
  }
  private renderActions(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName(L("新建", "Create")).setHeading();
    containerEl.createDiv({ cls: "setting-item-description qh-setting-note", text: L("下面是「新笔记」旁 ▾ 菜单里的项目，可排序、隐藏。", "Items in the ▾ menu next to “New note”. Reorder or hide them.") });
    const actions = collectActions(this.app, settings);
    const keys = actions.map((action) => action.key);
    const move = async (index: number, delta: number) => {
      const order = [...keys];
      const [item] = order.splice(index, 1);
      order.splice(index + delta, 0, item);
      settings.actions = order;
      await this.plugin.saveSettings();
      this.renderSettings();
    };
    actions.forEach((action, index) => {
      const setting = new Setting(containerEl);
      setIcon(setting.nameEl.createSpan({ cls: "qh-setting-action-icon" }), action.icon);
      setting.nameEl.appendText(action.label);
      const controls = setting.controlEl;
      iconButton(controls, "arrow-up", L("上移", "Move up"), () => void move(index, -1), index === 0);
      iconButton(controls, "arrow-down", L("下移", "Move down"), () => void move(index, 1), index === actions.length - 1);
      if (action.key.startsWith("command:")) {
        iconButton(controls, "trash-2", L("移除", "Remove"), () => {
          const id = action.key.slice("command:".length);
          settings.commands = settings.commands.filter((command) => command.id !== id);
          settings.actions = settings.actions.filter((key) => key !== action.key);
          void this.plugin.saveSettings().then(() => this.renderSettings());
        });
      }
      setting.addToggle((toggle) => toggle.setValue(!settings.hiddenActions.includes(action.key)).onChange(async (visible) => {
        settings.hiddenActions = visible ? settings.hiddenActions.filter((key) => key !== action.key) : [...settings.hiddenActions, action.key];
        await this.plugin.saveSettings();
      }));
    });
    new Setting(containerEl)
      .setName(L("添加命令", "Add a command"))
      .setDesc(L("把任意 Obsidian 命令放到主页。", "Put any Obsidian command on Home."))
      .addButton((button) => button.setButtonText(L("选择命令", "Choose")).onClick(() => {
        new CommandPicker(this.app, (command) => {
          if (settings.commands.some((item) => item.id === command.id)) return;
          const label = command.name.includes(": ") ? command.name.slice(command.name.indexOf(": ") + 2) : command.name;
          settings.commands = [...settings.commands, { id: command.id, label: label.slice(0, 24), icon: command.icon ?? "terminal-square" }];
          settings.actions = [...keys, `command:${command.id}`];
          void this.plugin.saveSettings().then(() => this.renderSettings());
        }).open();
      }));
  }
}
