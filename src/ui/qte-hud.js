import { calculateQteLayout } from './qte-layout.js';
import { QTE_DIRECTIONS } from '../game/qte-operations.js';

const obstacleSelectors = '.masthead, .action-panel, #fishing-panel, #reticle, .compass, .telemetry, .edition, #spot-status, #sale-notice, #achievement-notice';
const labels = { flick: '短く素早くフリック', swipe: '長くスワイプ', tap: '3回タップ', target: '円の中をタップ' };
const arrows = { up: '↑', right: '→', down: '↓', left: '←' };
const directionNames = { up: '上', right: '右', down: '下', left: '左' };
const rect = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

// Explicit, opt-in component. The standard/new/restored game never constructs
// it in this phase. It owns no pointer, audio, image, timer or gameplay RNG.
export function createQteHUD({ fishing, delivery, provider, canvas = document.querySelector('#scene'), root = document.querySelector('#app'),
  manageGeometry = true, autoPresent = true }) {
  const panel = document.createElement('section');
  panel.className = 'qte-hud'; panel.hidden = true; panel.setAttribute('aria-label', 'ファイト補助操作');
  panel.innerHTML = '<strong class="qte-state" role="status" aria-live="polite"></strong><p class="qte-instruction"></p>'
    + '<div class="qte-gesture" aria-hidden="true"><span class="qte-arrow"></span><span class="qte-endpoint">◎</span>'
    + '<span class="qte-target"><span></span></span><span class="qte-taps"></span></div>'
    + '<div class="qte-timer"><progress max="1" value="1" aria-label="操作の残り時間"></progress><span></span></div>';
  const safeProbe = document.createElement('div'); safeProbe.className = 'qte-safe-probe'; safeProbe.setAttribute('aria-hidden', 'true');
  root.append(safeProbe, panel);
  const state = panel.querySelector('.qte-state'), instruction = panel.querySelector('.qte-instruction');
  const gesture = panel.querySelector('.qte-gesture'), arrow = panel.querySelector('.qte-arrow'), endpoint = panel.querySelector('.qte-endpoint');
  const target = panel.querySelector('.qte-target'), taps = panel.querySelector('.qte-taps');
  const progress = panel.querySelector('progress'), time = panel.querySelector('.qte-timer span');
  let signature = null, layout = null, actualGeometry = null, preparation = null, handle = null, resultUntil = null, disposed = false;
  const invalidate = orientation => {
    delivery.invalidateGeometry(orientation); signature = null; preparation = null;
  };
  const resized = () => invalidate(false), rotated = () => invalidate(true);
  if (manageGeometry) {
    window.addEventListener('resize', resized);
    window.addEventListener('orientationchange', rotated);
    window.screen.orientation?.addEventListener('change', rotated);
  }
  function present(frameId, raw = delivery.clock.now()) {
    const snapshot = delivery.snapshot;
    if (!preparation || preparation.handle !== snapshot.handle || preparation.revision !== snapshot.geometryRevision
      || preparation.lifecycle !== snapshot.lifecycle) { preparation = null; return false; }
    const result = delivery.presentDisplay(preparation, frameId, delivery.clock.now());
    if (result) preparation = null;
    return result;
  }
  function measure() {
    const viewport = window.visualViewport;
    const safe = rect(safeProbe.getBoundingClientRect());
    if (viewport) {
      safe.left = Math.max(safe.left, viewport.offsetLeft); safe.top = Math.max(safe.top, viewport.offsetTop);
      safe.right = Math.min(safe.right, viewport.offsetLeft + viewport.width); safe.bottom = Math.min(safe.bottom, viewport.offsetTop + viewport.height);
    }
    return { canvas: rect(canvas.getBoundingClientRect()), safe, obstacles: [...root.querySelectorAll(obstacleSelectors)]
      .filter(el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0; })
      .map(el => rect(el.getBoundingClientRect())).filter(r => r.right > r.left && r.bottom > r.top) };
  }
  function update(frameId, raw = delivery.clock.now()) {
    if (disposed) return;
    let snapshot = delivery.snapshot;
    if (fishing.state.phase !== 'fight' || !snapshot.handle || !fishing.state.fight?.qte.finiteDelivery) { panel.hidden = true; return; }
    if (snapshot.handle !== handle) { handle = snapshot.handle; signature = null; preparation = null; resultUntil = null; }
    const descriptor = provider.getDescriptor(handle.index);
    const applied = snapshot.status === 'applied';
    if (applied) { resultUntil ??= raw + 450; if (raw >= resultUntil) { panel.hidden = true; return; } }
    panel.hidden = false; panel.dataset.operation = descriptor.operation;
    const measurements = measure(), nextSignature = JSON.stringify(measurements);
    if (signature !== nextSignature) {
      if (signature !== null) delivery.invalidateGeometry(false, delivery.clock.now());
      signature = nextSignature; preparation = null; layout = calculateQteLayout(measurements); actualGeometry = null;
    }
    if (!layout) {
      panel.dataset.state = 'layout-unavailable';
      state.textContent = '操作スペースを確保できません'; instruction.textContent = '画面の向きや表示サイズを確認してください';
      panel.classList.add('qte-layout-unavailable'); gesture.hidden = true;
      return;
    }
    panel.classList.remove('qte-layout-unavailable');
    panel.dataset.compact = String(layout.compact);
    const { panel: p, region: r, target: t } = layout;
    Object.assign(panel.style, { left: `${p.left}px`, top: `${p.top}px`, width: `${p.right - p.left}px`, height: `${p.bottom - p.top}px` });
    Object.assign(gesture.style, { left: `${r.left - p.left}px`, top: `${r.top - p.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    gesture.hidden = false; target.hidden = descriptor.operation !== 'target';
    target.style.left = `${t.x - r.left}px`; target.style.top = `${t.y - r.top}px`;
    // Freeze what CSS actually laid out, including subpixel quantization at
    // fractional zoom/insets. Desired layout coordinates alone are not proof
    // that the displayed scoring circle has that exact client-pixel centre.
    const circle = target.getBoundingClientRect();
    actualGeometry = Object.freeze({ region: Object.freeze(rect(gesture.getBoundingClientRect())),
      target: Object.freeze(descriptor.operation === 'target'
        ? { x: (circle.left + circle.right) / 2, y: (circle.top + circle.bottom) / 2 } : t) });
    snapshot = delivery.snapshot;
    const blocked = snapshot.reasons.some(reason => !['orientation', 'display'].includes(reason));
    if (!applied && !blocked && !snapshot.displayReady) {
      if (autoPresent && preparation && preparation.revision === snapshot.geometryRevision && preparation.lifecycle === snapshot.lifecycle) {
        if (delivery.presentDisplay(preparation, frameId, delivery.clock.now())) preparation = null;
      } else if (preparation && (preparation.revision !== snapshot.geometryRevision || preparation.lifecycle !== snapshot.lifecycle)) preparation = null;
      // Snapshot/DOM reads may already have sampled the monotonic clock after
      // the frame timestamp. Stamp this boundary at the actual call, never
      // feed an earlier render timestamp back into the delivery clock.
      if (!preparation && !delivery.snapshot.displayReady) preparation = delivery.prepareDisplay(frameId, delivery.clock.now(), actualGeometry);
    }
    snapshot = delivery.snapshot;
    const preview = delivery.preview(), operation = descriptor.operation;
    const mode = applied ? snapshot.success ? 'success' : 'failure' : snapshot.interrupted ? 'interrupted'
      : blocked ? 'suspended' : !snapshot.displayReady && snapshot.active !== null ? 'awaiting-display'
      : !snapshot.displayReady || snapshot.active === null ? 'warning'
      : snapshot.remainingMs === 0 ? 'awaiting-result' : 'active';
    panel.dataset.state = mode; panel.dataset.geometryRevision = String(snapshot.geometryRevision);
    state.textContent = { warning: '予告 · まだ触れないで', active: 'いま操作！', 'awaiting-display': '↻ 再開表示を準備中', 'awaiting-result': '入力の確定待ち',
      success: '✓ 成功', failure: '× 時間切れ', interrupted: 'Ⅱ 入力の混雑で一時停止', suspended: 'Ⅱ 一時停止 · 復帰待ち' }[mode];
    if (layout.compact && mode === 'warning') state.textContent = '予告 · 触れずに待つ';
    if (layout.compact && mode === 'interrupted') state.textContent = 'Ⅱ 入力混雑 · 待機';
    instruction.textContent = snapshot.interrupted ? '画面をタップして残り時間から再開'
      : operation === 'target' ? '円内タップ（マウスは内円）' : `${descriptor.direction ? directionNames[descriptor.direction] + 'へ ' : ''}${labels[operation]}`;
    gesture.hidden = false; arrow.hidden = endpoint.hidden = !['flick', 'swipe'].includes(operation);
    target.hidden = operation !== 'target'; taps.hidden = operation !== 'tap';
    arrow.textContent = arrows[descriptor.direction] ?? '';
    arrow.dataset.direction = descriptor.direction ?? '';
    const vector = QTE_DIRECTIONS[descriptor.direction] ?? { x: 0, y: 0 };
    endpoint.style.left = `calc(50% + ${vector.x * 40}px)`; endpoint.style.top = `calc(50% + ${vector.y * 40}px)`;
    // Two concentric hit circles are both visible on hybrid mouse/touch PCs.
    // Their fixed 64/80px diameters exactly match the two scoring radii.
    taps.textContent = `${preview.completedOperations}/3 ${'●'.repeat(preview.completedOperations)}${'○'.repeat(3 - preview.completedOperations)}`;
    const duration = snapshot.deadline - snapshot.active;
    progress.value = snapshot.active === null ? 1 : Math.max(0, Math.min(1, snapshot.remainingMs / duration));
    time.textContent = snapshot.active === null ? '準備中' : `${(snapshot.remainingMs / 1000).toFixed(1)}秒`;
  }
  return { update, present, get geometry() { return layout && Object.freeze({ ...layout, ...actualGeometry }); }, get element() { return panel; },
    resumeTechnical: raw => delivery.resumeTechnical(raw),
    dispose() { disposed = true; panel.remove(); safeProbe.remove(); window.removeEventListener('resize', resized);
      window.removeEventListener('orientationchange', rotated); window.screen.orientation?.removeEventListener('change', rotated); } };
}
