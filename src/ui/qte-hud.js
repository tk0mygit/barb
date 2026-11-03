import { calculateQteLayout } from './qte-layout.js';

const labels = { flick: '短く素早くフリック', swipe: '長くスワイプ', tap: '3回タップ', target: '円の中をタップ' };
// One filled shape for every direction; CSS only rotates it, never stretches it.
const arrowShape = '<svg class="qte-arrow-shape" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="M12 36H53V18L86 50 53 82V64H12Z"/></svg>';
const secondArrowShape = arrowShape.replace('qte-arrow-shape', 'qte-arrow-shape qte-arrow-secondary');
const directionNames = { up: '上', right: '右', down: '下', left: '左' };
const rect = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const finiteRect = r => r && Object.values(r).every(Number.isFinite)
  && r.right > r.left && r.bottom > r.top && Number.isFinite(r.right - r.left) && Number.isFinite(r.bottom - r.top);
const effectiveBounds = ({ canvas, safe }) => {
  if (!finiteRect(canvas) || !finiteRect(safe)) return null;
  const bounds = { left: Math.max(canvas.left, safe.left), top: Math.max(canvas.top, safe.top),
    right: Math.min(canvas.right, safe.right), bottom: Math.min(canvas.bottom, safe.bottom) };
  return finiteRect(bounds) ? bounds : null;
};

// Visual guidance only. Native canvas input and all delivery clocks stay with
// their existing owners; the HUD owns no pointer, timer or gameplay RNG.
export function createQteHUD({ fishing, delivery, provider, canvas = document.querySelector('#scene'), root = document.querySelector('#app'),
  manageGeometry = true, autoPresent = true }) {
  const panel = document.createElement('section');
  panel.className = 'qte-hud'; panel.hidden = true; panel.setAttribute('aria-label', 'ファイト補助操作');
  panel.innerHTML = '<strong class="qte-state" role="status" aria-live="polite"></strong><p class="qte-instruction"></p>'
    + '<div class="qte-gesture" aria-hidden="true"><span class="qte-arrow">' + arrowShape + secondArrowShape + '</span>'
    + '<span class="qte-target"></span><span class="qte-taps"></span></div>'
    + '<div class="qte-timer"><progress max="1" value="1" aria-label="操作の残り時間"></progress><span></span></div>';
  const safeProbe = document.createElement('div'); safeProbe.className = 'qte-safe-probe'; safeProbe.setAttribute('aria-hidden', 'true');
  root.append(safeProbe, panel);
  const state = panel.querySelector('.qte-state'), instruction = panel.querySelector('.qte-instruction');
  const gesture = panel.querySelector('.qte-gesture'), arrow = panel.querySelector('.qte-arrow');
  const secondArrow = panel.querySelector('.qte-arrow-secondary');
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
    // Other HUD rectangles no longer affect this centered layout. Including
    // them in the signature would discard contacts during a 0.5s operation.
    return { canvas: rect(canvas.getBoundingClientRect()), safe };
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
    const measurements = measure(), bounds = effectiveBounds(measurements);
    // Raw canvas/safe edges outside their intersection cannot move this QTE.
    const nextSignature = JSON.stringify(bounds);
    if (signature !== nextSignature) {
      if (signature !== null) delivery.invalidateGeometry(false, delivery.clock.now());
      signature = nextSignature; preparation = null; layout = calculateQteLayout(measurements); actualGeometry = null;
    }
    if (!layout) {
      panel.dataset.state = 'layout-unavailable';
      state.textContent = '操作スペースを確保できません'; instruction.textContent = '画面の向きや表示サイズを確認してください';
      panel.classList.add('qte-layout-unavailable'); gesture.hidden = true;
      for (const property of ['left', 'top', 'width', 'height', 'maxHeight', 'overflow']) panel.style[property] = '';
      if (bounds && bounds.right - bounds.left > 16 && bounds.bottom - bounds.top > 16) {
        Object.assign(panel.style, { left: `${(bounds.left + bounds.right) / 2}px`, top: `${(bounds.top + bounds.bottom) / 2}px`,
          width: `${Math.min(280, bounds.right - bounds.left - 16)}px`, maxHeight: `${bounds.bottom - bounds.top - 16}px`, overflow: 'hidden' });
      }
      return;
    }
    panel.classList.remove('qte-layout-unavailable');
    panel.style.maxHeight = ''; panel.style.overflow = '';
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
    const nextGeometry = Object.freeze({ region: Object.freeze(rect(gesture.getBoundingClientRect())),
      target: Object.freeze(descriptor.operation === 'target'
        ? { x: (circle.left + circle.right) / 2, y: (circle.top + circle.bottom) / 2 } : t) });
    // An ancestor's CSS zoom/transform can change actual client coordinates
    // while leaving canvas/safe intersection measurements unchanged.
    if (actualGeometry && JSON.stringify(actualGeometry) !== JSON.stringify(nextGeometry)) {
      delivery.invalidateGeometry(false, delivery.clock.now()); preparation = null;
    }
    actualGeometry = nextGeometry;
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
      : operation === 'target' ? '円内タップ · 半径 マウス32／タッチ40px' : `${descriptor.direction ? directionNames[descriptor.direction] + 'へ ' : ''}${labels[operation]}`;
    gesture.hidden = false; arrow.hidden = !['flick', 'swipe'].includes(operation);
    // SVGElement has no HTMLElement.hidden property; set its presentation
    // directly so the second real SVG is absent from flick's visible shape.
    secondArrow.style.display = operation === 'swipe' ? '' : 'none';
    target.hidden = operation !== 'target'; taps.hidden = operation !== 'tap';
    arrow.dataset.direction = descriptor.direction ?? '';
    // The circle follows the primary pointer's visual diameter; the guide
    // states both unchanged scoring radii for hybrid mouse/touch devices.
    taps.textContent = `${preview.completedOperations}/3 ${'●'.repeat(preview.completedOperations)}${'○'.repeat(3 - preview.completedOperations)}`;
    const duration = snapshot.deadline - snapshot.active;
    panel.dataset.urgent = String(snapshot.active !== null && snapshot.remainingMs <= Math.min(300, duration * .3));
    progress.value = snapshot.active === null ? 1 : Math.max(0, Math.min(1, snapshot.remainingMs / duration));
    time.textContent = snapshot.active === null ? '準備中' : `${(snapshot.remainingMs / 1000).toFixed(1)}秒`;
  }
  return { update, present, get geometry() { return layout && Object.freeze({ ...layout, ...actualGeometry }); }, get element() { return panel; },
    resumeTechnical: raw => delivery.resumeTechnical(raw),
    dispose() { disposed = true; panel.remove(); safeProbe.remove(); window.removeEventListener('resize', resized);
      window.removeEventListener('orientationchange', rotated); window.screen.orientation?.removeEventListener('change', rotated); } };
}
