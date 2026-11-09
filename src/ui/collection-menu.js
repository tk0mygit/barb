import { FISH_SPECIES, getFishSpecies } from '../game/fish-species.js';
import { calculateSalePrice } from '../game/fish-sales.js';
import { formatMoney } from './sales-hud.js';
import { EQUIPMENT_NAMES, UPGRADE_GUIDANCE, renderEquipment, renderUpgradeConfirmation } from './equipment-view.js';
import { renderAchievements } from './achievements-view.js';
import { renderSoundSettings } from './sound-settings.js';
import { createVisibleFishImages } from './fish-image-loader.js';
import { renderHelp } from './help-view.js';

const silhouette = new URL('../assets/fish/unknown.svg', import.meta.url).href;
const dates = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'medium' });
const menuEntries = [
  ['encyclopedia', '図鑑', '発見した魚と捕獲記録'],
  ['storage', '生けす', '保管した魚の確認・売却'],
  ['equipment', 'ギア／アップグレード', 'ロッドとリールの強化'],
  ['achievements', '実績', '達成条件と進捗'],
  ['sound', 'サウンド設定', 'BGM・自然音の設定', 'aux'],
  ['help', 'ヘルプ', 'プレイと操作の基本', 'aux'],
];
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function fishImage(src, name, visibleImages) {
  const image = element('img');
  image.alt = name;
  image.loading = 'lazy';
  if (visibleImages) visibleImages.add(image, src);
  else image.src = src;
  const frame = element('span', undefined, 'fish-image-frame');
  frame.append(image); return frame;
}

