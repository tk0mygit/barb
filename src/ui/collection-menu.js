import { FISH_SPECIES, getFishSpecies } from '../game/fish-species.js';
import { calculateSalePrice } from '../game/fish-sales.js';
import { formatMoney } from './sales-hud.js';
import { EQUIPMENT_NAMES, UPGRADE_GUIDANCE, renderEquipment, renderUpgradeConfirmation } from './equipment-view.js';

const silhouette = new URL('../assets/fish/unknown.svg', import.meta.url).href;
const dates = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'medium' });
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function fishImage(src, name) {
  const image = element('img');
  image.src = src; image.alt = name; image.width = 640; image.height = 280;
  image.loading = 'lazy'; return image;
}

// One native modal owns menu, grid, detail and storage. No nested dialogs;
// undiscovered species never contribute their name, asset or details to DOM.
export function createCollectionMenu({ collection, canOpen, canPurchase, onOpenChange, onSale, onUpgrade }) {
  const trigger = document.querySelector('#menu-button');
  const dialog = document.querySelector('#collection-dialog');
  const title = document.querySelector('#collection-title');
  const content = document.querySelector('#collection-content');
  const back = document.querySelector('#collection-back');
  const close = document.querySelector('#collection-close');
  let active = false, screen = 'menu', pendingSale = null, pendingUpgrade = null;
  let purchaseAllowedAtOpen = false;
  let purchaseAllowedOnPress = null;
  const purchaseAllowed = () => purchaseAllowedAtOpen && canPurchase();
  function render(next = 'menu', speciesId) {
    if (next !== 'confirm-sale') pendingSale = null;
    if (next !== 'confirm-upgrade') pendingUpgrade = null;
    screen = next;
    content.replaceChildren(); content.scrollTop = 0;
    back.hidden = next === 'menu';
    if (next === 'menu') {
      title.textContent = '湖の記録';
      for (const [view, label] of [['encyclopedia', '魚図鑑'], ['storage', '保管魚'], ['equipment', '装備強化']]) {
        const button = element('button', label); button.type = 'button'; button.dataset.view = view;
        button.addEventListener('click', () => { render(view); title.focus(); }); content.append(button);
      }
    } else if (next === 'encyclopedia') {
      const entries = collection.encyclopedia;
      title.textContent = '魚図鑑';
      content.append(element('p', `発見 ${entries.filter(entry => entry.count > 0).length} / ${FISH_SPECIES.length} 種`, 'collection-summary'));
      const grid = element('div', undefined, 'fish-grid');
      for (const [index, entry] of entries.entries()) {
        const fish = FISH_SPECIES[index], discovered = entry.count > 0;
        const card = element(discovered ? 'button' : 'div', undefined, 'fish-card');
        card.dataset.slot = index;
        card.append(fishImage(discovered ? fish.image : silhouette, discovered ? fish.name : '未発見の魚のシルエット'), element('span', discovered ? fish.name : '？？？'));
        if (discovered) {
          card.type = 'button';
          card.append(element('small', `${entry.count}匹 · 最大 ${entry.maxLengthCm.toFixed(1)} cm`));
          card.addEventListener('click', () => { render('detail', entry.speciesId); title.focus(); });
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
      detail.append(fishImage(fish.image, fish.name), element('p', fish.description, 'fish-description'));
      const stats = element('dl');
      for (const [label, value] of [['累計捕獲数', `${entry.count}匹`], ['自己最大体長', `${entry.maxLengthCm.toFixed(1)} cm`], ['基準売却単価', `${fish.basePricePerKg} 通貨/kg`]]) {
        const row = element('div'); row.append(element('dt', label), element('dd', value)); stats.append(row);
      }
      detail.append(stats); content.append(detail);
    } else if (next === 'storage') {
      title.textContent = '保管魚';
      const records = collection.stored;
      content.append(element('p', `${records.length}匹を保管中 · 容量制限なし`, 'collection-summary'));
      const quote = collection.quoteStored();
      const sellAll = element('button', quote ? `すべて売却（${quote.count}匹 · ${formatMoney(quote.total)}）` : 'すべて売却');
      sellAll.type = 'button'; sellAll.id = 'sell-all'; sellAll.disabled = !quote;
      sellAll.addEventListener('click', () => {
        pendingSale = collection.quoteStored();
        if (pendingSale) { render('confirm-sale'); title.focus(); }
      });
      content.append(sellAll);
      if (!records.length) content.append(element('p', '保管中の魚はいません。釣り上げた魚を保管すると、ここに表示されます。', 'collection-empty'));
      const list = element('div', undefined, 'stored-list');
      // Newest first, with full stable IDs so identical fish remain distinct.
      for (const record of [...records].reverse()) {
        const fish = getFishSpecies(record.speciesId);
        const row = element('article', undefined, 'stored-fish'); row.dataset.catchId = record.id;
        const info = element('div');
        const time = element('time', dates.format(new Date(record.caughtAt))); time.dateTime = record.caughtAt;
        info.append(element('h3', fish.name), element('p', `${record.lengthCm.toFixed(1)} cm · ${record.weightKg.toFixed(2)} kg`), time, element('small', `個体ID ${record.id}`));
        info.append(element('p', `売却価格 ${formatMoney(calculateSalePrice(record))}`, 'stored-price'));
        const sell = element('button', 'この魚を売却'); sell.type = 'button'; sell.className = 'sell-stored';
        sell.addEventListener('click', () => {
          // A stale/detached button cannot sell another fish or re-sell this ID.
          completeSale(collection.sellStored([record.id]));
        });
        info.append(sell);
        row.append(fishImage(fish.image, fish.name), info); list.append(row);
      }
      content.append(list);
    } else if (next === 'equipment') {
      title.textContent = '装備強化';
      renderEquipment(content, collection, purchaseAllowed(), kind => {
        if (!active || !dialog.open || screen !== 'equipment' || !purchaseAllowed()) return;
        const status = collection.getUpgradeStatus(kind);
        if (!status?.canPurchase) { completeUpgrade(null); return; }
        pendingUpgrade = status;
        render('confirm-upgrade'); title.focus();
      });
    } else if (next === 'confirm-upgrade') {
      if (!pendingUpgrade) { render('equipment'); return; }
      title.textContent = '装備強化の購入確認';
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
      }, () => { render('equipment'); title.focus(); });
    } else if (next === 'confirm-sale') {
      if (!pendingSale) { render('storage'); return; }
      title.textContent = '保管魚をすべて売却';
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
      cancel.addEventListener('click', () => { render('storage'); title.focus(); });
      content.append(confirm, cancel);
    }
  }
  function completeUpgrade(receipt, error = '購入できませんでした。最新の所持金と装備をご確認ください。') {
    onUpgrade(); // The shared HUD owns both wallet displays, even on failure.
    render('equipment'); title.focus();
    const message = element('p', receipt ? `${EQUIPMENT_NAMES[receipt.kind]}をLv.${receipt.level}に強化しました。` : error, 'upgrade-message');
    message.setAttribute('role', receipt ? 'status' : 'alert'); content.prepend(message);
  }
  function completeSale(receipt) {
    render('storage'); title.focus();
    if (receipt) onSale(receipt);
    else { const message = element('p', '売却できませんでした。保管魚と所持金をご確認ください。'); message.setAttribute('role', 'alert'); content.prepend(message); }
  }
  function finishClose() {
    if (!active) return;
    active = false; pendingSale = null; pendingUpgrade = null; purchaseAllowedAtOpen = false;
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
    active = true; onOpenChange(true); render();
    trigger.setAttribute('aria-expanded', 'true'); dialog.showModal(); close.focus();
  });
  back.addEventListener('click', () => { render(screen === 'detail' ? 'encyclopedia' : screen === 'confirm-sale' ? 'storage' : screen === 'confirm-upgrade' ? 'equipment' : 'menu'); title.focus(); });
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => { if (!dialog.open) finishClose(); });
  return { get isOpen() { return active; }, update() { trigger.disabled = !canOpen(); } };
}
