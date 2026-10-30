// Find a canvas rectangle without moving or hiding existing HUD. Rectangles
// remain in client CSS pixels, including safe/visual viewport intersections.
export function calculateQteLayout({ canvas, safe, obstacles = [] }) {
  const bounds = { left: Math.max(canvas.left, safe.left) + 8, top: Math.max(canvas.top, safe.top) + 8,
    right: Math.min(canvas.right, safe.right) - 8, bottom: Math.min(canvas.bottom, safe.bottom) - 8 };
  if (!Object.values(bounds).every(Number.isFinite)) return null;
  let spaces = [bounds];
  const fits = r => r.right - r.left >= 216 && r.bottom - r.top >= 104;
  for (const obstacle of obstacles) {
    const o = { left: obstacle.left - 8, top: obstacle.top - 8, right: obstacle.right + 8, bottom: obstacle.bottom + 8 };
    const next = [];
    for (const r of spaces) {
      if (o.right <= r.left || o.left >= r.right || o.bottom <= r.top || o.top >= r.bottom) { next.push(r); continue; }
      next.push({ ...r, right: Math.min(r.right, o.left) }, { ...r, left: Math.max(r.left, o.right) },
        { ...r, bottom: Math.min(r.bottom, o.top) }, { ...r, top: Math.max(r.top, o.bottom) });
    }
    spaces = next.filter(fits).filter((r, i, all) => !all.some((other, j) => j !== i
      && other.left <= r.left && other.top <= r.top && other.right >= r.right && other.bottom >= r.bottom
      && (j < i || other.left < r.left || other.top < r.top || other.right > r.right || other.bottom > r.bottom)));
  }
  const area = r => (r.right - r.left) * (r.bottom - r.top);
  spaces = spaces.filter(fits).sort((a, b) => area(b) - area(a) || a.top - b.top || a.left - b.left);
  if (!spaces.length) return null;
  const free = spaces[0], compact = free.bottom - free.top < 156;
  const width = Math.min(compact ? 420 : 304, free.right - free.left), height = Math.min(216, free.bottom - free.top);
  const left = (free.left + free.right - width) / 2, top = (free.top + free.bottom - height) / 2;
  const panel = Object.freeze({ left, top, right: left + width, bottom: top + height });
  const region = Object.freeze({ left: compact ? panel.right - 108 : panel.left + 12, right: panel.right - 12,
    top: panel.top + (compact ? 8 : 52), bottom: panel.bottom - (compact ? 16 : 24) });
  return Object.freeze({ compact, panel, region, target: Object.freeze({ x: (region.left + region.right) / 2, y: (region.top + region.bottom) / 2 }) });
}
