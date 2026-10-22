const NAME_DISTANCE = 40; // presentation only; effect radius comes from data

export function createFishingSpotsHUD() {
  const panel = document.querySelector('#spot-status');
  const name = document.querySelector('#spot-name');
  const effect = document.querySelector('#spot-effect');
  return {
    update(status) {
      const spot = status.active ?? (status.distance <= NAME_DISTANCE ? status.nearest : null);
      panel.hidden = !spot;
      panel.dataset.spotId = spot?.id ?? '';
      panel.dataset.active = String(Boolean(status.active));
      if (!spot) return;
      name.textContent = spot.name;
      effect.textContent = status.active
        ? `アタリ発生率 ×${status.hitMultiplier} · 船が範囲内`
        : `中心まで ${Math.ceil(status.distance)}m · ${spot.radius}m以内で効果`;
    },
  };
}
