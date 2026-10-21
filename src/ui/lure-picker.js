import { LURES } from '../game/lures.js';

// Small original line icons; UI assets are independent of lure balance data.
const outlines = {
  minnow: 'M5 12 Q17 2 35 10 L43 7 L40 13 L43 18 L34 15 Q17 22 5 12 Z M18 17 V23 Q23 25 24 20',
  crankbait: 'M10 10 Q16 1 29 5 Q40 11 29 19 Q16 23 10 14 L4 18 L2 14 Z M24 20 V24 L28 22',
  worm: 'M4 10 C12 0 17 24 24 14 S34 4 43 13 M4 14 C12 4 17 28 24 18 S34 8 43 17',
  spinnerbait: 'M5 18 L21 4 L35 17 M24 5 Q40 0 43 7 Q33 16 24 5 Z M26 18 H42 M25 21 H40 M28 24 H37',
};

export function createLurePicker(container, onSelect) {
  const buttons = LURES.map(lure => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.lureId = lure.id;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 48 28'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(icon.namespaceURI, 'path');
    path.setAttribute('d', outlines[lure.id]); icon.append(path);
    const label = document.createElement('span'); label.textContent = lure.name;
    button.append(icon, label);
    button.addEventListener('click', () => onSelect(lure.id));
    container.append(button);
    return button;
  });
  return {
    update(lureId, available) {
      container.hidden = !available;
      for (const button of buttons) {
        button.disabled = !available;
        button.setAttribute('aria-pressed', String(button.dataset.lureId === lureId));
      }
    },
  };
}
