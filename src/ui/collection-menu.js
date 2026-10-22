import { FISH_SPECIES, getFishSpecies } from '../game/fish-species.js';

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
export function createCollectionMenu({ collection, canOpen, onOpenChange }) {
  const trigger = document.querySelector('#menu-button');
  const dialog = document.querySelector('#collection-dialog');
  const title = document.querySelector('#collection-title');
  const content = document.querySelector('#collection-content');
  const back = document.querySelector('#collection-back');
  const close = document.querySelector('#collection-close');
  let active = false, screen = 'menu';
  function render(next = 'menu', speciesId) {
    screen = next;
    content.replaceChildren(); content.scrollTop = 0;
    back.hidden = next === 'menu';
    if (next === 'menu') {
      title.textContent = '湖の記録';
      for (const [view, label] of [['encyclopedia', '魚図鑑'], ['storage', '保管魚']]) {
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
      if (!records.length) content.append(element('p', '保管魚はまだいません。釣り上げた魚を保管すると、ここに表示されます。', 'collection-empty'));
      const list = element('div', undefined, 'stored-list');
      // Newest first, with full stable IDs so identical fish remain distinct.
      for (const record of [...records].reverse()) {
        const fish = getFishSpecies(record.speciesId);
        const row = element('article', undefined, 'stored-fish'); row.dataset.catchId = record.id;
        const info = element('div');
        const time = element('time', dates.format(new Date(record.caughtAt))); time.dateTime = record.caughtAt;
        info.append(element('h3', fish.name), element('p', `${record.lengthCm.toFixed(1)} cm · ${record.weightKg.toFixed(2)} kg`), time, element('small', `個体ID ${record.id}`));
        row.append(fishImage(fish.image, fish.name), info); list.append(row);
      }
      content.append(list);
    }
  }
  function finishClose() {
    if (!active) return;
    active = false; trigger.setAttribute('aria-expanded', 'false'); onOpenChange(false);
  }
  function dismiss() { dialog.close(); finishClose(); }
  trigger.addEventListener('click', () => {
    if (active || !canOpen()) return;
    active = true; onOpenChange(true); render();
    trigger.setAttribute('aria-expanded', 'true'); dialog.showModal(); close.focus();
  });
  back.addEventListener('click', () => { render(screen === 'detail' ? 'encyclopedia' : 'menu'); title.focus(); });
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', finishClose);
  return { get isOpen() { return active; }, update() { trigger.disabled = !canOpen(); } };
}
