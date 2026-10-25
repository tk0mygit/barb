const NOTICE_IDS = ['spot-status', 'sale-notice', 'achievement-notice'];
const OWNED_STYLES = ['left', 'right', 'top', 'bottom', 'transform', 'width'];
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const separated = (a, b, gap) => a.right + gap <= b.left || b.right + gap <= a.left
  || a.bottom + gap <= b.top || b.bottom + gap <= a.top;

// Move only the notices, preserving their contents, text size and lifetimes.
// A current water marker is a moving exclusion region, rather than a reason to
// reject the entire future retrieval path while a temporary notice is shown.
export function placeCastNotices({ width, height, insets = {}, blocked = [], notices }) {
  const edges = { left: 12 + (insets.left ?? 0), top: 12 + (insets.top ?? 0),
    right: width - 12 - (insets.right ?? 0), bottom: height - 12 - (insets.bottom ?? 0) };
  const fits = box => box.left >= edges.left && box.top >= edges.top && box.right <= edges.right && box.bottom <= edges.bottom
    && blocked.every(obstacle => separated(box, obstacle, obstacle.gap ?? 8));
  const preferred = notices.map(notice => ({ ...notice, ...rect(notice.left, notice.top, notice.width, notice.height) }));
  if (preferred.every((box, i) => fits(box) && preferred.slice(0, i).every(other => separated(box, other, 8)))) return preferred;
  const ordered = [...preferred].sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id));
  let budget = 6000;
  function search(index, placed) {
    if (index === ordered.length) return placed;
    const item = ordered[index];
    const obstacles = [...blocked, ...placed.map(box => ({ ...box, gap: 8 }))];
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    // Extra sizes are measured text reflows supplied by the DOM adapter. They
    // never scale text, trim information or invent a height smaller than it is.
    for (const size of [item, ...(item.variants ?? [])]) {
      if (size.width > edges.right - edges.left || size.height > edges.bottom - edges.top) continue;
      const xs = [item.left, edges.left, edges.right - size.width, (edges.left + edges.right - size.width) / 2];
      const ys = [item.top, edges.top, edges.bottom - size.height, (edges.top + edges.bottom - size.height) / 2];
      for (const obstacle of obstacles) {
        const gap = (obstacle.gap ?? 8) + 0.05;
        xs.push(obstacle.right + gap, obstacle.left - gap - size.width);
        ys.push(obstacle.bottom + gap, obstacle.top - gap - size.height);
      }
      const xPositions = [...new Set(xs.map(x => clamp(x, edges.left, edges.right - size.width)))];
      const yPositions = [...new Set(ys.map(y => clamp(y, edges.top, edges.bottom - size.height)))];
      const candidates = xPositions.flatMap(x => yPositions.map(y => rect(x, y, size.width, size.height)))
        .filter(box => fits(box) && placed.every(other => separated(box, other, 8)))
        .sort((a, b) => Math.hypot(a.left - item.left, a.top - item.top) - Math.hypot(b.left - item.left, b.top - item.top)
          || a.top - b.top || a.left - b.left);
      for (const candidate of candidates) {
        if (--budget < 0) return null;
        const result = search(index + 1, [...placed, { id: item.id, ...candidate }]);
        if (result) return result;
      }
    }
    return null;
  }
  const result = search(0, []);
  return result && notices.map(notice => result.find(box => box.id === notice.id));
}

export function createCastNotices(root = document) {
  const app = root.querySelector('#app');
  const elements = NOTICE_IDS.map(id => root.querySelector(`#${id}`));
  const originals = new Map();
  let viewportKey = null;
  function reset() {
    for (const [element, styles] of originals) for (const property of OWNED_STYLES) element.style[property] = styles[property];
    originals.clear();
    viewportKey = null;
  }
  // Achievement messages move into native dialogs before they open. Restore
  // the ordinary dialog layout in that same turn, including while paused.
  for (const dialog of root.querySelectorAll('dialog')) dialog.addEventListener('beforetoggle', reset);
  return {
    reset,
    update(bounds, active) {
      if (!active) { reset(); return true; }
      const style = getComputedStyle(root.documentElement);
      const inset = edge => parseFloat(style.getPropertyValue(`--safe-${edge}`)) || 0;
      const insets = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(edge => [edge, inset(edge)]));
      const nextViewport = JSON.stringify([innerWidth, innerHeight, insets]);
      if (viewportKey !== nextViewport) { reset(); viewportKey = nextViewport; }
      const visible = element => element && element.parentElement === app && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden';
      const notices = elements.filter(visible);
      if (!notices.length) return true;
      if (!bounds || bounds.clipped) return false;
      const blocked = [...root.querySelectorAll('.masthead, .action-panel, #fishing-panel, .telemetry, .edition, .compass, #reticle')]
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
        .map(element => ({ ...element.getBoundingClientRect().toJSON(), gap: 8 }));
      blocked.push({ ...bounds, gap: 12 });
      const options = { width: innerWidth, height: innerHeight, insets, blocked,
        notices: notices.map(element => ({ id: element.id, ...element.getBoundingClientRect().toJSON() })) };
      let positions = placeCastNotices(options);
      if (!positions) {
        const usableWidth = innerWidth - insets.left - insets.right - 24;
        const natural = notices.map(element => {
          const previousWidth = element.style.width;
          element.style.width = originals.get(element)?.width ?? previousWidth;
          const measured = { id: element.id, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height };
          element.style.width = previousWidth;
          return measured;
        });
        const reflowed = options.notices.map(notice => {
          const element = notices.find(item => item.id === notice.id), previousWidth = element.style.width;
          const baseline = natural.find(item => item.id === notice.id);
          const widths = [usableWidth, (usableWidth - 8) / 2,
            ...natural.filter(item => item.id !== notice.id).map(item => usableWidth - 8 - item.width)];
          const variants = [{ width: baseline.width, height: baseline.height }];
          for (const candidateWidth of new Set(widths.filter(width => width >= baseline.width))) {
            element.style.width = `${candidateWidth}px`;
            const { width, height } = element.getBoundingClientRect();
            variants.push({ width, height });
          }
          element.style.width = previousWidth;
          return { ...notice, variants };
        });
        positions = placeCastNotices({ ...options, notices: reflowed });
      }
      if (!positions) return false;
      for (const position of positions) {
        const element = notices.find(notice => notice.id === position.id);
        if (!originals.has(element)) originals.set(element, Object.fromEntries(OWNED_STYLES.map(property => [property, element.style[property]])));
        element.style.left = `${position.left}px`; element.style.top = `${position.top}px`;
        element.style.width = `${position.width}px`;
        element.style.right = element.style.bottom = 'auto'; element.style.transform = 'none';
      }
      return true;
    },
  };
}
