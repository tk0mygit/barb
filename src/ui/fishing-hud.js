import { PHASE } from '../game/fishing.js';
import { getFishSpecies } from '../game/fish-species.js';
import { createLurePicker } from './lure-picker.js';
import { calculateSalePrice } from '../game/fish-sales.js';
import { formatMoney } from './sales-hud.js';
import { createFishImageLoader } from './fish-image-loader.js';

const labels = { ready: 'キャスト前', aim: 'キャスト準備', cast: 'キャスト中', lure: 'アタリを待つ', bite: 'アタリ！ 今すぐタップ', fight: 'ファイト', landing: 'ランディング', result: '釣り上げました', failed: '魚が逃げました' };
const hints = {
  ready: '画面をドラッグして視線調整 → キャスト準備',
  aim: '左右で方向・長さで飛距離 · 離して投げる',
  cast: '着水を待っています…', lure: '長押しで巻く · フリックで誘う · 離して待つ',
  bite: 'いったん離して、1秒以内に画面をタップ！',
  fight: '長押しで引く · 高くなったら離す · 緩めすぎに注意',
  landing: 'もうすぐ、釣り上がります', failed: 'まもなく再挑戦できます', result: '',
};
export function createFishingHUD({ onPrepare, onCancel, onClose, onSell, onSelectLure }) {
  const panel = document.querySelector('#fishing-panel');
  const app = document.querySelector('#app');
  const status = document.querySelector('#fishing-state');
  const prepare = document.querySelector('#cast-button');
  const cancel = document.querySelector('#cancel-cast');
  const distance = document.querySelector('#line-distance');
  const tension = document.querySelector('#line-tension');
  const fight = document.querySelector('#fight-gauge');
  const dialog = document.querySelector('#catch-dialog');
  const close = document.querySelector('#close-catch');
  const imageStatus = document.querySelector('#catch-image-status');
  const loadFishImage = createFishImageLoader();
  const lurePicker = createLurePicker(document.querySelector('#lure-picker'), onSelectLure);
  let previous = null;
  let generation = 0, currentRequest = null, prefetchedEncounter = null, isActive = false;
  function invalidateImage() {
    generation++; currentRequest = null;
    const old = document.querySelector('#catch-image');
    old.hidden = true;
    // Detach the old pixels immediately; the cache may still own this decoded
    // element, but a closed/changed result must never leave it in the frame.
    const empty = document.createElement('img');
    empty.id = 'catch-image'; empty.alt = ''; empty.hidden = true;
    old.removeAttribute('id'); old.replaceWith(empty);
    imageStatus.hidden = false;
    imageStatus.textContent = '画像を読み込み中…';
  }
  function showImage(fishing, record) {
    invalidateImage();
    const request = currentRequest = { generation, catchId: record.id, speciesId: record.speciesId };
    const species = getFishSpecies(record.speciesId);
    const isCurrent = () => currentRequest === request && generation === request.generation
      && isActive && dialog.open && fishing.state.phase === PHASE.RESULT
      && fishing.state.catch?.id === request.catchId && fishing.state.catch?.speciesId === request.speciesId;
    loadFishImage(species).then(image => {
      if (!isCurrent()) return;
      image.id = 'catch-image'; image.alt = `${species.name}の側面イラスト`; image.hidden = false;
      document.querySelector('#catch-image').replaceWith(image);
      imageStatus.hidden = true;
    }, () => {
      if (isCurrent()) imageStatus.textContent = '画像を表示できません';
    });
  }
  prepare.addEventListener('click', onPrepare);
  cancel.addEventListener('click', onCancel);
  const closeResult = () => { invalidateImage(); onClose(); dialog.close(); };
  close.addEventListener('click', closeResult);
  document.querySelector('#sell-catch').addEventListener('click', () => {
    if (onSell()) { invalidateImage(); dialog.close(); }
    else document.querySelector('#catch-sale-error').textContent = '売却できませんでした。保管して続けてください。';
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeResult(); });
  // Also settle platform/programmatic dialog closes; the game operation is
  // idempotent, so repeated close/cancel/click events cannot store twice.
  dialog.addEventListener('close', () => { if (!dialog.open) { invalidateImage(); onClose(); } });
  return {
    update(fishing, active, clock) {
      const s = fishing.state;
      isActive = active;
      // A native close event can arrive after the next animation frame. Settle
      // that result before rendering instead of reopening the closed dialog.
      if (active && previous === PHASE.RESULT && s.phase === PHASE.RESULT && !dialog.open
        && currentRequest?.catchId === s.catch?.id) { invalidateImage(); onClose(); }
      if ((!active || s.phase !== PHASE.RESULT) && currentRequest) invalidateImage();
      if ((!active || s.phase !== PHASE.RESULT) && dialog.open) { dialog.close(); onClose(); }
      if (active && [PHASE.BITE, PHASE.FIGHT, PHASE.LANDING].includes(s.phase)) {
        if (s.encounter && prefetchedEncounter !== s.encounter) {
          prefetchedEncounter = s.encounter;
          loadFishImage(getFishSpecies(s.encounter.speciesId)).catch(() => {});
        }
      } else if (s.phase !== PHASE.RESULT || !active) prefetchedEncounter = null;
      panel.hidden = !active;
      panel.dataset.phase = active ? s.phase : 'inactive';
      app.dataset.fishingPhase = active ? s.phase : 'inactive';
      app.dataset.castView = active && [PHASE.AIM, PHASE.CAST, PHASE.LURE, PHASE.BITE].includes(s.phase);
      prepare.hidden = !active || s.phase !== PHASE.READY;
      prepare.disabled = app.dataset.castPreparing === 'true';
      lurePicker.update(s.lureId, active && s.phase === PHASE.READY);
      cancel.hidden = !active || s.phase !== PHASE.AIM;
      if (!active) { previous = null; return; }
      const environment = document.querySelector('#fishing-conditions');
      const conditions = s.encounter?.conditions ?? ([PHASE.AIM, PHASE.LURE].includes(s.phase) ? fishing.getConditions() : null);
      const timeOfDay = conditions?.timeOfDay ?? clock.timeOfDay;
      const depthNames = { shallow: '浅瀬', mid: '中深度', deep: '深場' };
      environment.dataset.timeOfDay = timeOfDay;
      environment.dataset.depthM = conditions?.depthM ?? '';
      environment.dataset.cycleProgress = clock.cycleProgress;
      environment.textContent = `${s.encounter ? 'アタリ時：' : ''}${timeOfDay === 'day' ? '昼' : '夜'}の時間帯`
        + (conditions?.depthM != null ? ` · 推定水深 ${conditions.depthM.toFixed(1)}m（${depthNames[conditions.depthBand]}）` : '');
      document.querySelector('#return-button').disabled = !fishing.canLeave();
      document.querySelector('#hint').textContent = hints[s.phase];
      document.querySelector('#fishing-note').textContent = s.message;
      const label = app.dataset.castPreparing === 'true' ? '視点を準備中' : labels[s.phase];
      if (status.textContent !== label) status.textContent = label;
      panel.classList.toggle('bite', s.phase === PHASE.BITE);
      distance.hidden = [PHASE.READY, PHASE.RESULT, PHASE.FAILED].includes(s.phase);
      distance.textContent = s.phase === PHASE.AIM ? (s.validCast ? `着水予測 ${s.distance.toFixed(1)} m` : '投げられません') : `残距離 ${s.distance.toFixed(1)} m`;
      fight.hidden = s.phase !== PHASE.FIGHT;
      tension.value = s.tension;
      tension.dataset.level = s.tension > tension.high ? 'high' : s.tension < tension.low ? 'low' : 'safe';
      document.querySelector('#tension-value').textContent = `${Math.round(s.tension * 100)}%`;
      document.querySelector('#tension-warning').textContent = s.tension > 0.78 ? '離して緩める！' : s.tension < 0.18 ? '長押しで巻く！' : 'テンションを保つ';
      document.querySelector('#reel-state').textContent = s.phase === PHASE.LURE ? s.reeling ? '巻き取り中' : s.action > 0 ? 'ルアーアクション' : '待機中' : '';
      if (s.phase === PHASE.RESULT && (!dialog.open || currentRequest?.catchId !== s.catch.id
        || currentRequest?.speciesId !== s.catch.speciesId)) {
        const species = getFishSpecies(s.catch.speciesId);
        showImage(fishing, s.catch);
        document.querySelector('#catch-species').textContent = species.name;
        document.querySelector('#catch-length').textContent = `${s.catch.lengthCm.toFixed(1)} cm`;
        document.querySelector('#catch-weight').textContent = `${s.catch.weightKg.toFixed(2)} kg`;
        document.querySelector('#catch-sale-price').textContent = `売却価格 ${formatMoney(calculateSalePrice(s.catch))}`;
        document.querySelector('#catch-sale-error').textContent = '';
        if (!dialog.open) dialog.showModal();
        close.focus();
      }
      previous = s.phase;
    },
  };
}
