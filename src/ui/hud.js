import { isStopped } from '../game/boat.js';

export function createHUD({ onFish, onReturn }) {
  const fish = document.querySelector('#fish-button');
  const back = document.querySelector('#return-button');
  const hint = document.querySelector('#hint');
  const speed = document.querySelector('#speed');
  const motion = document.querySelector('#motion-label');
  const mode = document.querySelector('#mode-label');
  const note = document.querySelector('#fishing-note');
  const reticle = document.querySelector('#reticle');
  const compass = document.querySelector('#compass-needle');
  fish.addEventListener('click', onFish);
  back.addEventListener('click', onReturn);
  return {
    update(boat) {
      const fishing = boat.mode === 'fishing';
      const stopped = isStopped(boat);
      fish.hidden = fishing || !stopped;
      fish.disabled = fishing || !stopped;
      back.hidden = !fishing;
      note.hidden = !fishing;
      reticle.hidden = !fishing;
      document.body.classList.toggle('fishing', fishing);
      speed.textContent = (boat.speed * 3.6).toFixed(1);
      mode.textContent = fishing ? 'ON THE WATER' : 'EXPLORING';
      motion.textContent = fishing ? '釣り視点' : stopped ? '停船中' : '航行中';
      hint.textContent = fishing ? 'ドラッグで周囲を見渡す · Escで戻る' : 'ドラッグして操船 · 離すと停船';
      compass.style.transform = `rotate(${-boat.heading}rad)`;
    },
    ready() { document.querySelector('#status').hidden = true; },
  };
}
