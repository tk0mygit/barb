import { isStopped } from '../game/boat.js';
import { createOpeningTitle } from './opening-title.js';

export function createHUD({ onFish, onReturn, onTimeSkip = () => {}, readTimeSkip = () => ({}) }) {
  const openingTitle = createOpeningTitle();
  const fish = document.querySelector('#fish-button');
  const back = document.querySelector('#return-button');
  const speed = document.querySelector('#speed');
  const motion = document.querySelector('#motion-label');
  const mode = document.querySelector('#mode-label');
  const note = document.querySelector('#fishing-note');
  const reticle = document.querySelector('#reticle');
  const compass = document.querySelector('#compass-needle');
  const skip = document.querySelector('#day-night-skip');
  fish.addEventListener('click', onFish);
  back.addEventListener('click', onReturn);
  skip.addEventListener('click', event => { if (!skip.disabled && event.detail <= 1) onTimeSkip(); });
  return {
    update(boat) {
      const fishing = boat.mode === 'fishing';
      const stopped = isStopped(boat);
      const { enabled, available, active, timeOfDay } = readTimeSkip();
      fish.hidden = fishing || !stopped;
      fish.disabled = fishing || !stopped || Boolean(active);
      back.disabled = Boolean(active);
      back.hidden = !fishing;
      note.hidden = !fishing;
      reticle.hidden = !fishing;
      document.body.classList.toggle('fishing', fishing);
      speed.textContent = (boat.speed * 3.6).toFixed(1);
      mode.textContent = fishing ? 'ON THE WATER' : 'EXPLORING';
      motion.textContent = fishing ? '釣り視点' : stopped ? '停船中' : '航行中';
      compass.style.transform = `rotate(${-boat.heading}rad)`;
      skip.hidden = !enabled || fishing;
      skip.disabled = !available || Boolean(active);
      skip.setAttribute('aria-busy', String(Boolean(active)));
      skip.setAttribute('aria-label', timeOfDay === 'night' ? '昼まで進める' : '夜まで進める');
      skip.querySelector('[data-skip-icon="moon"]').toggleAttribute('hidden', timeOfDay === 'night');
      skip.querySelector('[data-skip-icon="sun"]').toggleAttribute('hidden', timeOfDay !== 'night');
    },
    ready() {
      document.querySelector('#status').hidden = true;
      openingTitle.start();
    },
  };
}
