import { expect, it } from 'vitest';
import { moduleOptions, normalizeSettings } from '../src/settings';

it('offers the starter guide on fresh installs without inserting it into existing layouts', () => {
  expect(moduleOptions(normalizeSettings(null), 'beginner-plugins')).toEqual({ visible: true, limit: 3 });
  const upgraded = normalizeSettings({ pages: [{ id: 'home', name: 'My home', defaultVisible: true, moduleOptions: {}, moduleOrder: [], shortcutGroups: [], showRecommendations: false }], homePageId: 'home', activePageId: 'home' });
  expect(moduleOptions(upgraded, 'beginner-plugins').visible).toBe(false);
  upgraded.pages[0].moduleOptions['beginner-plugins'] = { visible: true, limit: 5 };
  expect(moduleOptions(normalizeSettings(upgraded), 'beginner-plugins')).toEqual({ visible: true, limit: 5 });
});
