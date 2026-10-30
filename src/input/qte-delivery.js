import { QTE_TIMING, qteSeconds } from '../game/fight-qte.js';
import { QTE_DELIVERY_CONFIG } from '../game/qte-delivery-config.js';
import { createQteClock } from './qte-clock.js';

// Transport only. An injected evidence consumer belongs to PR-B; no operation
// thresholds, product HUD or operation RNG are implemented here.
export function createQteDelivery({ fishing, clock = createQteClock(), evaluate,
  capacity = QTE_DELIVERY_CONFIG.semanticEdgeCapacity } = {}) {
  if (!fishing || typeof evaluate !== 'function') throw new TypeError('QTE delivery requires a domain and an evidence consumer');
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid semantic capacity');
  const adapter = Object.freeze({}), ledgers = new WeakMap(), seen = new WeakSet();
  const diagnostics = [], counts = {};
  let session = null, ingress = 0, contactSerial = 0, geometryRevision = 0, lifecycle = 0;
  const diagnose = reason => {
    counts[reason] = Math.min(Number.MAX_SAFE_INTEGER, (counts[reason] ?? 0) + 1);
    diagnostics.push(reason);
    if (diagnostics.length > QTE_DELIVERY_CONFIG.diagnosticCapacity) diagnostics.shift();
  };
  const progress = () => fishing.state.fight;
  function refresh() {
    const token = progress()?.qte.token;
    if (!session || !token || token.instance !== session.handle.instance || token.fightId !== session.handle.fightId || token.index !== session.handle.index) return false;
    if (token.generation !== session.token.generation) {
      closeContact('domain-epoch'); lifecycle++; session.display = null; session.preparation = null;
    }
    session.token = token; return true;
  }
  function closeContact(reason) {
    if (session?.contact) {
      session.contact.cancelled = true; session.contact.cancelReason = reason;
      session.retiredPointer = session.contact.pointerId; session.contact = null;
    }
  }
  function evidence() {
    return Object.freeze({ previous: session.checkpoint,
      edges: Object.freeze([...session.edges].sort((a, b) => a.source - b.source || a.serial - b.serial).map(e => Object.freeze({ ...e,
        contact: Object.freeze({ ...e.contact }) }))),
      completedOperations: session.completed, final: false });
  }
  function assess(final) {
    const input = { ...evidence(), final };
    const result = evaluate(Object.freeze(input));
    if (!result || typeof result.success !== 'boolean' || !Number.isInteger(result.completedOperations)
      || result.completedOperations < session.completed || result.completedOperations > 3) throw new TypeError('Invalid QTE evidence checkpoint');
    return result;
  }
  function synchronize(receipt) {
    if (!session || session.status === 'applied' || !refresh() || receipt.suspended) return false;
    return fishing.advanceQteDelivery(session.token, Math.max(0, receipt.active - session.warning) / 1000,
      session.active === null ? null : (session.active - session.warning) / 1000);
  }
  function poll(raw = clock.now(), handle = session?.handle) {
    const receipt = clock.read(raw);
    if (!receipt || !session || handle !== session.handle || session.status === 'applied' || receipt.suspended || !refresh()) return false;
    synchronize(receipt);
    if (session.cut === null || receipt.active < session.cut) return false;
    if (session.status === 'open') {
      closeContact('seal');
      let result;
      try { result = assess(true); } catch { diagnose('consumer-error'); result = { success: false, completedOperations: session.completed }; }
      session.success = !session.unrecoverable && result.success;
      session.completed = result.completedOperations;
      session.status = 'sealed';
      // Input collection is closed independently of domain application.
    }
    const domainCut = progress().elapsedSeconds;
    if (fishing.commitQteDelivery(session.token, session.success)) { session.domainCut = domainCut; session.status = 'applied'; return true; }
    diagnose('domain-commit-rejected'); return false;
  }
  function setSuspended(reason, suspended, raw = clock.now()) {
    const before = clock.reasons.length;
    const receipt = clock.read(raw);
    if (!receipt) { diagnose('invalid-receipt'); return false; }
    // Bring the domain to the suspend boundary before invalidating its token.
    if (!before) { poll(raw); synchronize(receipt); }
    const next = clock.setSuspended(reason, suspended, raw);
    if (!next) return false;
    if (suspended && !before) {
      closeContact(reason); lifecycle++; fishing.pauseFight();
      if (session) session.display = null;
      if (session?.active !== null && session?.deadline > receipt.active) clock.setSuspended('display', true, raw);
    }
    if (!suspended && before && !clock.reasons.length) {
      lifecycle++; fishing.resumeFight(); refresh(); poll(raw);
    }
    return true;
  }
  function interrupt(receipt, reason) {
    closeContact(reason);
    try {
      const checkpoint = assess(false);
      // Only fixed-size completed-operation state survives an interrupt. An
      // evidence consumer cannot turn its checkpoint into an unbounded raw log.
      session.checkpoint = Object.freeze({ completedOperations: checkpoint.completedOperations, success: checkpoint.success });
      session.completed = checkpoint.completedOperations;
      session.provisionalSuccess = checkpoint.success;
    } catch { diagnose('consumer-error'); session.unrecoverable = true; }
    session.unrecoverable ||= session.deadline !== null && receipt.active >= session.deadline;
    session.edges = [];
    session.interrupted = true; diagnose(reason);
    setSuspended('technical', true, receipt.raw);
  }
  function open(warningTimestamp, raw = clock.now()) {
    const receipt = clock.read(raw), fight = progress(), token = fight?.qte.token;
    const source = clock.source(warningTimestamp, receipt);
    if (!receipt || receipt.suspended || !source || source.suspended || source.revision !== receipt.revision
      || !fight?.qte.finiteDelivery || !token || fight.mode !== 'warning') return null;
    let ledger = ledgers.get(token.instance);
    if (!ledger) { ledger = new Map(); ledgers.set(token.instance, ledger); }
    if (ledger.has(token.index)) return ledger.get(token.index).handle;
    const handle = Object.freeze({ adapter, instance: token.instance, fightId: token.fightId, index: token.index });
    session = { handle, token, warning: source.active, active: null, deadline: null, cut: null,
      duration: qteSeconds(fight.difficulty, fight.qte.operation) * 1000, display: null, preparation: null,
      edges: [], contact: null, lastCancelled: null, retiredPointer: null, normalContact: null, completed: 0, checkpoint: undefined,
      provisionalSuccess: false, success: null, status: 'open', interrupted: false, unrecoverable: false, highWater: 0 };
    ledger.set(token.index, session);
    synchronize(receipt); return handle;
  }
  function prepareDisplay(frame, raw = clock.now()) {
    const receipt = clock.read(raw);
    if (!session || session.status !== 'open' || !receipt || !Number.isInteger(frame) || !refresh()) return null;
    session.preparation = Object.freeze({ handle: session.handle, revision: geometryRevision, lifecycle, frame, raw });
    return session.preparation;
  }
  function presentDisplay(preparation, frame, raw = clock.now()) {
    const receipt = clock.read(raw);
    if (!session || !refresh() || preparation !== session.preparation || !receipt || !Number.isInteger(frame) || frame <= preparation.frame
      || preparation.revision !== geometryRevision || session.status !== 'open'
      || clock.reasons.some(reason => !['orientation', 'display'].includes(reason))) return false;
    const warningReady = receipt.active >= session.warning + QTE_TIMING.warningSeconds * 1000;
    if (!warningReady && !clock.reasons.includes('orientation')) return false;
    // Geometry and a later presentation opportunity are explicit. This is not
    // a claim that the physical display has emitted light.
    if (session.active === null && warningReady) {
      session.active = receipt.active; session.deadline = receipt.active + session.duration;
      session.cut = session.deadline + QTE_DELIVERY_CONFIG.receiptGraceMs;
    }
    if (clock.reasons.includes('orientation')) setSuspended('orientation', false, raw);
    if (clock.reasons.includes('display')) setSuspended('display', false, raw);
    session.display = Object.freeze({ revision: geometryRevision, lifecycle, active: receipt.active });
    synchronize(clock.read(raw)); return true;
  }
  function invalidateGeometry(orientation, raw = clock.now()) {
    const receipt = clock.read(raw);
    if (!receipt) return false;
    geometryRevision++; closeContact('geometry');
    if (session) { session.display = null; session.preparation = null; }
    // Viewport jitter invalidates geometry but never pauses or resets A/D/C.
    if (orientation) setSuspended('orientation', true, raw);
    return true;
  }
  function ingest(event, raw = clock.now()) {
    const receipt = clock.read(raw);
    if (!session) return { handled: false, accepted: false };
    if (!receipt) { diagnose('invalid-receipt'); return { handled: true, accepted: false }; }
    if (seen.has(event)) return { handled: true, accepted: false };
    seen.add(event);
    const source = clock.source(event.timeStamp, receipt);
    if (!source || source.suspended || receipt.suspended || source.revision !== receipt.revision) {
      if (session.contact?.pointerId === event.pointerId) closeContact('ambiguous-time');
      diagnose('ambiguous-time'); return { handled: true, accepted: false };
    }
    // Normal fresh down can arrive before the render/timer seals this QTE.
    // Preserve it with its explicit logical boundary rather than the lagging
    // snapshot owner or a rebased normal-input origin.
    if (session.cut !== null && source.active >= session.cut && ['pointercancel', 'lostpointercapture'].includes(event.type)
      && event.pointerId === session.retiredPointer && session.normalContact?.pointerId === event.pointerId
      && source.active <= session.normalContact.source) {
      diagnose('quarantined-normal-control'); return { handled: true, accepted: false };
    }
    if (session.cut !== null && source.active >= session.cut && !['pointercancel', 'lostpointercapture'].includes(event.type)) {
      if (event.type === 'pointerdown') session.normalContact = { pointerId: event.pointerId, source: source.active };
      if (event.type === 'pointerup' && event.pointerId === session.retiredPointer) {
        if (!session.normalContact || session.normalContact.pointerId === event.pointerId && source.active <= session.normalContact.source) {
          diagnose('quarantined-normal-up'); return { handled: true, accepted: false };
        }
        session.retiredPointer = null;
      }
      const normalAt = session.status !== 'applied'
        ? progress()?.qte.delivery?.startSeconds + (source.active - session.warning) / 1000
        : progress()?.renderSeconds === session.domainCut ? session.domainCut + (source.active - session.cut) / 1000 : undefined;
      return { handled: false, accepted: false, normalAt };
    }
    if (session.status === 'applied') return { handled: source.active < session.cut, accepted: false };
    if (!refresh()) { diagnose('stale-domain'); return { handled: true, accepted: false }; }
    if (session.status !== 'open' || session.cut !== null && receipt.active >= session.cut) {
      diagnose('receipt-cut'); return { handled: true, accepted: false };
    }
    const serial = ingress++;
    if (['pointercancel', 'lostpointercapture'].includes(event.type)) {
      // A cancelled contact may already have its up in the ledger. Source
      // ordering at seal must still invalidate it when the cancel arrives late.
      // This bounded scan bypasses edge capacity; no control is dropped.
      const contacts = new Set(session.edges.map(edge => edge.contact));
      for (const contact of contacts) if (contact.pointerId === event.pointerId && source.active >= contact.downSource
        && (contact.upSource === undefined || source.active <= contact.upSource)) {
        contact.cancelled = true; contact.cancelReason = event.type;
        session.lastCancelled = { pointerId: event.pointerId, source: source.active };
        session.retiredPointer = event.pointerId;
        if (session.contact === contact) session.contact = null;
      }
      return { handled: true, accepted: false };
    }
    if (!session.display || session.active === null || source.active < session.active || source.active > session.deadline
      || source.active < session.display.active) return { handled: true, accepted: false };
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      diagnose('invalid-geometry'); closeContact('invalid-geometry'); return { handled: true, accepted: false };
    }
    if (event.type === 'pointerdown') {
      if (event.pointerType === 'mouse' && event.button !== 0 || event.isPrimary === false || session.contact) return { handled: true, accepted: false };
      if (session.edges.length >= capacity) { interrupt(receipt, 'semantic-overflow'); return { handled: true, accepted: false }; }
      const contact = { adapter, instance: session.handle.instance, fightId: session.handle.fightId, index: session.handle.index,
        generation: session.token.generation, lifecycle, serial: ++contactSerial, pointerId: event.pointerId,
        displayRevision: geometryRevision, downSource: source.active, downReceipt: receipt.active,
        startX: event.clientX, startY: event.clientY, endX: event.clientX, endY: event.clientY,
        endSource: source.active, maxDisplacement: 0, maxSource: source.active, cancelled: false };
      session.contact = contact;
      session.edges.push({ type: 'down', source: source.active, receipt: receipt.active,
        sourceRaw: source.raw, receiptRaw: receipt.raw, clockRevision: source.revision, serial, contact });
    } else if (['pointermove', 'pointerup'].includes(event.type)) {
      const contact = session.contact;
      if (!contact || contact.pointerId !== event.pointerId) return { handled: true, accepted: false };
      if (source.active < contact.downSource) { diagnose('old-up-or-move'); return { handled: true, accepted: false }; }
      if (event.type === 'pointerup' && session.lastCancelled?.pointerId === event.pointerId
        && session.lastCancelled.source === contact.downSource && source.active === contact.downSource) {
        closeContact('ambiguous-reused-pointer'); diagnose('ambiguous-contact'); return { handled: true, accepted: false };
      }
      const sample = point => {
        const at = clock.source(point.timeStamp, receipt);
        if (!at || at.revision !== source.revision || at.suspended || at.active < contact.downSource || at.active > session.deadline
          || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) { contact.cancelled = true; diagnose('ambiguous-move'); return; }
        const displacement = Math.hypot(point.clientX - contact.startX, point.clientY - contact.startY);
        if (displacement > contact.maxDisplacement || displacement === contact.maxDisplacement && at.active < contact.maxSource) {
          contact.maxDisplacement = displacement; contact.maxSource = at.active;
        }
        if (at.active >= contact.endSource) { contact.endX = point.clientX; contact.endY = point.clientY; contact.endSource = at.active; }
      };
      // Consume every available coalesced sample into constant-size statistics;
      // do not retain raw paths or use predicted samples as evidence.
      if (event.type === 'pointermove' && typeof event.getCoalescedEvents === 'function') {
        try { for (const child of event.getCoalescedEvents()) sample(child); }
        catch { contact.cancelled = true; diagnose('unreadable-coalesced-move'); }
      }
      sample(event);
      if (event.type === 'pointerup') {
        if (source.active < contact.endSource) { contact.cancelled = true; diagnose('ambiguous-contact-order'); }
        contact.endX = event.clientX; contact.endY = event.clientY; contact.endSource = source.active;
        if (session.edges.length >= capacity) { interrupt(receipt, 'semantic-overflow'); return { handled: true, accepted: false }; }
        contact.upSource = source.active; contact.upReceipt = receipt.active;
        session.edges.push({ type: 'up', source: source.active, receipt: receipt.active,
          sourceRaw: source.raw, receiptRaw: receipt.raw, clockRevision: source.revision, serial, contact });
        session.contact = null;
      }
    } else return { handled: true, accepted: false };
    session.highWater = Math.max(session.highWater, session.edges.length);
    return { handled: true, accepted: true };
  }
  return { clock, open, prepareDisplay, presentDisplay, ingest, poll, setSuspended, invalidateGeometry,
    cancelContact() { closeContact('canvas-cancel'); },
    resumeTechnical(raw = clock.now()) {
      if (!session?.interrupted) return false;
      session.interrupted = false; session.display = null;
      return setSuspended('technical', false, raw);
    },
    get snapshot() {
      return Object.freeze({ handle: session?.handle, status: session?.status ?? 'idle', warning: session?.warning,
        active: session?.active, deadline: session?.deadline, cut: session?.cut,
        remainingMs: session?.deadline === null ? null : Math.max(0, (session?.deadline ?? 0) - (clock.read()?.active ?? 0)),
        edges: session?.edges.length ?? 0, highWater: session?.highWater ?? 0, completedOperations: session?.completed ?? 0,
        provisionalSuccess: session?.provisionalSuccess ?? false, interrupted: session?.interrupted ?? false,
        reasons: clock.reasons, diagnostics: Object.freeze([...diagnostics]), counts: Object.freeze({ ...counts }) });
    } };
}