// One native modal owns menu, grid, detail and storage. No nested dialogs;
// undiscovered species never contribute their name, asset or details to DOM.
export function createCollectionMenu({ collection, achievements, canOpen, canPurchase, onOpenChange, onSale, onUpgrade, ambientAudio }) {
  const trigger = document.querySelector('#menu-button');
  const dialog = document.querySelector('#collection-dialog');
  const title = document.querySelector('#collection-title');
  const menuNote = document.querySelector('#collection-menu-note');
  const scrollContent = document.querySelector('#collection-content');
  const content = document.querySelector('#collection-view');
  const back = document.querySelector('#collection-back');
  const close = document.querySelector('#collection-close');
  let active = false, screen = 'menu', pendingSale = null, pendingUpgrade = null;
  let purchaseAllowedAtOpen = false;
  let purchaseAllowedOnPress = null;
  const purchaseAllowed = () => purchaseAllowedAtOpen && canPurchase();
  let disposeSoundSettings;
  let visibleImages;
  // Only UI positions and stable control keys survive a child view. Fish DOM,
  // decoded images, subscriptions and pending quotes keep their existing owners.
  const parentPositions = new Map();
  function controlKey(button) {
    if (!button) return null;
    if (button.id) return `id:${button.id}`;
    if (button.dataset.view) return `view:${button.dataset.view}`;
    if (button.dataset.slot !== undefined) return `slot:${button.dataset.slot}`;
    if (button.dataset.upgrade) return `upgrade:${button.dataset.upgrade}`;
    const catchId = button.closest('.stored-fish')?.dataset.catchId;
    return catchId ? `catch:${catchId}` : null;
  }
  function capturePosition(origin = document.activeElement) {
    const keys = [...content.querySelectorAll('button')].map(controlKey).filter(Boolean);
    const key = content.contains(origin) ? controlKey(origin) : null;
    return { scrollTop: scrollContent.scrollTop, key, keys, index: keys.indexOf(key) };
  }
  function restoreFocus(position) {
    const buttons = new Map([...content.querySelectorAll('button')]
      .filter(button => !button.disabled && button.getClientRects().length)
      .map(button => [controlKey(button), button]).filter(([key]) => key));
    const keys = position ? [position.key, ...position.keys.slice(position.index + 1),
      ...position.keys.slice(0, Math.max(0, position.index)).reverse()] : [];
    const target = keys.map(key => buttons.get(key)).find(Boolean);
    if (!target) { title.focus({ preventScroll: true }); return; }
    target.focus({ preventScroll: true });
    // A removed row, changed balance or rotated viewport may put a fallback
    // outside the restored pane. Reveal only that control when necessary.
    const box = target.getBoundingClientRect(), pane = scrollContent.getBoundingClientRect();
    if (box.top < pane.top || box.bottom > pane.bottom) target.scrollIntoView({ block: 'nearest' });
  }
  function openChild(next, origin, speciesId) {
    parentPositions.set(screen, capturePosition(origin));
    render(next, speciesId); title.focus({ preventScroll: true });
  }
  function returnTo(next) {
    const position = parentPositions.get(next);
    render(next, undefined, position?.scrollTop);
    restoreFocus(position);
  }
  function render(next = 'menu', speciesId, scrollTop = 0) {
    visibleImages?.dispose(); visibleImages = createVisibleFishImages(scrollContent);
    disposeSoundSettings?.(); disposeSoundSettings = null;
    if (next !== 'confirm-sale') pendingSale = null;
    if (next !== 'confirm-upgrade') pendingUpgrade = null;
    screen = next;
    content.replaceChildren(); scrollContent.scrollTop = 0;
    back.hidden = next === 'menu';
    menuNote.hidden = next !== 'menu';
    if (next === 'menu') {
      title.textContent = '湖の記録';
      const home = element('div', undefined, 'menu-home');
      for (const [view, label, description, role] of menuEntries) {
        if (view === 'sound' && !ambientAudio) continue;
        const button = element('button', undefined, `menu-entry${role === 'aux' ? ' menu-entry--aux' : ''}`);
        button.type = 'button'; button.dataset.view = view;
        const name = element('span', label, 'menu-entry-title'); name.id = `collection-${view}-label`;
        const summary = element('span', description, 'menu-entry-description'); summary.id = `collection-${view}-description`;
        const arrow = element('span', '›', 'menu-entry-arrow'); arrow.setAttribute('aria-hidden', 'true');
        button.setAttribute('aria-labelledby', name.id); button.setAttribute('aria-describedby', summary.id);
        button.append(name, summary, arrow);
        button.addEventListener('click', () => openChild(view, button)); home.append(button);
      }
      content.append(home);
    } else if (next === 'encyclopedia') {
      const entries = collection.encyclopedia;
      title.textContent = '図鑑';
      content.append(element('p', `発見 ${entries.filter(entry => entry.count > 0).length} / ${FISH_SPECIES.length} 種`, 'collection-summary'));
      const grid = element('div', undefined, 'fish-grid');
      for (const [index, entry] of entries.entries()) {
        const fish = FISH_SPECIES[index], discovered = entry.count > 0;
        const card = element(discovered ? 'button' : 'div', undefined, 'fish-card');
        card.dataset.slot = index;
        card.append(fishImage(discovered ? fish.image : silhouette, discovered ? fish.name : '未発見の魚のシルエット', discovered ? visibleImages : null), element('span', discovered ? fish.name : '？？？', 'fish-card-name'));
        if (discovered) {
          card.type = 'button';
          card.append(element('small', `${entry.count}匹 · 最大 ${entry.maxLengthCm.toFixed(1)} cm`));
          card.addEventListener('click', () => openChild('detail', card, entry.speciesId));
        }
        grid.append(card);
      }
      content.append(grid);
    } else if (next === 'detail') {
      const entry = collection.encyclopedia.find(item => item.speciesId === speciesId && item.count > 0);
      if (!entry) { render('encyclopedia'); return; }
      const fish = getFishSpecies(entry.speciesId);
      title.textContent = fish.name;
      const detail = element('article', undefined, 'fish-detail');
      detail.append(fishImage(fish.image, fish.name, visibleImages), element('p', fish.description, 'fish-description'));
      const stats = element('dl');
      for (const [label, value] of [['捕獲数', `${entry.count}匹`], ['最大記録', `${entry.maxLengthCm.toFixed(1)} cm`], ['規定売価', `${fish.basePricePerKg} Val/kg`]]) {
        const row = element('div'); row.append(element('dt', label), element('dd', value)); stats.append(row);
      }
      detail.append(stats); content.append(detail);
    } else if (next === 'storage') {
      title.textContent = '生けす';
      const records = collection.stored;
      content.append(element('p', `${records.length}匹が生きている。`, 'collection-summary'));
      const quote = collection.quoteStored();
      const sellAll = element('button', quote ? `生けす内をすべて売却（${quote.count}匹 · ${formatMoney(quote.total)}）` : '生けす内をすべて売却');
      sellAll.type = 'button'; sellAll.id = 'sell-all'; sellAll.disabled = !quote;
      sellAll.addEventListener('click', () => {
        pendingSale = collection.quoteStored();
        if (pendingSale) openChild('confirm-sale', sellAll);
      });
      content.append(sellAll);
      if (!records.length) content.append(element('p', '現在生けすは虚です。', 'collection-empty'));
      const list = element('div', undefined, 'stored-list');
      // Newest first, with full stable IDs so identical fish remain distinct.
      for (const record of [...records].reverse()) {
        const fish = getFishSpecies(record.speciesId);
        const row = element('article', undefined, 'stored-fish'); row.dataset.catchId = record.id;
        const info = element('div');
        const time = element('time', dates.format(new Date(record.caughtAt))); time.dateTime = record.caughtAt;
        info.append(element('h3', fish.name), element('p', `${record.lengthCm.toFixed(1)} cm · ${record.weightKg.toFixed(2)} kg`), time, element('small', `個体ID ${record.id}`));
        info.append(element('p', `売却価格 ${formatMoney(calculateSalePrice(record))}`, 'stored-price'));
        const sell = element('button', 'この個体を売却'); sell.type = 'button'; sell.className = 'sell-stored';
        sell.addEventListener('click', () => {
          const position = capturePosition(sell);
          // A stale/detached button cannot sell another fish or re-sell this ID.
          completeSale(collection.sellStored([record.id]), position);
        });
        info.append(sell);
        row.append(fishImage(fish.image, fish.name, visibleImages), info); list.append(row);
      }
      content.append(list);
    } else if (next === 'help') {
      title.textContent = 'ヘルプ';
      renderHelp(content, menuEntries);
    } else if (next === 'sound') {
      title.textContent = 'サウンド設定';
      disposeSoundSettings = renderSoundSettings(content, ambientAudio);
    } else if (next === 'achievements') {
      title.textContent = '実績';
      renderAchievements(content, achievements);
    } else if (next === 'equipment') {
      title.textContent = 'ギア／アップグレード';
      renderEquipment(content, collection, purchaseAllowed(), kind => {
        if (!active || !dialog.open || screen !== 'equipment' || !purchaseAllowed()) return;
        const status = collection.getUpgradeStatus(kind);
        if (!status?.canPurchase) { completeUpgrade(null); return; }
        pendingUpgrade = status;
        const origin = [...content.querySelectorAll('[data-upgrade]')].find(button => button.dataset.upgrade === kind);
        openChild('confirm-upgrade', origin);
      });
    } else if (next === 'confirm-upgrade') {
      if (!pendingUpgrade) { render('equipment'); return; }
      title.textContent = 'アップグレード確認';
      const displayedQuote = pendingUpgrade;
      renderUpgradeConfirmation(content, displayedQuote, () => {
        if (!active || !dialog.open || screen !== 'confirm-upgrade' || pendingUpgrade !== displayedQuote) return;
        // Consume the confirmation before any callbacks; detached/queued events
        // cannot purchase twice or act on a later confirmation.
        pendingUpgrade = null;
        const allowed = purchaseAllowed();
        const latest = collection.getUpgradeStatus(displayedQuote.kind);
        const receipt = allowed && latest?.canPurchase && latest.currentLevel === displayedQuote.currentLevel
          ? collection.purchaseUpgrade(displayedQuote.kind, displayedQuote.currentLevel) : null;
        completeUpgrade(receipt, allowed ? undefined : UPGRADE_GUIDANCE);
      }, () => returnTo('equipment'));
    } else if (next === 'confirm-sale') {
      if (!pendingSale) { render('storage'); return; }
      title.textContent = '生けす内をすべて売却';
      content.append(element('p', `${pendingSale.count}匹を ${formatMoney(pendingSale.total)} で売却します。`, 'sale-confirm-summary'),
        element('p', '売却しても図鑑と捕獲履歴は残ります。'));
      const confirm = element('button', '売却を確定'); confirm.type = 'button'; confirm.id = 'confirm-sale';
      const displayedQuote = pendingSale;
      confirm.addEventListener('click', () => {
        if (pendingSale !== displayedQuote) return;
        pendingSale = null;
        completeSale(collection.sellStored(displayedQuote.ids));
      });
      const cancel = element('button', 'キャンセル'); cancel.type = 'button'; cancel.id = 'cancel-sale';
      cancel.addEventListener('click', () => returnTo('storage'));
      content.append(confirm, cancel);
    }
    scrollContent.scrollTop = scrollTop;
    visibleImages.refresh();
  }
  function completeUpgrade(receipt, error = '購入できませんでした。最新の所持金と装備をご確認ください。') {
    const position = screen === 'equipment' ? capturePosition() : parentPositions.get('equipment');
    onUpgrade(); // The shared HUD owns both wallet displays, even on failure.
    render('equipment', undefined, position?.scrollTop);
    const message = element('p', receipt ? `${EQUIPMENT_NAMES[receipt.kind]}はLv.${receipt.level}と記憶しました。` : error, 'upgrade-message');
    message.setAttribute('role', receipt ? 'status' : 'alert'); content.prepend(message);
    restoreFocus(position);
  }
  function completeSale(receipt, position = parentPositions.get('storage')) {
    render('storage', undefined, position?.scrollTop);
    if (receipt) onSale(receipt);
    else { const message = element('p', '売却できませんでした。生けすと所持金をご確認ください。'); message.setAttribute('role', 'alert'); content.prepend(message); }
    restoreFocus(position);
  }
  function finishClose() {
    if (!active) return;
    visibleImages?.dispose();
    disposeSoundSettings?.(); disposeSoundSettings = null;
    active = false; pendingSale = null; pendingUpgrade = null; purchaseAllowedAtOpen = false;
    parentPositions.clear();
    trigger.setAttribute('aria-expanded', 'false'); onOpenChange(false);
  }
  function dismiss() { dialog.close(); finishClose(); }
  // Pointer focus blurs the canvas and cancels AIM before click fires.
  trigger.addEventListener('pointerdown', () => { purchaseAllowedOnPress = canPurchase(); });
  for (const event of ['pointercancel', 'blur']) trigger.addEventListener(event, () => { purchaseAllowedOnPress = null; });
  trigger.addEventListener('click', () => {
    const allowedOnPress = purchaseAllowedOnPress;
    purchaseAllowedOnPress = null;
    if (active || !canOpen()) return;
    // Opening the menu cancels AIM through the existing input reset. Keep that
    // menu visit read-only if it originated in a prohibited phase.
    purchaseAllowedAtOpen = (allowedOnPress ?? true) && canPurchase();
    parentPositions.clear();
    active = true; onOpenChange(true); render();
    trigger.setAttribute('aria-expanded', 'true'); dialog.showModal();
    // A hidden native dialog can retain its previous scroll offset until open.
    scrollContent.scrollTop = 0; close.focus({ preventScroll: true });
  });
  back.addEventListener('click', () => returnTo(screen === 'detail' ? 'encyclopedia' : screen === 'confirm-sale' ? 'storage' : screen === 'confirm-upgrade' ? 'equipment' : 'menu'));
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => { if (!dialog.open) finishClose(); });
  collection.subscribe(() => {
    if (!active || !dialog.open || screen !== 'achievements') return;
    const position = capturePosition();
    render('achievements', undefined, position.scrollTop);
    if (position.key) restoreFocus(position);
  });
  return { get isOpen() { return active; }, update() { trigger.disabled = !canOpen(); } };
}
