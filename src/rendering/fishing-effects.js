import * as THREE from 'three';

// Display-only seconds and randomness. No game/input clock or domain RNG.
export const SURFACE_SEED = 0x5f1b2026;
export const SURFACE_POOL_SIZE = 6;
const DROPS = 12, SEGMENTS = 24;
const styles = Object.freeze({
  landing: { life: .76, height: .78, radius: .78, width: .047 },
  bite: { life: .86, height: 1.08, radius: 1.02, width: .059 },
  reel: { life: .64, height: .48, radius: .49, width: .037 },
});
let uuidConstructionActive = false;
let uuidFactoryActive = false;

// Same displacement as the existing rotated lake PlaneGeometry. A small
// clearance keeps thin arcs above its tessellated wave, with real boat depth.
export function surfaceHeight(x, z, elapsed) {
  return Math.sin(x * .12 + elapsed * .8) * Math.cos(-z * .15 + elapsed * .5) * .09;
}

export function createSurfaceTimeline({ seed = SURFACE_SEED } = {}) {
  let rng = seed >>> 0, previousPhase = null, previousRevision = null, previousTime = null;
  let wasActive = false, wasReeling = false, nextAt = Infinity, serial = 0;
  const counts = { landing: 0, bite: 0, reel: 0 };
  const events = Array.from({ length: SURFACE_POOL_SIZE }, () => ({
    kind: null, serial: 0, born: 0, life: 0, x: 0, z: 0, size: 1,
    drops: new Float64Array(DROPS * 4),
  }));
  const random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const interval = () => .15 + random() * .20;
  const clear = () => { for (const event of events) event.kind = null; nextAt = Infinity; wasReeling = false; };
  function spawn(kind, born, x, z) {
    let slot = events.find(event => !event.kind);
    if (!slot) {
      // A reel burst may retire an older reel burst, never the distinct
      // landing/BITE one-shot while it is still within its bounded lifetime.
      for (const event of events) if ((kind !== 'reel' || event.kind === 'reel')
        && (!slot || event.serial < slot.serial)) slot = event;
    }
    if (!slot) return;
    const style = styles[kind];
    slot.kind = kind; slot.serial = ++serial; slot.born = born; slot.life = style.life;
    slot.size = .9 + random() * .2;
    const jitter = kind === 'reel' ? .22 : 0;
    slot.x = x + (random() - .5) * jitter; slot.z = z + (random() - .5) * jitter;
    for (let i = 0; i < DROPS; i++) {
      slot.drops[i * 4] = (i + random() * .65) * Math.PI * 2 / DROPS;
      slot.drops[i * 4 + 1] = .5 + random() * .5;
      slot.drops[i * 4 + 2] = .55 + random() * .45;
      slot.drops[i * 4 + 3] = .7 + random() * .3;
    }
    counts[kind]++;
  }
  return {
    events, counts,
    get randomState() { return rng; },
    get nextAt() { return nextAt; },
    clear,
    update(state, active, elapsed, x, z) {
      const delta = previousTime === null ? 0 : elapsed - previousTime;
      const allowed = active && (state.phase === 'lure' || state.phase === 'bite' || state.phase === 'fight');
      for (const event of events) if (event.kind && elapsed - event.born >= event.life) event.kind = null;
      const continuous = delta >= 0 && delta <= .3 + 1e-9;
      if (!allowed || !continuous) clear();
      if (allowed && continuous) {
        if (wasActive && state.revision === previousRevision + 1) {
          if (previousPhase === 'cast' && state.phase === 'lure') spawn('landing', elapsed, state.target.x, state.target.z);
          else if (previousPhase === 'lure' && state.phase === 'bite') spawn('bite', elapsed, x, z);
        }
        const reeling = state.phase === 'fight' && state.reeling === true;
        if (!reeling) { nextAt = Infinity; wasReeling = false; }
        else if (!wasReeling) { nextAt = elapsed + interval(); wasReeling = true; }
        else {
          // Bounded by a .3s accepted display gap and the .15s minimum
          // interval (at most two events). Scheduled birth times remove FPS
          // quantization; long gaps/restarts discard backlog above.
          while (elapsed + 1e-10 >= nextAt) {
            const born = nextAt;
            spawn('reel', born, x, z);
            nextAt = born + interval();
          }
        }
      }
      wasActive = Boolean(active); previousPhase = state.phase;
      previousRevision = state.revision; previousTime = elapsed;
    },
  };
}

