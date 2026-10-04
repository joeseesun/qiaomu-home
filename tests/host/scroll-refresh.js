// Run with host_eval.py in the dedicated QA vault; no notes or settings are saved.
if (!app.vault.getName().includes('qa')) throw new Error('QA vault required');
const plugin = app.plugins.plugins['qiaomu-home'];
const settings = structuredClone(plugin.settings);
const sourceId = 'qh-scroll-qa';
const previous = app.plugins.plugins[sourceId];
const checks = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 400));
let playing = false;
const toggle = () => {
  playing = !playing;
  app.workspace.trigger('qiaomu-home:changed', sourceId);
};
try {
  app.plugins.plugins[sourceId] = { qiaomuHome: {
    protocol: 'qiaomu-home', version: 1,
    sections: () => Array.from({ length: 18 }, (_, index) => ({
      id: `stations-${index}`, title: `Station card ${index}`,
      items: Array.from({ length: 6 }, (_, row) => ({
        id: `${index}-${row}`, title: `Station ${index}-${row}`,
        subtitle: 'Ambient radio', meta: playing ? 'Live' : 'Paused', active: playing,
        open: toggle,
        actions: [{ id: 'toggle', label: playing ? 'Pause' : 'Play', icon: playing ? 'pause' : 'play', run: toggle }],
      })),
    })),
  } };
  const current = plugin.settings.pages.find(page => page.id === plugin.settings.activePageId);
  for (let index = 0; index < 18; index++) {
    current.moduleOptions[`section:${sourceId}:stations-${index}`] = { visible: true, limit: 6 };
  }
  await plugin.openHome();
  const view = app.workspace.getMostRecentLeaf().view;
  view.render();
  await pause();
  const page = view.contentEl.querySelector('.qh-page');
  const card = () => view.contentEl.querySelector(`[data-source="${sourceId}"]`);
  if (!card()) throw new Error('Fixture not rendered');
  for (const position of [400, 900, page.scrollHeight - page.clientHeight]) {
    page.scrollTop = position;
    const before = page.scrollTop;
    if (before <= 0) throw new Error('Fixture must scroll');
    for (let repeat = 0; repeat < 4; repeat++) {
      card().querySelector('.qh-item-action').click();
      await pause();
      const after = page.scrollTop;
      if (Math.abs(after - before) > 1) throw new Error(`Playback moved scroll: ${before} -> ${after}`);
      if (card().querySelector('.qh-item').classList.contains('is-active') !== playing) throw new Error('Playback state not updated');
      checks.push({ before, after, playing });
    }
  }
  // Settings rerenders use the same replacement path.
  const before = page.scrollTop;
  view.render();
  await pause();
  if (Math.abs(page.scrollTop - before) > 1) throw new Error('Settings refresh moved scroll');
  return { checks, settingsRefresh: { before, after: page.scrollTop } };
} finally {
  if (previous) app.plugins.plugins[sourceId] = previous;
  else delete app.plugins.plugins[sourceId];
  plugin.settings = settings;
  plugin.eachView(view => view.render());
}
