// Centre this QTE on the canvas/safe/visual viewport intersection supplied by
// the HUD. Existing HUD may overlap it; decorative HUD is not an obstacle.
// All coordinates remain in client CSS pixels, without integer rounding.
export function calculateQteLayout(measurements) {
  const { canvas, safe } = measurements ?? {};
  const finiteRect = r => r && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(r[key]))
    && r.right > r.left && r.bottom > r.top && Number.isFinite(r.right - r.left) && Number.isFinite(r.bottom - r.top);
  if (!finiteRect(canvas) || !finiteRect(safe)) return null;
  const bounds = { left: Math.max(canvas.left, safe.left) + 8, top: Math.max(canvas.top, safe.top) + 8,
    right: Math.min(canvas.right, safe.right) - 8, bottom: Math.min(canvas.bottom, safe.bottom) - 8 };
  const availableWidth = bounds.right - bounds.left, availableHeight = bounds.bottom - bounds.top;
  if (!Number.isFinite(availableWidth) || !Number.isFinite(availableHeight)) return null;
  // 94% also enlarges the old 272px region on a 360px portrait with 24px
  // safe sides. Vertical space reserves equal room for the quiet foreground.
  const width = Math.min(720, availableWidth * .94), height = Math.min(440, availableHeight * .9);
  if (width < 216 || height < 208) return null;
  const left = bounds.left + (availableWidth - width) / 2, top = bounds.top + (availableHeight - height) / 2;
  const panel = Object.freeze({ left, top, right: left + width, bottom: top + height });
  const region = Object.freeze({ left: panel.left, right: panel.right, top: panel.top + 44, bottom: panel.bottom - 44 });
  return Object.freeze({ compact: height < 300, panel, region,
    target: Object.freeze({ x: (region.left + region.right) / 2, y: (region.top + region.bottom) / 2 }) });
}
