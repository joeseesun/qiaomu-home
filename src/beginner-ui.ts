import { setIcon } from 'obsidian';
import type QiaomuHomePlugin from './main';
import { isChinese } from './i18n';
import { installState, openPluginPage } from './ecosystem';
import { BEGINNER_PLUGINS } from './beginner-plugins';

const L=(zh:string,en:string)=>isChinese()?zh:en;
export function renderBeginnerPlugins(parent:HTMLElement,plugin:QiaomuHomePlugin,pageId:string,limit:number,expanded:Set<string>):void {
  const card=parent.createDiv({cls:'qh-card qh-beginner',attr:{'data-module':'beginner-plugins'}});
  const head=card.createDiv({cls:'qh-card-head'});setIcon(head.createSpan({cls:'qh-card-icon'}),'compass');
  head.createSpan({cls:'qh-card-title',text:L('新手必装','Starter plugins')});
  card.createDiv({cls:'qh-beginner-intro',text:L('按需要选一两个，慢慢找到自己的用法。','Start with one or two that fit your needs.')});
  const list=card.createDiv({cls:'qh-beginner-list'});list.id=`qh-guide-${crypto.randomUUID()}`;
  const toggle=card.createEl('button',{cls:'qh-beginner-toggle',attr:{'aria-controls':list.id}});
  const render=()=>{
    list.empty();const open=expanded.has(pageId);
    for(const item of BEGINNER_PLUGINS.slice(0,open?BEGINNER_PLUGINS.length:limit)) {
      const row=list.createDiv({cls:'qh-beginner-row'});setIcon(row.createSpan({cls:'qh-beginner-icon'}),item.icon);
      const info=row.createDiv({cls:'qh-beginner-info'});const title=info.createDiv({cls:'qh-beginner-title'});title.createSpan({text:item.name});
      const state=installState(plugin.app,item.id);
      if(state!=='absent')title.createSpan({cls:'qh-beginner-status',text:state==='enabled'?L('已启用','Enabled'):L('已安装','Installed')});
      info.createDiv({cls:'qh-beginner-description',text:isChinese()?item.zh:item.en});
      info.createDiv({cls:'qh-beginner-audience',text:isChinese()?item.audienceZh:item.audienceEn});
      const action=row.createEl('button',{cls:'qh-icon-button qh-beginner-open'});setIcon(action,'arrow-up-right');action.createSpan({cls:'qh-sr-only',text:L(`查看 ${item.name}`,`View ${item.name}`)});
      action.addEventListener('click',()=>openPluginPage(item.id));
    }
    toggle.setText(open?L('收起','Show less'):L(`查看更多（${BEGINNER_PLUGINS.length-limit}）`,`Show ${BEGINNER_PLUGINS.length-limit} more`));
    toggle.setAttr('aria-expanded',String(open));
  };
  toggle.addEventListener('click',()=>{if(expanded.has(pageId))expanded.delete(pageId);else expanded.add(pageId);render();});
  render();
}
