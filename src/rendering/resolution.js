const validPositive = value => Number.isFinite(value) && value > 0;

// Stable between resizes; UI and pointer coordinates always remain CSS pixels.
// Keep the desktop ceiling, with a 1.5x / 750k-pixel budget on narrow touch
// screens. The 1x quality floor yields to an intentionally smaller device DPR.
export function calculateRenderResolution({ width, height, devicePixelRatio, coarsePointer = false }) {
  const w = validPositive(width) ? width : 1;
  const h = validPositive(height) ? height : 1;
  const dpr = validPositive(devicePixelRatio) ? devicePixelRatio : 1;
  const mobile = coarsePointer && Math.min(w, h) <= 600;
  const ceiling = mobile ? 1.5 : 1.75;
  const budgetRatio = mobile ? Math.max(1, Math.sqrt(750000 / w / h)) : ceiling;
  return { width: w, height: h, pixelRatio: Math.min(dpr, ceiling, budgetRatio) };
}
