import { getEquipmentLevel } from '../game/equipment.js';
import { FISHING_CONFIG } from '../game/fishing-config.js';
import { formatMoney } from './sales-hud.js';

export const UPGRADE_GUIDANCE = '操船中、またはキャスト前に強化できます';
export const EQUIPMENT_NAMES = Object.freeze({ rod: 'ロッド', reel: 'リール' });

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const percent = value => Math.round(value * 100);
function performance(kind, row) {
  return kind === 'rod'
    ? [['最大飛距離', FISHING_CONFIG.castMax + row.castDistanceBonusM, 'm'], ['テンション上昇抑制', percent(1 - row.tensionMultiplier), '%']]
    : [['巻取り速度', percent(row.reelSpeedMultiplier), '%'], ['テンション緩和', percent(row.tensionReliefMultiplier), '%']];
}

function bonuses(kind, row) {
  return kind === 'rod'
    ? [['Uncommon 出現重み', row.tierMultipliers?.Uncommon ?? 1], ['Rare 出現重み', row.tierMultipliers?.Rare ?? 1]]
    : [['大型魚 FIGHT巻取り補助', row.largeFishAssistMultiplier ?? 1]];
}

function appendBonuses(content, kind, currentRow, nextRow, confirmation = false) {
  const current = bonuses(kind, currentRow);
  const next = nextRow && bonuses(kind, nextRow);
  const stats = element('dl', undefined, 'equipment-stats equipment-bonuses');
  current.forEach(([label, value], index) => {
    const row = element('div');
    row.append(element('dt', label), element('dd', `現在 ×${value.toFixed(2)}`, 'equipment-bonus-current'));
    if (next) {
      const nextValue = next[index][1];
      row.append(element('dd', `${confirmation ? '購入後 Lv.' : '次Lv.'}${nextRow.level} ×${nextValue.toFixed(2)}`, 'equipment-bonus-next'),
        element('dd', `強化差 +${(nextValue - value).toFixed(2)}倍`, 'equipment-bonus-delta'));
    }
    stats.append(row);
  });
  content.append(stats);
  if (current.every(([, value]) => value === 1)) {
    const unchanged = confirmation && next.every(([, value]) => value === 1);
    content.append(element('p', unchanged
      ? '今回の専用効果は変化なし（×1.00）。Lv.6から有効。'
      : 'Lv.6から有効（×1.00は補正なし）。', 'equipment-bonus-note upgrade-guidance'));
  }
  content.append(element('p', kind === 'rod'
    ? '出現確率ではなく相対重みへの補正。Commonは変更なし。'
    : '大型魚とのFIGHT中のみ。LURE回収には適用されません。', 'equipment-bonus-scope upgrade-guidance'));
  if (kind === 'reel') content.append(element('p',
    '大型魚：70cm以上、または40cm以上で同魚種の長さ範囲の上位25%。', 'equipment-bonus-size upgrade-guidance'));
}

// Presentation reads canonical rows and the collection's quote; no price model.
export function renderEquipment(content, collection, allowed, onUpgrade) {
  const guidance = element('p', UPGRADE_GUIDANCE, 'upgrade-guidance');
  guidance.id = 'upgrade-guidance'; content.append(guidance);
  const grid = element('div', undefined, 'equipment-grid');
  for (const [kind, name] of Object.entries(EQUIPMENT_NAMES)) {
    const status = collection.getUpgradeStatus(kind);
    const card = element('article', undefined, 'equipment-card'); card.dataset.equipment = kind;
    const heading = element('h3', `${name} · Lv.${status.currentLevel}`);
    heading.id = `${kind}-heading`; card.setAttribute('aria-labelledby', heading.id);
    const stats = element('dl', undefined, 'equipment-stats');
    const currentRow = getEquipmentLevel(kind, status.currentLevel);
    const current = performance(kind, currentRow);
    const next = status.next && performance(kind, status.next);
    current.forEach(([label, value, unit], index) => {
      const row = element('div');
      row.append(element('dt', label), element('dd', `現在 ${value}${unit}`, 'equipment-current'));
      if (next) {
        const nextValue = next[index][1];
        row.append(element('dd', `次Lv.${status.next.level} ${nextValue}${unit}`, 'equipment-next'),
          element('dd', `強化差 +${nextValue - value}${unit === '%' ? 'ポイント' : unit}`, 'equipment-delta'));
      }
      stats.append(row);
    });
    card.append(heading, stats);
    appendBonuses(card, kind, currentRow, status.next);
    if (status.next) card.append(element('p', `次Lv.${status.next.level}の購入価格 ${formatMoney(status.next.cost)}`, 'upgrade-price'));
    let reason = '購入可能';
    if (!status.next) reason = '最大強化済み';
    else if (status.reason === 'insufficient-funds') reason = `所持金不足 · 必要 ${formatMoney(status.next.cost)}`;
    else if (!status.canPurchase) reason = '購入できません。所持金と装備をご確認ください。';
    else if (!allowed) reason = '現在は強化できません';
    const state = element('p', reason, 'upgrade-state'); state.id = `${kind}-upgrade-state`;
    const button = element('button', status.next ? `${name}を強化` : '最大強化済み');
    button.type = 'button'; button.dataset.upgrade = kind;
    button.disabled = !allowed || !status.canPurchase;
    button.setAttribute('aria-describedby', `${state.id} upgrade-guidance`);
    button.addEventListener('click', () => onUpgrade(kind));
    card.append(state, button); grid.append(card);
  }
  content.append(grid);
}

export function renderUpgradeConfirmation(content, quote, onConfirm, onCancel) {
  content.append(element('p', `${EQUIPMENT_NAMES[quote.kind]}を強化します。`, 'upgrade-confirm-name'),
    element('p', `現在 Lv.${quote.currentLevel} → 購入後 Lv.${quote.next.level}`, 'upgrade-confirm-level'),
    element('p', `購入価格 ${formatMoney(quote.next.cost)}`, 'upgrade-price'));
  appendBonuses(content, quote.kind, getEquipmentLevel(quote.kind, quote.currentLevel), quote.next, true);
  const actions = element('div', undefined, 'upgrade-actions');
  for (const [id, label, handler] of [['confirm-upgrade', '購入を確定', onConfirm], ['cancel-upgrade', 'キャンセル', onCancel]]) {
    const button = element('button', label); button.type = 'button'; button.id = id;
    button.addEventListener('click', handler); actions.append(button);
  }
  content.append(actions);
}
