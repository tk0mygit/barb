import * as THREE from 'three';

export const AURORA_CONFIG = Object.freeze({ probability: .20, daySeconds: 180, nightSeconds: 180,
  fadeSeconds: 15, timeWrapSeconds: 720, radius: 1350, columns: 80, rows: 10, layers: 2 });

// Decimal input preserves the high digits of ordinary saved night indices.
// Appearance salts are independent of both this draw and the weather draw.
export function auroraRoll(nightIndex, salt = 'aurora-roll-sky4-v1') {
  if (!Number.isSafeInteger(nightIndex) || nightIndex < 0 || typeof salt !== 'string' || !salt.length) return 1;
  let hash = 0x811c9dc5;
  for (const digit of `${salt}:${nightIndex}`) hash = Math.imul(hash ^ digit.charCodeAt(0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
// Bounded one-night memo, independent of visibility, frame rate and weather.
let profileNight = -1, profileSelected = false, profileAzimuth = 0, profilePhase = 0, profileHue = 0;
export function sampleAurora(clock, fogType, target = {}) {
  target.valid = false; target.selected = false; target.visible = false; target.nightIndex = -1;
  target.opacity = 0; target.time = 0; target.azimuth = 0; target.phase = 0; target.hue = 0;
  const { daySeconds, nightSeconds, fadeSeconds, timeWrapSeconds, probability } = AURORA_CONFIG;
  const elapsed = clock?.elapsedSeconds, duration = daySeconds + nightSeconds;
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isSafeInteger(Math.floor(elapsed / duration))) return target;
  let cycle = elapsed % duration;
  // Match the existing clock's sub-nanosecond boundary convention explicitly.
  if (duration - cycle < 1e-9) cycle = 0;
  if (Math.abs(cycle - daySeconds) < 1e-9) cycle = daySeconds;
  const night = cycle >= daySeconds, seconds = night ? cycle - daySeconds : cycle;
  if (!Number.isFinite(clock.cycleSeconds) || !Number.isFinite(clock.phaseProgress)
    || !Number.isFinite(clock.cycleProgress) || clock.timeOfDay !== (night ? 'night' : 'day')
    || Math.abs(clock.cycleSeconds - cycle) > 1e-9
    || Math.abs(clock.phaseProgress * (night ? nightSeconds : daySeconds) - seconds) > 1e-9
    || Math.abs(clock.cycleProgress * duration - cycle) > 1e-9
    || (fogType !== 'CLEAR' && fogType !== 'FOG' && fogType !== 'DENSE_FOG')) return target;
  target.valid = true;
  target.nightIndex = Math.floor(elapsed / duration);
  if (profileNight !== target.nightIndex) {
    profileNight = target.nightIndex;
    profileSelected = auroraRoll(profileNight) < probability;
    profileAzimuth = auroraRoll(profileNight, 'aurora-direction-sky4-v1') * Math.PI * 2;
    profilePhase = auroraRoll(profileNight, 'aurora-folds-sky4-v1') * Math.PI * 2;
    profileHue = auroraRoll(profileNight, 'aurora-hue-sky4-v1');
  }
  target.selected = profileSelected;
  target.time = elapsed % timeWrapSeconds;
  target.azimuth = profileAzimuth; target.phase = profilePhase; target.hue = profileHue;
  if (night && fogType === 'CLEAR' && target.selected) {
    target.opacity = smooth(seconds / fadeSeconds) * smooth((nightSeconds - seconds) / fadeSeconds);
    target.visible = target.opacity > 0;
  }
  return target;
}

let factoryActive = false, constructorActive = false;
function allocateAurora() {
  if (factoryActive || constructorActive) throw new Error('STOP: reentrant aurora UUID construction');
  factoryActive = true;
  let geometry;
  const materials = [], meshes = [];
  try {
    const crypto = globalThis.crypto, fill = crypto?.getRandomValues;
    if (typeof fill !== 'function') throw new Error('STOP: aurora UUID construction requires crypto.getRandomValues');
    const words = new Uint32Array(16);
    const refill = () => {
      words.fill(0);
      if (fill.call(crypto, words) !== words || words.every(word => word === words[0]))
        throw new Error('STOP: asynchronous/invalid/insufficient aurora UUID entropy');
    };
    refill();
    let cursor = 0;
    const uuidRandom = () => { if (cursor === words.length) { refill(); cursor = 0; } return words[cursor++] / 4294967296; };
    function construct(kind, material) {
      if (constructorActive) throw new Error('STOP: nested aurora UUID construction');
      const originalRandom = Math.random;
      let object;
      constructorActive = true;
      try {
        Math.random = uuidRandom;
        // Only synchronous Three UUID constructors run inside this boundary.
        switch (kind) {
          case 'geometry': object = new THREE.BufferGeometry(); break;
          case 'material': object = new THREE.ShaderMaterial(); break;
          case 'mesh': object = new THREE.Mesh(geometry, material); break;
          default: throw new Error('STOP: unknown aurora constructor');
        }
      } finally { Math.random = originalRandom; constructorActive = false; }
      if (object && typeof object.then === 'function') throw new Error('STOP: asynchronous aurora constructor');
      return object;
    }
    geometry = construct('geometry');
    for (let layer = 0; layer < AURORA_CONFIG.layers; layer++) {
      const material = construct('material'); materials.push(material);
      meshes.push(construct('mesh', material));
    }
    return { geometry, materials, meshes };
  } catch (error) { geometry?.dispose(); for (const material of materials) material.dispose(); throw error; }
  finally { factoryActive = false; }
}

export function createAurora() {
  const { geometry, materials, meshes } = allocateAurora();
  const { columns, rows, radius } = AURORA_CONFIG;
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);
  const indices = new Uint16Array(columns * rows * 6);
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const u = x / columns, v = y / rows, i = y * (columns + 1) + x;
    const angle = (u - .5) * 1.9, elevation = .19 + v * .65;
    positions.set([Math.sin(angle) * Math.cos(elevation) * radius,
      Math.sin(elevation) * radius, -Math.cos(angle) * Math.cos(elevation) * radius], i * 3);
    uvs.set([u, v], i * 2);
    if (y < rows && x < columns) {
      const j = (y * columns + x) * 6, b = i + columns + 1;
      indices.set([i, b, i + 1, i + 1, b, b + 1], j);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, indices.length); geometry.computeBoundingSphere();
  // A radial center gives a tighter enclosing sphere than the AABB center
  // for this curved arc, allowing a view behind the curtain to cull it.
  const center = geometry.boundingSphere.center;
  center.set(0, Math.sin(.515) * radius, -1800);
  let squaredRadius = 0;
  for (let i = 0; i < positions.length; i += 3) squaredRadius = Math.max(squaredRadius,
    (positions[i] - center.x) ** 2 + (positions[i + 1] - center.y) ** 2 + (positions[i + 2] - center.z) ** 2);
  // The two bounded shader displacements are <= 47m in total.
  geometry.boundingSphere.radius = Math.sqrt(squaredRadius) + 48;
  for (let layer = 0; layer < meshes.length; layer++) {
    const mesh = meshes[layer], material = materials[layer];
    Object.assign(material, { transparent: true, depthTest: true, depthWrite: false, fog: false,
      side: THREE.DoubleSide, forceSinglePass: true });
    material.uniforms = { auroraTime: { value: 0 }, auroraOpacity: { value: 0 },
      auroraPhase: { value: 0 }, auroraHue: { value: 0 }, auroraLayer: { value: layer } };
    // Identical sources/defines on both materials share one GPU program.
    material.vertexShader = `uniform float auroraTime;
      uniform float auroraPhase;
      uniform float auroraLayer;
      varying vec2 curtain;
      void main() {
        curtain = uv;
        float t = auroraTime * 0.00872664625997;
        float p = auroraPhase + auroraLayer * 0.8;
        vec3 point = position;
        point.x += 28.0 * sin(uv.x * 10.0 + t * 3.0 + p) * sin(uv.y * 2.4 + 0.2);
        point.y += 18.0 * sin(uv.x * 15.0 - t * 2.0 + p);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
      }`;
    material.fragmentShader = `uniform float auroraTime;
      uniform float auroraOpacity;
      uniform float auroraPhase;
      uniform float auroraHue;
      uniform float auroraLayer;
      varying vec2 curtain;
      void main() {
        float t = auroraTime * 0.00872664625997;
        float p = auroraPhase + auroraLayer * 0.8;
        float u = curtain.x;
        float fold = u + 0.022 * sin(u * 14.0 + t * 3.0 + p)
          + 0.009 * sin(u * 31.0 - t * 2.0 + p);
        float hem = 0.15 + 0.055 * sin(u * 12.0 + t * 2.0 + p)
          + 0.035 * sin(u * 23.0 - t * 3.0);
        float height = curtain.y - hem;
        float edge = smoothstep(0.0, 0.10, u) * smoothstep(0.0, 0.10, 1.0 - u);
        float veil = smoothstep(-0.03, 0.08, height) * exp(-max(height, 0.0) * 4.0)
          * (1.0 - smoothstep(0.60, 0.95, curtain.y));
        float rays = 0.40 + 0.38 * pow(0.5 + 0.5 * sin(fold * 173.0 + p), 2.0)
          + 0.22 * sin(fold * 57.0 - t * 4.0) * sin(fold * 57.0 - t * 4.0);
        float broad = 0.63 + 0.37 * sin(fold * 19.0 + p) * sin(fold * 19.0 + p);
        float purple = smoothstep(0.22, 0.66, height) * (0.35 + 0.25 * sin(u * 9.0 + p));
        vec3 green = mix(vec3(0.035, 0.53, 0.22), vec3(0.035, 0.39, 0.47),
          0.25 + auroraHue * 0.35 + 0.15 * sin(fold * 11.0 + p));
        vec3 color = mix(green, vec3(0.29, 0.12, 0.40), purple);
        float alpha = edge * veil * rays * broad * auroraOpacity * (0.34 - auroraLayer * 0.08);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    mesh.name = `clear-night-aurora-${layer}`; mesh.visible = false;
    // Opaque Sky/terrain precede these veils; stars/meteor (-1), the 900m
    // moon and transparent foreground follow. No depth writes or extra pass.
    mesh.renderOrder = -2;
  }
  const sample = {};
  let disposed = false;
  return {
    meshes,
    update(clock, boat, fogType) {
      if (disposed) return;
      sampleAurora(clock, fogType, sample);
      for (let layer = 0; layer < meshes.length; layer++) {
        const mesh = meshes[layer], uniforms = materials[layer].uniforms;
        mesh.visible = sample.visible;
        mesh.position.set(boat.x, 0, boat.z);
        mesh.rotation.set(0, sample.azimuth + layer * .22, 0);
        mesh.scale.setScalar(1 - layer * .035);
        uniforms.auroraTime.value = sample.time; uniforms.auroraOpacity.value = sample.opacity;
        uniforms.auroraPhase.value = sample.phase; uniforms.auroraHue.value = sample.hue;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const mesh of meshes) { mesh.visible = false; mesh.removeFromParent(); }
      geometry.dispose(); for (const material of materials) material.dispose();
    },
  };
}
