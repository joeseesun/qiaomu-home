import { todoTarget, ensureTodoFile, pendingCarry, carrySelected, type CarryGroup } from "./todo-carry";
import { underHeading, todayFirst } from "./todo-data";
import { commandExists } from "./ecosystem";
import { editorFor, update } from "./todo-files";
import { Modal, Notice, Setting, SuggestModal, TFile, setIcon } from 'obsidian';
import type QiaomuHomePlugin from './main';
import { isChinese } from './i18n';
import { appendTodo, completeTodo, readTodos } from './todo-data';
const drafts = new WeakMap<QiaomuHomePlugin, Map<string, string>>();
const L = (zh: string, en: string) => isChinese() ? zh : en;
class TodoPicker extends SuggestModal<TFile> {
  constructor(private plugin: QiaomuHomePlugin, private changed:()=>void = ()=>{}, private switchToFixed = true) { super(plugin.app); this.modalEl.addClass("qh-ui"); this.setPlaceholder(L('选择任务笔记', 'Choose task note')); }
  getSuggestions(query: string): TFile[] { return this.app.vault.getMarkdownFiles().filter(f => f.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 50); }
  renderSuggestion(file: TFile, el: HTMLElement): void { el.setText(file.path); }
  onChooseSuggestion(file: TFile): void {
    this.plugin.settings.todoPath = file.path;
    if(this.switchToFixed)this.plugin.settings.todoDaily = false;
    void this.plugin.saveSettings().then(()=>this.changed()).catch(() => new Notice(L('保存失败，请重试', 'Could not save. Try again.')));
  }
}
export function renderTodoPreferences(container: HTMLElement, plugin: QiaomuHomePlugin, changed:()=>void = ()=>{}): void {
  const save=()=>{void plugin.saveSettings().then(changed).catch(()=>new Notice(L('保存失败','Save failed')));};
  new Setting(container).setName(L('写入位置','Destination')).addDropdown(dropdown=>dropdown.addOptions({daily:L('今日日记','Daily note'),fixed:L('固定笔记','Fixed note')}).setValue(plugin.settings.todoDaily?'daily':'fixed').onChange(value=>{plugin.settings.todoDaily=value==='daily';save();}));
  if(plugin.settings.todoDaily) {
    const available=commandExists(plugin.app,'daily-notes');
    if(!available)container.createDiv({cls:'setting-item-description',text:L('未启用日记，暂存到固定任务笔记。','Daily notes is disabled; using the fixed note.')});
    new Setting(container).setName(L('自动结转未完成任务','Automatically carry unfinished tasks')).setDesc(L('打开主页时移入今天，原笔记留下日期链接。','Move pending tasks into today when Home opens, leaving dated links.')).addToggle(toggle=>toggle.setValue(plugin.settings.todoAutoCarry).setDisabled(!available).onChange(value=>{plugin.settings.todoAutoCarry=value;save();}));
  }
  const fallback=container.createEl('details',{cls:'qh-settings-details'});fallback.open=!plugin.settings.todoDaily;
  fallback.createEl('summary',{text:plugin.settings.todoDaily?L('备用任务笔记','Fallback task note'):L('任务笔记','Task note')});
  new Setting(fallback).setName(plugin.settings.todoPath).setDesc(L('未完成项保留在原笔记中；切换不会自动搬移。','Existing tasks stay in their source; switching does not move them.')).addButton(button=>button.setButtonText(L('选择','Choose')).onClick(()=>new TodoPicker(plugin,changed,false).open()));
}
class TodoOptions extends Modal {
  constructor(private plugin: QiaomuHomePlugin) { super(plugin.app); this.modalEl.addClass("qh-ui"); }
  onOpen(): void {this.setTitle(L('待办设置','Todo settings'));this.contentEl.empty();renderTodoPreferences(this.contentEl,this.plugin,()=>this.onOpen());}
  onClose(): void {this.contentEl.empty();}
}
class CarryPicker extends Modal {
  constructor(app: QiaomuHomePlugin['app'], private groups: CarryGroup[], private run: (groups:CarryGroup[])=>Promise<void>) {super(app); this.modalEl.addClass("qh-ui");}
  onOpen(): void {
    this.setTitle(L('选择结转的任务', 'Choose tasks to carry forward'));
    const selected = new Set<string>();
    this.groups.forEach((group,i)=> {
      this.contentEl.createEl('h3',{text:group.file.basename});
      group.tasks.forEach((task,j)=>{ new Setting(this.contentEl).setName(task.text).addToggle(toggle=>toggle.onChange(value=>{const id=`${i}:${j}`;if(value)selected.add(id);else selected.delete(id);})); });
    });
    new Setting(this.contentEl).addButton(button=>button.setButtonText(L('移入今天','Move to today')).setCta().onClick(async()=>{
      const groups=this.groups.map((group,i)=>({...group,tasks:group.tasks.filter((_,j)=>selected.has(`${i}:${j}`))})).filter(group=>group.tasks.length);
      if(!groups.length)return;
      button.setDisabled(true);
      try {await this.run(groups);this.close();} catch {button.setDisabled(false);}
    }));
  }
  onClose(): void {this.contentEl.empty();}
}
export function renderTodo(parent: HTMLElement, plugin: QiaomuHomePlugin, limit: number): void {
  const app = plugin.app;
  let path = plugin.settings.todoPath;
  if (!drafts.has(plugin)) drafts.set(plugin, new Map());
  const draft = drafts.get(plugin)!;
  const card = parent.createDiv({ cls: 'qh-card qh-todo' }); card.dataset.module = 'todo';
  const head = card.createDiv({ cls: 'qh-card-head' });
  setIcon(head.createSpan({ cls: 'qh-card-icon' }), 'list-todo');
  head.createSpan({ cls: 'qh-card-title', text: L('今日代办', 'Today’s tasks') });
  const options=head.createEl('button',{cls:'qh-icon-button'});setIcon(options,'sliders-horizontal');options.createSpan({cls:'qh-sr-only',text:L('待办设置','Todo settings')});options.addEventListener('click',()=>new TodoOptions(plugin).open());
  const form = card.createEl('form', { cls: 'qh-todo-form' });
  const label = form.createEl('label', { cls: 'qh-sr-only', text: L('添加待办', 'Add task') });
  const input = label.createEl('input'); label.removeClass('qh-sr-only'); label.addClass('qh-todo-input-label');
  const draftKey = plugin.settings.todoDaily ? 'daily' : path;
  input.value = draft.get(draftKey) ?? '';
  input.addEventListener('input', () => draft.set(draftKey, input.value));
  input.placeholder = L('添加待办，回车保存', 'Add a task, press Enter');
  const submit = form.createEl('button', { type: 'submit' }); setIcon(submit, 'plus'); submit.createSpan({ cls: 'qh-sr-only', text: L('添加', 'Add') });
  const list = card.createDiv({ cls: 'qh-todo-list' });
  const carry = card.createDiv({cls:'qh-todo-carry'});
  const error = card.createDiv({ cls: 'qh-todo-error', attr: { role: 'status' } });
  const more = card.createEl('button', { cls: 'qh-todo-source', text: L('打开任务笔记', 'Open task note') });
  more.addEventListener('click', () => { const file = app.vault.getAbstractFileByPath(path); if (file instanceof TFile) void app.workspace.getLeaf('tab').openFile(file); });
  let generation = 0, busy = false, moving = false, autoTried = false;
  const move = async (groups:CarryGroup[]) => {
    if(moving)return;
    moving=true;error.empty();
    carry.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
    try { await carrySelected(plugin,path,groups); }
    catch(e) {
      error.setText(L('结转未全部完成，任务已保留。请等待笔记保存后点击重试；若笔记已改动，请先核对来源和今日笔记。','Transfer incomplete; tasks retained. Wait for notes to save and retry. If edited, check source and today first.'));
      const retry=error.createEl('button',{text:L('重试','Retry')});
      retry.addEventListener('click',()=>{void move([]).catch(()=>{});});
      throw e;
    } finally {moving=false;await refresh();}
  };
  const refresh = async () => {
    const turn = ++generation;
    path = await todoTarget(plugin);
    const file = app.vault.getAbstractFileByPath(path);
    const snapshot = file instanceof TFile ? editorFor(app, file)?.getValue() ?? await app.vault.cachedRead(file) : '';
    if (turn !== generation) return;
    more.setText(L('打开任务笔记', 'Open task note'));
    list.empty(); more.hidden = !(file instanceof TFile);
    const tasks = todayFirst(snapshot,readTodos(snapshot));
    if (!tasks.length) list.createDiv({ cls: 'qh-card-empty', text: L('暂无待办', 'No pending tasks') });
    for (const item of tasks.slice(0, limit)) {
      const row = list.createEl('label', { cls: 'qh-todo-row' });
      const checkbox = row.createEl('input', { type: 'checkbox' }); row.createSpan({ text: item.text });
      checkbox.addEventListener('change', () => {
        if (!(file instanceof TFile)) return;
        checkbox.disabled = true;
        void update(app, file, current => completeTodo(current, snapshot, item)).then(refresh).catch(() => {
          checkbox.checked = false; checkbox.disabled = false;
          error.setText(L('笔记已变化或写入失败，请重新打开主页后重试。', 'Note changed or write failed. Reopen Home and try again.'));
        });
      });
    }
    if(!moving) {
      const groups=await pendingCarry(plugin,path);
      if(turn!==generation)return;
      carry.empty();
      const count=groups.reduce((sum,g)=>sum+g.tasks.length,0);
      if(count) {
        carry.createSpan({text:L(`有 ${count} 条未完成`,`${count} pending from earlier notes`)});
        const all=carry.createEl('button',{text:L('全部移入今天','Move all to today')});all.addEventListener('click',()=>{void move(groups).catch(()=>{});});
        const choose=carry.createEl('button',{text:L('选择结转','Choose tasks')});choose.addEventListener('click',()=>new CarryPicker(app,groups,move).open());
        if(card.isConnected&&plugin.settings.todoAutoCarry&&!autoTried){autoTried=true;void move(groups).catch(()=>{});}
      }
    }
    if (tasks.length > limit) more.setText(L(`查看全部 ${tasks.length} 条`, `View all ${tasks.length} tasks`));
  };
  form.addEventListener('submit', event => {
    event.preventDefault(); if (busy || !input.value.trim()) return;
    const text = input.value; busy = true; submit.disabled = true; input.disabled = true; error.empty();
    void (async () => {
      path = await todoTarget(plugin);
      const file = await ensureTodoFile(plugin,path);
      const daily=plugin.settings.todoDaily && commandExists(app,'daily-notes');
      await update(app, file, content => daily ? underHeading(content,'今日待办',appendTodo('',text).trimEnd()) : appendTodo(content,text));
      input.value = ''; if (draft.get(draftKey) === text) draft.delete(draftKey); await refresh();
    })().catch(() => error.setText(L('保存失败，内容已保留，请检查任务笔记。', 'Could not save. Your input is retained. Check the task note.')))
      .finally(() => { busy = false; submit.disabled = false; input.disabled = false; if (input.isConnected) input.focus(); });
  });
  card.addEventListener('qh-todo-refresh', () => { void refresh().catch(() => error.setText(L('无法读取任务笔记', 'Could not read task note'))); });
  void refresh().catch(() => error.setText(L('无法读取任务笔记', 'Could not read task note')));
}
