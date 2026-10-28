import { formatMoney } from './sales-hud.js';

const dates = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'medium' });
export function formatAchievementProgress({ metric, progress: p }) {
  if (metric === 'catches') return `累計捕獲：${p.value} / ${p.target}匹`;
  if (metric === 'species') return `魚種発見：${p.value} / ${p.target}種`;
  if (metric === 'length') return `最大体長：${p.value.toFixed(1)} / ${p.target}cm`;
  if (metric === 'sales') return `累計売却額：${p.value.toLocaleString('ja-JP')} / ${formatMoney(p.target)}`;
  if (metric === 'rod-level') return `ロッドLv.${p.value} / Lv.${p.target}`;
  if (metric === 'reel-level') return `リールLv.${p.value} / Lv.${p.target}`;
  return `ロッドLv.${p.rodLevel}・リールLv.${p.reelLevel} / ${metric === 'equipment-max' ? '両方' : 'いずれか'}Lv.${p.target}`;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function renderAchievements(content, achievements) {
  const entries = achievements.entries;
  content.append(element('p', `解除済み ${entries.filter(entry => entry.unlocked).length} / ${entries.length}`, 'collection-summary achievement-summary'));
  const list = element('ul', undefined, 'achievement-list');
  for (const entry of entries) {
    const card = element('li', undefined, 'achievement-card');
    card.dataset.achievementId = entry.id; card.dataset.unlocked = String(entry.unlocked);
    card.append(element('span', entry.unlocked ? '✓ 解除済み' : '未解除', 'achievement-state'),
      element('h3', entry.name), element('p', entry.description),
      element('p', formatAchievementProgress(entry), 'achievement-progress'));
    if (entry.unlockedAt) {
      const time = element('time', `解除日時：${dates.format(new Date(entry.unlockedAt))}`);
      time.dateTime = entry.unlockedAt; card.append(time);
    }
    list.append(card);
  }
  content.append(list);
}
