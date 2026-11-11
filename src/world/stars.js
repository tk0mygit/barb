import * as THREE from 'three';

export const STAR_CONFIG = Object.freeze({ count: 960, radius: 1200, nightSeconds: 180,
  fadeSeconds: 12, timeWrapSeconds: 2520, amplitude: .075 });
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

// Integer periods 4..9 all divide 2520. Modulo on the CPU keeps long saved
// clocks precise in float uniforms, including the seamless wrap boundary.
export function sampleStars(clock, fogType, target = {}) {
  const seconds = clock.phaseProgress * STAR_CONFIG.nightSeconds;
  target.opacity = clock.timeOfDay === 'night' && fogType === 'CLEAR'
    ? smooth(seconds / STAR_CONFIG.fadeSeconds) * smooth((STAR_CONFIG.nightSeconds - seconds) / STAR_CONFIG.fadeSeconds) : 0;
  target.time = clock.elapsedSeconds % STAR_CONFIG.timeWrapSeconds;
  target.visible = target.opacity > 0;
  return target;
}

export function createStarAttributes() {
  let seed = 0x534b5932;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = new Float32Array(STAR_CONFIG.count * 3), colors = new Float32Array(STAR_CONFIG.count * 3);
  const sizes = new Float32Array(STAR_CONFIG.count), phases = new Float32Array(STAR_CONFIG.count), periods = new Float32Array(STAR_CONFIG.count);
  for (let i = 0; i < STAR_CONFIG.count; i++) {
    // Even coverage of the upper hemisphere, with small fixed angular jitter.
    const y = .025 + .97 * (i + .5) / STAR_CONFIG.count, azimuth = i * 2.399963229728653 + (random() - .5) * .3;
    const radial = Math.sqrt(1 - y * y), offset = i * 3;
    positions.set([Math.cos(azimuth) * radial * STAR_CONFIG.radius, y * STAR_CONFIG.radius,
      Math.sin(azimuth) * radial * STAR_CONFIG.radius], offset);
    const blue = random(), bright = i % 29 === 0;
    colors.set([.68 + .12 * blue, .77 + .10 * blue, .94], offset);
    sizes[i] = bright ? 3.25 : 1.6 + random() * .75;
    phases[i] = random() * Math.PI * 2;
    periods[i] = 4 + Math.floor(random() * 6);
  }
  return { positions, colors, sizes, phases, periods };
}

let factoryActive = false, constructorActive = false;
function allocateStars() {
  if (factoryActive || constructorActive) throw new Error('STOP: reentrant star UUID construction');
  factoryActive = true;
  let geometry, material, points;
  try {
    const crypto = globalThis.crypto, fill = crypto?.getRandomValues;
    if (typeof fill !== 'function') throw new Error('STOP: star UUID construction requires crypto.getRandomValues');
    const words = new Uint32Array(16);
    const refill = () => { if (fill.call(crypto, words) !== words) throw new Error('STOP: asynchronous/invalid star UUID entropy'); };
    refill();
    let cursor = 0;
    const uuidRandom = () => { if (cursor === words.length) { refill(); cursor = 0; } return words[cursor++] / 4294967296; };
    function construct(kind) {
      if (constructorActive) throw new Error('STOP: nested star UUID construction');
      const originalRandom = Math.random;
      let object;
      constructorActive = true;
      try {
        Math.random = uuidRandom;
        // Only these three synchronous UUID-generating constructors. Buffer
        // setup, callbacks, scene connection and all updates run after restore.
        switch (kind) {
          case 'geometry': object = new THREE.BufferGeometry(); break;
          case 'material': object = new THREE.ShaderMaterial(); break;
          case 'points': object = new THREE.Points(geometry, material); break;
          default: throw new Error('STOP: unknown star constructor');
        }
      } finally { Math.random = originalRandom; constructorActive = false; }
      if (object && typeof object.then === 'function') throw new Error('STOP: asynchronous star constructor');
      return object;
    }
    geometry = construct('geometry'); material = construct('material'); points = construct('points');
    return { geometry, material, points };
  } catch (error) { geometry?.dispose(); material?.dispose(); throw error; }
  finally { factoryActive = false; }
}

export function createStars() {
  const { geometry, material, points } = allocateStars(), attributes = createStarAttributes();
  for (const [name, array, itemSize] of [['position', attributes.positions, 3], ['color', attributes.colors, 3],
    ['starSize', attributes.sizes, 1], ['starPhase', attributes.phases, 1], ['starPeriod', attributes.periods, 1]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  geometry.setDrawRange(0, STAR_CONFIG.count); geometry.computeBoundingSphere();
  Object.assign(material, { transparent: true, depthTest: true, depthWrite: false, fog: false, vertexColors: true });
  material.uniforms = { starTime: { value: 0 }, starOpacity: { value: 0 }, starPixelRatio: { value: 1 } };
  material.vertexShader = `attribute float starSize;
    attribute float starPhase;
    attribute float starPeriod;
    uniform float starTime;
    uniform float starPixelRatio;
    varying vec3 starColor;
    varying float brightness;
    void main() {
      starColor = color;
      brightness = 1.0 + 0.075 * sin(starTime * 6.28318530718 / starPeriod + starPhase);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(starSize * starPixelRatio, 1.5, 6.0);
    }`;
  material.fragmentShader = `uniform float starOpacity;
    varying vec3 starColor;
    varying float brightness;
    void main() {
      float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
      float soft = exp(-radius * radius * 4.5) * (1.0 - smoothstep(0.65, 1.0, radius));
      gl_FragColor = vec4(starColor, soft * 0.72 * brightness * starOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  points.name = 'clear-night-stars'; points.visible = false;
  // Sky's opaque box (scale 2000, no depth write) precedes transparent stars.
  // Radius 1200 is beyond the moon at 900m and inside camera far at 2400m.
  // Stars draw before transparent moon/water/trees; opaque terrain depth tests.
  points.renderOrder = -1;
  points.onBeforeRender = renderer => { material.uniforms.starPixelRatio.value = Math.max(.5, Math.min(2, renderer.getPixelRatio())); };
  const sample = {};
  let disposed = false;
  return {
    points,
    update(clock, boat, fogType) {
      if (disposed) return;
      sampleStars(clock, fogType, sample);
      points.position.set(boat.x, 0, boat.z);
      points.visible = sample.visible;
      material.uniforms.starOpacity.value = sample.opacity;
      material.uniforms.starTime.value = sample.time;
    },
    dispose() { if (disposed) return; disposed = true; points.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
