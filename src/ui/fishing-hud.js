import { PHASE } from '../game/fishing.js';
import { getFishSpecies } from '../game/fish-species.js';
import { createLurePicker } from './lure-picker.js';

const labels = { ready: 'キャスト前', aim: 'キャスト準備', cast: 'キャスト中', lure: 'アタリを待つ', bite: 'アタリ！ 今すぐタップ', fight: 'ファイト', landing: 'ランディング', result: '釣り上げました', failed: '魚が逃げました' };
const hints = {
  ready: '画面をドラッグして視線調整 → キャスト準備',
  aim: '画面をドラッグ：左右で方向・長さで飛距離 → 離して投げる',
  cast: '着水を待っています…', lure: '長押しで巻く · 短くフリックして誘う · 離して待つ',
  bite: 'いったん離して、1秒以内に画面をタップ！',
  fight: '長押しで引く · 高くなったら離す · 緩めすぎに注意',
  landing: 'もうすぐ、釣り上がります', failed: 'まもなく再挑戦できます', result: '',
};
export function createFishingHUD({ onPrepare, onCancel, onClose, onSelectLure }) {
  const panel = document.querySelector('#fishing-panel');
  const status = document.querySelector('#fishing-state');
  const prepare = document.querySelector('#cast-button');
  const cancel = document.querySelector('#cancel-cast');
  const distance = document.querySelector('#line-distance');
  const tension = document.querySelector('#line-tension');
  const fight = document.querySelector('#fight-gauge');
  const dialog = document.querySelector('#catch-dialog');
  const close = document.querySelector('#close-catch');
  const lurePicker = createLurePicker(document.querySelector('#lure-picker'), onSelectLure);
  let previous = null;
  prepare.addEventListener('click', onPrepare);
  cancel.addEventListener('click', onCancel);
  const closeResult = () => { onClose(); dialog.close(); };
  close.addEventListener('click', closeResult);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeResult(); });
  // Also settle platform/programmatic dialog closes; the game operation is
  // idempotent, so repeated close/cancel/click events cannot store twice.
  dialog.addEventListener('close', () => { if (!dialog.open) onClose(); });
  return {
    update(fishing, active, clock) {
      const s = fishing.state;
      // A native close event can arrive after the next animation frame. Settle
      // that result before rendering instead of reopening the closed dialog.
      if (active && previous === PHASE.RESULT && s.phase === PHASE.RESULT && !dialog.open) onClose();
      panel.hidden = !active;
      panel.dataset.phase = active ? s.phase : 'inactive';
      prepare.hidden = !active || s.phase !== PHASE.READY;
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
      document.querySelector('#fishing-note').textContent = s.message || (s.phase === PHASE.AIM ? '視点固定中 · 大きくドラッグすると遠投' : '');
      if (previous !== s.phase) status.textContent = labels[s.phase];
      panel.classList.toggle('bite', s.phase === PHASE.BITE);
      distance.hidden = [PHASE.READY, PHASE.RESULT, PHASE.FAILED].includes(s.phase);
      distance.textContent = s.phase === PHASE.AIM ? (s.validCast ? `着水予測 ${s.distance.toFixed(1)} m` : '投げられません · 湖側へ向きを調整') : `残距離 ${s.distance.toFixed(1)} m`;
      fight.hidden = s.phase !== PHASE.FIGHT;
      tension.value = s.tension;
      document.querySelector('#tension-value').textContent = `${Math.round(s.tension * 100)}%`;
      document.querySelector('#tension-warning').textContent = s.tension > 0.78 ? '離して緩める！' : s.tension < 0.18 ? '長押しで巻く！' : 'テンションを保つ';
      document.querySelector('#reel-state').textContent = s.phase === PHASE.LURE ? s.reeling ? '巻き取り中' : s.action > 0 ? 'ルアーアクション' : '待機中' : '';
      if (s.phase === PHASE.RESULT && !dialog.open) {
        const species = getFishSpecies(s.catch.speciesId);
        document.querySelector('#catch-species').textContent = species.name;
        const image = document.querySelector('#catch-image');
        image.src = species.image;
        image.alt = `${species.name}の側面イラスト`;
        document.querySelector('#catch-length').textContent = `${s.catch.lengthCm.toFixed(1)} cm`;
        document.querySelector('#catch-weight').textContent = `${s.catch.weightKg.toFixed(2)} kg`;
        dialog.showModal(); close.focus();
      } else if (s.phase !== PHASE.RESULT && dialog.open) dialog.close();
      previous = s.phase;
    },
  };
}
