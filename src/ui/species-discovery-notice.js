import { FISH_SPECIES, getFishSpecies } from '../game/fish-species.js';
import { getFishTier } from '../game/fish-rarity.js';

export const DISCOVERY_DURATION = 3000;

// The existing artwork remains the only image. All effects share one visible-
// time deadline; WAAPI only paints that timeline and never drives game state.
export function createSpeciesDiscoveryNotice({ cue } = {}) {
  const dialog = document.querySelector('#catch-dialog');
  const frame = dialog.querySelector('.fish-image-frame');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current, disposed = false, blurred = false, pageHidden = false;
  function end(entry = current) {
    if (!entry || current !== entry) return;
    current = undefined;
    clearTimeout(entry.timeout);
    for (const animation of entry.animations) animation.cancel();
    entry.root.remove(); cue?.stop();
    entry.onEnd();
  }
  function animate(entry, node, frames) {
    entry.animations.push(node.animate(frames, { duration: DISCOVERY_DURATION, fill: 'both', easing: 'linear' }));
  }
  function buildAnimations(entry) {
    for (const animation of entry.animations) animation.cancel();
    entry.animations = [];
    entry.root.dataset.reducedMotion = String(reducedMotion.matches);
    if (reducedMotion.matches) return;
    const { root } = entry;
    animate(entry, root, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 5 / 6 }, { opacity: 0, offset: 1 }]);
    const rippleFrames = delay => [
      { transform: 'translate(-50%, -50%) scale(.12)', opacity: 0, offset: 0 },
      { transform: 'translate(-50%, -50%) scale(.12)', opacity: 0, offset: delay },
      { transform: 'translate(-50%, -50%) scale(.85)', opacity: 1, offset: delay + .055 },
      { transform: 'translate(-50%, -50%) scale(1.18)', opacity: .9, offset: delay + .16 },
      { transform: 'translate(-50%, -50%) scale(.65)', opacity: 0, offset: .5 },
      { transform: 'translate(-50%, -50%) scale(.65)', opacity: 0, offset: 1 },
    ];
    root.querySelectorAll('.discovery-ripple').forEach((node, index) => animate(entry, node, rippleFrames(index ? .065 : .001)));
    animate(entry, root.querySelector('.discovery-shade'), [
      { transform: 'scaleY(1)', offset: 0 }, { transform: 'scaleY(1)', offset: 1 / 6 },
      { transform: 'scaleY(0)', offset: .5 }, { transform: 'scaleY(0)', offset: 1 },
    ]);
    animate(entry, root.querySelector('.discovery-scan'), [
      { transform: 'translateY(0)', opacity: 0, offset: 0 },
      { transform: 'translateY(0)', opacity: 1, offset: 1 / 6 },
      { transform: 'translateY(100%)', opacity: 1, offset: .49 },
      { transform: 'translateY(100%)', opacity: 0, offset: .5 },
      { transform: 'translateY(100%)', opacity: 0, offset: 1 },
    ]);
    animate(entry, root.querySelector('.discovery-name'), [
      { opacity: 0, transform: 'translateY(5px)', offset: 0 },
      { opacity: 0, transform: 'translateY(5px)', offset: 1 / 6 },
      { opacity: 1, transform: 'translateY(0)', offset: .38 },
      { opacity: 1, transform: 'translateY(0)', offset: 1 },
    ]);
    animate(entry, root.querySelector('.discovery-registration'), [
      { opacity: 0, offset: 0 }, { opacity: 0, offset: .45 },
      { opacity: 1, offset: .5 }, { opacity: 1, offset: 1 },
    ]);
  }
  function sync() {
    const entry = current;
    if (!entry) return;
    if (!dialog.open) { end(entry); return; }
    const now = performance.now();
    if (entry.runningSince !== null) entry.elapsed = Math.min(DISCOVERY_DURATION, entry.elapsed + Math.max(0, now - entry.runningSince));
    entry.runningSince = null;
    clearTimeout(entry.timeout); entry.timeout = null;
    if (entry.elapsed >= DISCOVERY_DURATION) { end(entry); return; }
    const paused = document.hidden || blurred || pageHidden;
    entry.root.hidden = paused;
    for (const animation of entry.animations) {
      animation.pause(); animation.currentTime = entry.elapsed;
      if (!paused) {
        animation.play();
        // Anchor to the same monotonic deadline. Waiting for WAAPI's pending
        // play task would shift every visual stage by the next paint's delay.
        animation.startTime = now - entry.elapsed;
      }
    }
    if (paused) { cue?.stop(); return; }
    entry.runningSince = now;
    entry.timeout = setTimeout(() => { if (current === entry) sync(); }, DISCOVERY_DURATION - entry.elapsed);
    if (!entry.started) {
      entry.started = true;
      if (entry.rare) { try { cue?.play(); } catch { /* Audio never gates presentation. */ } }
    }
  }
  const blur = () => { blurred = true; sync(); };
  const focus = () => { blurred = false; sync(); };
  const pagehide = () => { pageHidden = true; sync(); };
  const pageshow = () => { pageHidden = false; sync(); };
  const motionChange = () => {
    const entry = current;
    if (!entry) return;
    sync();
    if (current === entry) {
      try { buildAnimations(entry); sync(); } catch { end(entry); }
    }
  };
  const closing = event => { if (event.newState === 'closed') end(); };
  const closed = () => { if (!dialog.open) end(); };
  const contextLost = () => end();
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('pageshow', pageshow);
  window.addEventListener('webglcontextlost', contextLost, true);
  dialog.addEventListener('beforetoggle', closing);
  dialog.addEventListener('close', closed);
  reducedMotion.addEventListener('change', motionChange);
  return {
    show(record, onEnd) {
      end();
      const species = getFishSpecies(record.speciesId);
      if (disposed || !dialog.open || !species) return false;
      const root = document.createElement('div');
      root.className = 'species-discovery'; root.dataset.catchId = record.id;
      const rare = getFishTier(record.speciesId) === 'Rare';
      root.dataset.tier = rare ? 'Rare' : 'ordinary';
      root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite'); root.setAttribute('aria-atomic', 'true');
      const visual = document.createElement('div'); visual.className = 'discovery-visual'; visual.setAttribute('aria-hidden', 'true');
      const span = (className, text = '') => {
        const node = document.createElement('span'); node.className = className; node.textContent = text; return node;
      };
      const label = rare ? '希少種発見' : '新種発見';
      const number = `No.${String(FISH_SPECIES.findIndex(fish => fish.id === species.id) + 1).padStart(2, '0')} / ${FISH_SPECIES.length}`;
      const heading = span('discovery-heading');
      heading.append(span('discovery-english', rare ? 'RARE DISCOVERY' : 'NEW SPECIES'), span('discovery-label', label));
      const copy = span('discovery-copy');
      const registration = span('discovery-registration');
      registration.append(span('discovery-registered', '図鑑登録完了'), span('discovery-number', number));
      copy.append(span('discovery-name', species.name), registration);
      visual.append(span('discovery-shade'), span('discovery-ripple'));
      if (rare) visual.append(span('discovery-ripple discovery-ripple-second'), span('discovery-imprint'));
      visual.append(span('discovery-scan'), heading, copy);
      frame.append(root);
      const entry = current = { root, rare, onEnd, animations: [], timeout: null, elapsed: 0, runningSince: null, started: false };
      try {
        root.append(visual, span('discovery-accessible', `${label}。${species.name}。図鑑登録完了。${number}`));
        buildAnimations(entry); sync();
        return true;
      } catch {
        end(entry); return false;
      }
    },
    recoverFocus: focus,
    cancel: () => end(),
    dispose() {
      if (disposed) return;
      disposed = true; end(); cue?.dispose();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('webglcontextlost', contextLost, true);
      dialog.removeEventListener('beforetoggle', closing); dialog.removeEventListener('close', closed);
      reducedMotion.removeEventListener('change', motionChange);
    },
  };
}
