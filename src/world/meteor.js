import * as THREE from 'three';

export const METEOR_CONFIG = Object.freeze({ probability: .005, slots: 18, slotSeconds: 10,
  duration: 1.1, daySeconds: 180, nightSeconds: 180, radius: 1200 });

// Decimal input keeps high night-index digits; the draw and each appearance
// dimension have independent salts. This never advances the gameplay RNG.
export function meteorRoll(nightIndex, slotIndex, salt = 'meteor-roll-sky3-v1') {
  if (!Number.isSafeInteger(nightIndex) || nightIndex < 0 || !Number.isInteger(slotIndex)
    || slotIndex < 0 || slotIndex >= METEOR_CONFIG.slots) return 1;
  let hash = 0x811c9dc5;
  for (const digit of `${salt}:${nightIndex}:${slotIndex}`) hash = Math.imul(hash ^ digit.charCodeAt(0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
export function sampleMeteor(clock, fogType, target = {}) {
  Object.assign(target, { visible: false, nightIndex: -1, slotIndex: -1, age: 0, progress: 0, opacity: 0,
    azimuth: 0, elevation: 0, slope: 0, length: 1, width: 1, tailFraction: .5, brightness: 0 });
  const { daySeconds, nightSeconds, slotSeconds, slots, duration, radius, probability } = METEOR_CONFIG;
  if (clock?.timeOfDay !== 'night' || fogType !== 'CLEAR' || !Number.isFinite(clock.elapsedSeconds)
    || clock.elapsedSeconds < 0 || !Number.isFinite(clock.cycleSeconds) || !Number.isFinite(clock.phaseProgress)) return target;
  const seconds = clock.cycleSeconds - daySeconds, nightIndex = Math.floor(clock.elapsedSeconds / (daySeconds + nightSeconds));
  if (!Number.isSafeInteger(nightIndex) || seconds < 0 || seconds >= nightSeconds
    || Math.abs(seconds - clock.phaseProgress * nightSeconds) > 1e-8) return target;
  const slotIndex = Math.floor(seconds / slotSeconds), age = seconds - (slotIndex + .5) * slotSeconds;
  if (slotIndex >= slots || age <= 1e-9 || age >= duration - 1e-9 || meteorRoll(nightIndex, slotIndex) >= probability) return target;
  const variation = salt => meteorRoll(nightIndex, slotIndex, `meteor-${salt}-sky3-v1`);
  const tailAngle = (10 + 6 * variation('tail')) * Math.PI / 180;
  const travelAngle = (10 + 6 * variation('speed')) * Math.PI / 180;
  Object.assign(target, { visible: true, nightIndex, slotIndex, age, progress: age / duration,
    opacity: smooth(age / .12) * smooth((duration - age) / .22),
    azimuth: variation('azimuth') * 2 * Math.PI, elevation: (18 + 12 * variation('elevation')) * Math.PI / 180,
    slope: -.3 - .35 * variation('slope'), length: 2 * radius * Math.tan((tailAngle + travelAngle) / 2),
    width: 3.8 + .6 * variation('width'), tailFraction: tailAngle / (tailAngle + travelAngle),
    brightness: .65 + .25 * variation('brightness') });
  return target;
}

let factoryActive = false, constructorActive = false;
function allocateMeteor() {
  if (factoryActive || constructorActive) throw new Error('STOP: reentrant meteor UUID construction');
  factoryActive = true;
  let geometry, material, mesh;
  try {
    const crypto = globalThis.crypto, fill = crypto?.getRandomValues;
    if (typeof fill !== 'function') throw new Error('STOP: meteor UUID construction requires crypto.getRandomValues');
    const words = new Uint32Array(16);
    const refill = () => { if (fill.call(crypto, words) !== words) throw new Error('STOP: asynchronous/invalid meteor UUID entropy'); };
    refill();
    let cursor = 0;
    const uuidRandom = () => { if (cursor === words.length) { refill(); cursor = 0; } return words[cursor++] / 4294967296; };
    function construct(kind) {
      if (constructorActive) throw new Error('STOP: nested meteor UUID construction');
      const originalRandom = Math.random;
      let object;
      constructorActive = true;
      try {
        Math.random = uuidRandom;
        // Only UUID constructors run here; setup, scene hooks and updates all
        // run with the exact original function restored, including on failure.
        switch (kind) {
          case 'geometry': object = new THREE.BufferGeometry(); break;
          case 'material': object = new THREE.ShaderMaterial(); break;
          case 'mesh': object = new THREE.Mesh(geometry, material); break;
          default: throw new Error('STOP: unknown meteor constructor');
        }
      } finally { Math.random = originalRandom; constructorActive = false; }
      if (object && typeof object.then === 'function') throw new Error('STOP: asynchronous meteor constructor');
      return object;
    }
    geometry = construct('geometry'); material = construct('material'); mesh = construct('mesh');
    return { geometry, material, mesh };
  } catch (error) { geometry?.dispose(); material?.dispose(); throw error; }
  finally { factoryActive = false; }
}

export function createMeteor() {
  const { geometry, material, mesh } = allocateMeteor();
  // One immutable quad. The fragment shader moves its head and fading tail
  // continuously along the world-fixed ribbon, without frame history/buffers.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, -.5, 0, .5, .5, 0, -.5, .5, 0,
  ], 3));
  geometry.setDrawRange(0, 6); geometry.computeBoundingSphere();
  Object.assign(material, { transparent: true, depthTest: true, depthWrite: false, fog: false,
    side: THREE.DoubleSide, forceSinglePass: true });
  material.uniforms = { meteorProgress: { value: 0 }, meteorOpacity: { value: 0 },
    meteorTail: { value: .5 }, meteorBrightness: { value: 0 } };
  material.vertexShader = `varying vec2 ribbon;
    void main() {
      ribbon = position.xy + 0.5;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  material.fragmentShader = `varying vec2 ribbon;
    uniform float meteorProgress;
    uniform float meteorOpacity;
    uniform float meteorTail;
    uniform float meteorBrightness;
    void main() {
      float head = meteorTail + (1.0 - meteorTail) * meteorProgress;
      float behind = head - ribbon.x;
      if (behind < 0.0 || behind > meteorTail) discard;
      float tail = pow(1.0 - behind / meteorTail, 1.8);
      float core = exp(-pow((ribbon.y - 0.5) * 5.5, 2.0));
      float glow = exp(-pow(behind * 150.0, 2.0));
      float edge = 1.0 - smoothstep(0.35, 0.5, abs(ribbon.y - 0.5));
      gl_FragColor = vec4(vec3(0.63, 0.77, 0.96),
        (tail * 0.5 + glow * 0.35) * core * edge * meteorOpacity * meteorBrightness);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  mesh.name = 'clear-night-meteor'; mesh.visible = false;
  // Sky is opaque with no depth write. Match the stars' far sky layer, behind
  // the 900m transparent moon, trees/water and opaque terrain depth.
  mesh.renderOrder = -1;
  const sample = {}, radial = new THREE.Vector3(), tangent = new THREE.Vector3(), across = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let disposed = false;
  return {
    mesh,
    update(clock, boat, fogType) {
      if (disposed) return;
      sampleMeteor(clock, fogType, sample);
      mesh.visible = sample.visible;
      mesh.position.set(boat.x, 0, boat.z); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
      if (sample.visible) {
        const { azimuth: a, elevation: e, slope } = sample;
        radial.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
        // Tangent azimuth plus a downward elevation component; no camera input.
        tangent.set(-Math.sin(a) - slope * Math.sin(e) * Math.cos(a), slope * Math.cos(e),
          Math.cos(a) - slope * Math.sin(e) * Math.sin(a)).normalize();
        across.crossVectors(radial, tangent).normalize();
        basis.makeBasis(tangent, across, radial); mesh.quaternion.setFromRotationMatrix(basis);
        mesh.position.addScaledVector(radial, METEOR_CONFIG.radius); mesh.scale.set(sample.length, sample.width, 1);
      }
      material.uniforms.meteorProgress.value = sample.progress;
      material.uniforms.meteorOpacity.value = sample.opacity;
      material.uniforms.meteorTail.value = sample.tailFraction;
      material.uniforms.meteorBrightness.value = sample.brightness;
    },
    dispose() { if (disposed) return; disposed = true; mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