export function createFishingEffects({ seed = SURFACE_SEED } = {}) {
  function allocateResources() {
    if (uuidFactoryActive || uuidConstructionActive) throw new Error('STOP: reentrant surface UUID construction');
    uuidFactoryActive = true;
    let group, material, geometry, batch;
    try {
      const crypto = globalThis.crypto, fill = crypto?.getRandomValues;
      if (typeof fill !== 'function') throw new Error('STOP: surface UUID construction requires crypto.getRandomValues');
      const uuidWords = new Uint32Array(16);
      // Initial entropy is obtained before replacing Math.random. Refill uses only
      // the same native synchronous crypto operation, never the saved domain RNG.
      function refillUuidWords() {
        if (fill.call(crypto, uuidWords) !== uuidWords) throw new Error('STOP: asynchronous/invalid UUID entropy source');
      }
      refillUuidWords();
      let uuidCursor = 0;
      function visualUuidRandom() {
        if (uuidCursor === uuidWords.length) { refillUuidWords(); uuidCursor = 0; }
        return uuidWords[uuidCursor++] / 4294967296;
      }
      // PM's narrow exception: only these four synchronous Three.js constructors.
      // No callback argument, scene connection, buffer update, render or async work
      // can enter this private helper. Each constructor restores the exact caller
      // function before returning, checking its result, or running any cleanup.
      function construct(kind) {
        if (uuidConstructionActive) throw new Error('STOP: nested surface UUID construction');
        const originalRandom = Math.random;
        let object;
        uuidConstructionActive = true;
        try {
          Math.random = visualUuidRandom;
          switch (kind) {
            case 'group': object = new THREE.Group(); break;
            case 'material': object = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
              side: THREE.DoubleSide, forceSinglePass: true, depthTest: true, depthWrite: false }); break;
            case 'geometry': object = new THREE.BufferGeometry(); break;
            case 'mesh': object = new THREE.Mesh(geometry, material); break;
            default: throw new Error('STOP: unknown surface constructor');
          }
        } finally {
          Math.random = originalRandom;
          uuidConstructionActive = false;
        }
        if (object && typeof object.then === 'function') throw new Error('STOP: asynchronous surface constructor');
        return object;
      }
      group = construct('group');
      material = construct('material');
      geometry = construct('geometry');
      batch = construct('mesh');
      return { group, material, geometry, batch };
    } catch (error) {
      geometry?.dispose(); material?.dispose();
      throw error;
    } finally {
      uuidFactoryActive = false;
    }
  }
  const { group, material, geometry, batch } = allocateResources();
  group.name = 'fishing-surface-effects'; group.visible = false;
  const timeline = createSurfaceTimeline({ seed });
  // RGBA vertex colors share one built-in fog-aware program and one batch.
  // forceSinglePass prevents DoubleSide transparency adding a second draw.
  // 6 * (2 rings * 24 segments * 2 triangles + 12 drops * 8 faces)
  // = 1152 triangles at the fixed maximum, independent of live pool count.
  const triangles = SURFACE_POOL_SIZE * (2 * SEGMENTS * 2 + DROPS * 8);
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triangles * 9), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(triangles * 12), 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, triangles * 3);
  geometry.computeBoundingSphere();
  batch.name = 'fishing-water-effects'; batch.visible = false; batch.renderOrder = .75;
  group.add(batch);
  const rippleVertices = SURFACE_POOL_SIZE * 2 * SEGMENTS * 6;
  const pale = new THREE.Color('#adcfd1'), dark = new THREE.Color('#4e8b97');
  const rippleColor = new THREE.Color('#80b4b9');
  let disposed = false;
  function vertex(mesh, index, x, y, z, color, alpha) {
    mesh.geometry.attributes.position.setXYZ(index, x, y, z);
    mesh.geometry.attributes.color.setXYZW(index, color.r, color.g, color.b, alpha);
  }
  function rippleVertex(index, angle, radius, event, elapsed, centerX, centerZ, alpha) {
    const x = event.x + Math.cos(angle) * radius, z = event.z + Math.sin(angle) * radius;
    vertex(batch, index, x - centerX, surfaceHeight(x, z, elapsed) + .028, z - centerZ, rippleColor, alpha);
  }
  return {
    group,
    update(state, active, elapsed, x, z) {
      if (disposed) return;
      timeline.update(state, active, elapsed, x, z);
      let live = false;
      batch.position.set(x, 0, z);
      // Unused slots are degenerate, transparent triangles at the current
      // contact. Fixed draw ranges prevent lifetime changes growing calls.
      batch.geometry.attributes.position.array.fill(0);
      batch.geometry.attributes.color.array.fill(0);
      for (let slot = 0; slot < timeline.events.length; slot++) {
        const event = timeline.events[slot];
        if (!event.kind) continue;
        live = true;
        const style = styles[event.kind], t = Math.max(0, Math.min(1, (elapsed - event.born) / event.life));
        const fade = (1 - t) * (1 - t), size = event.size;
        let index = slot * 2 * SEGMENTS * 6;
        for (let ring = 0; ring < 2; ring++) {
          const radius = (.08 + t * style.radius + ring * .13) * size;
          const width = (.024 + .014 * (1 - t)) * size;
          const alpha = fade * (ring ? .22 : .42);
          for (let i = 0; i < SEGMENTS; i++) {
            // Short gaps make thin arcs, with no texture or custom shader.
            const a = i * Math.PI * 2 / SEGMENTS, b = (i + .83) * Math.PI * 2 / SEGMENTS;
            rippleVertex(index++, a, radius, event, elapsed, x, z, alpha);
            rippleVertex(index++, b, radius, event, elapsed, x, z, alpha);
            rippleVertex(index++, b, radius + width, event, elapsed, x, z, alpha);
            rippleVertex(index++, a, radius, event, elapsed, x, z, alpha);
            rippleVertex(index++, b, radius + width, event, elapsed, x, z, alpha);
            rippleVertex(index++, a, radius + width, event, elapsed, x, z, alpha);
          }
        }
        index = rippleVertices + slot * DROPS * 24;
        for (let drop = 0; drop < DROPS; drop++) {
          const angle = event.drops[drop * 4], reach = event.drops[drop * 4 + 1];
          const height = event.drops[drop * 4 + 2], breadth = event.drops[drop * 4 + 3];
          const px = event.x + Math.cos(angle) * t * style.radius * reach * .7;
          const pz = event.z + Math.sin(angle) * t * style.radius * reach * .7;
          const py = surfaceHeight(px, pz, elapsed) + .04 + 4 * t * (1 - t) * style.height * height * size;
          const width = style.width * breadth * size * (1 - t * .65);
          const length = width * (2.2 + 2 * (1 - t));
          // Faceted vertical droplets: a pale lit side and a darker wet side.
          for (let side = 0; side < 4; side++) {
            const a = side * Math.PI / 2, b = (side + 1) * Math.PI / 2;
            const color = side < 2 ? pale : dark;
            vertex(batch, index++, px - x, py + length, pz - z, color, fade * .8);
            vertex(batch, index++, px - x + Math.cos(a) * width, py, pz - z + Math.sin(a) * width, color, fade * .72);
            vertex(batch, index++, px - x + Math.cos(b) * width, py, pz - z + Math.sin(b) * width, color, fade * .72);
            vertex(batch, index++, px - x, py - length, pz - z, color, fade * .3);
            vertex(batch, index++, px - x + Math.cos(b) * width, py, pz - z + Math.sin(b) * width, color, fade * .72);
            vertex(batch, index++, px - x + Math.cos(a) * width, py, pz - z + Math.sin(a) * width, color, fade * .72);
          }
        }
      }
      group.visible = batch.visible = live;
      batch.geometry.attributes.position.needsUpdate = true;
      batch.geometry.attributes.color.needsUpdate = true;
      batch.geometry.computeBoundingSphere();
    },
    dispose() {
      if (disposed) return;
      disposed = true; timeline.clear(); group.visible = false;
      group.removeFromParent(); batch.geometry.dispose(); material.dispose();
    },
  };
}
