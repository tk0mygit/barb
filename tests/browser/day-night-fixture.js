import { expect } from '@playwright/test';
import { installPausedClock } from './clock-fixture.js';
import { Color } from 'three';
import { sampleNightFog, getNightFogDensity } from '../../src/world/night-fog.js';
import { createLightingSave } from '../helpers/lighting-save.js';
import { createGameClock } from '../../src/game/game-clock.js';
import { sampleDayNight } from '../../src/world/day-night.js';
import { sampleStars } from '../../src/world/stars.js';
import { starSnapshot } from '../helpers/star-snapshot.js';
import { meteorSnapshot } from '../helpers/meteor-snapshot.js';
import { auroraSnapshot, observeAuroraGPU } from '../helpers/aurora-snapshot.js';
import { observeAuroraWorldLight } from '../helpers/aurora-world-light-observer.js';
import { sampleAurora, sampleAuroraLight, sampleAuroraEnvironment } from '../../src/world/aurora.js';

const now = new Date('2026-10-23T00:00:00Z');
export const tick = page => page.clock.fastForward(250);
export const read = page => page.evaluate(() => window.lightingProbe.last);

export async function observeControls(page) {
  await page.evaluate(() => {
    window.controlProbe = window.e2eDiagnostics;
  });
}

export async function activateControl(page, id, touch) {
  const button = page.locator(`#${id}`);
  await Promise.all([expect(button).toBeVisible(), expect(button).toBeEnabled()]);
  const before = await button.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const snapshot = { id: button.id, hidden: button.hidden, disabled: button.disabled, bounds: bounds.toJSON(),
      hit: hit?.closest('button')?.id ?? hit?.id, boatSpeed: window.lightingProbe.last.boatSpeed,
      motion: document.querySelector('#motion-label').textContent, eventSequence: window.controlProbe.events.at(-1)?.sequence ?? 0 };
    window.controlProbe.actions.push(snapshot);
    if (window.controlProbe.actions.length > 30) window.controlProbe.actions.shift();
    return snapshot;
  });
  expect(before.hit).toBe(id);
  // Keep Playwright's stability/receives-events checks and send one input only.
  if (touch) await button.tap();
  else await button.click();
  // Read the completed event sequence once per poll. This retains both
  // assertions without extra CDP round trips while software WebGL is active.
  await expect.poll(() => page.evaluate(start => {
    const events = window.controlProbe.events.filter(event => event.sequence > start);
    window.controlProbe.actions.at(-1).eventsAfterInput = events;
    return {
      clicks: events.filter(event => event.type === 'click').map(event => ({ target: event.target, trusted: event.trusted })),
      pointerTargets: events.filter(event => event.type === 'pointerdown').map(event => event.target),
    };
  }, before.eventSequence)).toEqual({ clicks: [{ target: id, trusted: true }], pointerTargets: [id] });
}

export async function setup(page, elapsedSeconds, { freeze = true, randomValue = .5 } = {}) {
  const data = createLightingSave(elapsedSeconds);
  // Observe the actual production renderer via Three.js's existing devtools
  // event. No production debug API, source rewrite or forced game state.
  await page.addInitScript(({ data, randomValue, starSnapshotSource, meteorSnapshotSource, auroraSnapshotSource, auroraGPUSource, worldLightSource }) => {
    const snapshotStars = (0, eval)(`(${starSnapshotSource})`);
    const snapshotMeteor = (0, eval)(`(${meteorSnapshotSource})`);
    const snapshotAurora = (0, eval)(`(${auroraSnapshotSource})`);
    const observeGPU = (0, eval)(`(${auroraGPUSource})`);
    const observeWorldLight = (0, eval)(`(${worldLightSource})`);
    if (!sessionStorage.getItem('lighting-seeded')) {
      localStorage.setItem('barb.save.v1.slotA', JSON.stringify({ storageVersion: 1, generation: 1, data }));
      sessionStorage.setItem('lighting-seeded', 'yes');
    }
    Math.random = () => randomValue;
    window.lightingProbe = { first: null, last: null, renders: 0 };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render;
      const direct = renderer.renderBufferDirect;
      const auroraGPU = observeGPU(renderer);
      const worldLight = observeWorldLight(renderer, observeGPU);
      let auroraDraws = [];
      let starCalls = 0, meteorCalls = 0, meteorTriangles = 0, recordingStars = false;
      renderer.renderBufferDirect = function(...args) {
        const before = renderer.info.render.calls, triangles = renderer.info.render.triangles, result = direct.apply(this, args);
        if (recordingStars && args[4]?.name === 'clear-night-stars') starCalls += renderer.info.render.calls - before;
        if (recordingStars && args[4]?.name?.startsWith('clear-night-aurora-')) {
          const layer = Number(args[4].name.at(-1));
          auroraDraws[layer].calls += renderer.info.render.calls - before;
          auroraDraws[layer].triangles += renderer.info.render.triangles - triangles;
        }
        if (recordingStars && args[4]?.name === 'clear-night-meteor') {
          meteorCalls += renderer.info.render.calls - before;
          meteorTriangles += renderer.info.render.triangles - triangles;
        }
        return result;
      };
      const hooked = new WeakSet(), initializedGeometries = new Set();
      renderer.render = function(scene, camera) {
        const cpuGeometries = new Set();
        let fishing;
        scene.traverse(object => {
          if (object.isGroup && object.children.some(child => child.isLine)
            && object.children.some(child => child.geometry?.type === 'RingGeometry' && child.geometry.parameters.outerRadius === 0.7)) fishing = object;
          if (!object.geometry) return;
          cpuGeometries.add(object.geometry.id);
          if (hooked.has(object)) return;
          hooked.add(object);
          // Record the actual geometry used by ordinary and shadow draws.
          // This observes lazy GPU initialization without warming hidden fish
          // markers or changing scene visibility/camera/game state.
          for (const method of ['onBeforeRender', 'onBeforeShadow']) {
            const original = object[method];
            object[method] = function(...args) {
              initializedGeometries.add(object.geometry.id);
              return original?.apply(this, args);
            };
          }
          const geometry = object.geometry;
          geometry.addEventListener('dispose', () => initializedGeometries.delete(geometry.id));
        });
        const ambient = scene.children.find(o => o.isHemisphereLight);
        const [sun, moonlight] = scene.children.filter(o => o.isDirectionalLight);
        const sky = scene.children.find(o => o.isSky), moon = scene.getObjectByName('moon');
        const stars = scene.getObjectByName('clear-night-stars');
        const meteor = scene.getObjectByName('clear-night-meteor');
        const auroras = [0, 1].map(layer => scene.getObjectByName(`clear-night-aurora-${layer}`)).filter(Boolean);
        const water = scene.getObjectByName('lake-water').material.uniforms;
        const mist = scene.getObjectByName('surface-fog');
        const mistUniforms = mist.children[0].material.uniforms;
        const snapshot = {
          ambient: ambient.intensity, sun: sun.intensity, moon: moonlight.intensity,
          sky: sky.material.uniforms.skyDaylight.value, fog: scene.fog.color.toArray(),
          fogDensity: scene.fog.density, waterFogDensity: water.fogDensity.value,
          skyFog: sky.material.uniforms.nightFogColor.value.toArray(),
          fogStrength: sky.material.uniforms.nightFogStrength.value,
          mistVisible: mist.visible, mistAmount: mistUniforms.fogAmount.value, mistTime: mistUniforms.fogTime.value,
          deep: water.deepColor.value.toArray(), reflection: water.reflectionColor.value.toArray(),
          sunDirection: water.sunDirection.value.toArray(), moonDirection: water.moonDirection.value.toArray(),
          sunHighlight: water.sunHighlight.value, moonHighlight: water.moonHighlight.value,
          moonOpacity: moon.material.opacity, moonVisible: moon.visible,
          waterTime: water.time.value, boat: water.boatPosition.value.toArray(), boatSpeed: water.boatSpeed.value,
          shadows: scene.children.filter(o => o.isLight && o.castShadow).length,
        };
        starCalls = 0; meteorCalls = 0; meteorTriangles = 0; recordingStars = true;
        auroraDraws = auroras.map(() => ({ calls: 0, triangles: 0 }));
        let result;
        try { result = render.call(this, scene, camera); } finally { recordingStars = false; }
        snapshot.stars = stars ? { visible: stars.visible, opacity: stars.material.uniforms.starOpacity.value,
          time: stars.material.uniforms.starTime.value, position: stars.position.toArray() } : null;
        // Observe uploaded fog after Three.js converts the uniform. A resize
        // while paused renders again without lake.update() resetting its color.
        snapshot.waterFog = water.fogColor.value.toArray();
        snapshot.worldLight = worldLight.read(scene);
        const probe = window.lightingProbe;
        // Keep changing autosave status out of the visual snapshots.
        if (probe.first === null) {
          probe.initialSavePhase = document.querySelector('#save-status').dataset.phase;
          probe.first = snapshot;
        }
        probe.last = snapshot; probe.renders++;
        probe.camera = camera.quaternion.toArray();
        probe.cameraHeight = camera.position.y;
        probe.moonScreen = moon.position.clone().project(camera).toArray();
        probe.performance = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          programs: renderer.info.programs.length };
        probe.resourceCatalog = { cpuGeometryIds: [...cpuGeometries].sort((a, b) => a - b),
          initializedGeometryIds: [...initializedGeometries].sort((a, b) => a - b),
          programKeys: renderer.info.programs.map(program => program.cacheKey).sort(),
          fishingVisible: fishing.visible,
          fishing: fishing.children.filter(child => child.geometry).map(child => ({ id: child.geometry.id, type: child.geometry.type,
            initialized: initializedGeometries.has(child.geometry.id),
            programKeys: [...(renderer.properties.get(child.material).programs?.values() ?? [])].map(program => program.cacheKey).sort() })),
          surfaceEffects: (() => {
            const object = scene.getObjectByName('fishing-water-effects');
            return object ? { id: object.geometry.id, name: object.name, vertices: object.geometry.attributes.position.count,
              colorItemSize: object.geometry.attributes.color.itemSize, drawRange: { ...object.geometry.drawRange },
              initialized: initializedGeometries.has(object.geometry.id), forceSinglePass: object.material.forceSinglePass,
              programKeys: [...(renderer.properties.get(object.material).programs?.values() ?? [])].map(program => program.cacheKey).sort() } : null;
          })(),
          aurora: auroras.length ? { id: auroras[0].geometry.id, initialized: initializedGeometries.has(auroras[0].geometry.id),
            ...auroraGPU(auroras) } : null,
          meteor: meteor ? { id: meteor.geometry.id, materialId: meteor.material.id, name: meteor.name,
            vertices: meteor.geometry.attributes.position.count, visible: meteor.visible,
            initialized: initializedGeometries.has(meteor.geometry.id),
            programKeys: [...(renderer.properties.get(meteor.material).programs?.values() ?? [])].map(program => program.cacheKey).sort() } : null,
          stars: stars ? { id: stars.geometry.id, name: stars.name, vertices: stars.geometry.attributes.position.count,
            initialized: initializedGeometries.has(stars.geometry.id), visible: stars.visible,
            programKeys: [...(renderer.properties.get(stars.material).programs?.values() ?? [])].map(program => program.cacheKey).sort() } : null };
        probe.starEvidence = snapshotStars(stars);
        probe.starCalls = starCalls;
        probe.meteorEvidence = snapshotMeteor(meteor);
        probe.meteorCalls = meteorCalls;
        probe.meteorTriangles = meteorTriangles;
        probe.meteorGPU = meteor ? { geometryId: meteor.geometry.id, materialId: meteor.material.id,
          programKeys: probe.resourceCatalog.meteor.programKeys,
          programInstances: renderer.info.programs.filter(p => probe.resourceCatalog.meteor.programKeys.includes(p.cacheKey)).length,
          objects: scene.getObjectsByProperty('name', 'clear-night-meteor').length } : null;
        probe.auroraEvidence = snapshotAurora(auroras);
        probe.auroraDraws = auroraDraws;
        probe.auroraGPU = auroraGPU(auroras);
        probe.worldLight = snapshot.worldLight;
        probe.readWorldLight = () => worldLight.read(scene, { gpu: true });
        probe.captureWorldLightParts = base => worldLight.capture(scene, camera, () => render.call(renderer, scene, camera), base);
        probe.firstAuroraEvidence ??= snapshotAurora(auroras);
        probe.captureAuroraPair = () => {
          const visibility = auroras.map(mesh => mesh.visible);
          const capture = () => { render.call(renderer, scene, camera); return renderer.domElement.toDataURL('image/png'); };
          const withAurora = capture();
          for (const mesh of auroras) mesh.visible = false;
          const withoutAurora = capture();
          const layers = auroras.map((mesh, layer) => {
            mesh.visible = visibility[layer]; const image = capture(); mesh.visible = false; return image;
          });
          auroras.forEach((mesh, layer) => { mesh.visible = visibility[layer]; }); capture();
          return { withAurora, withoutAurora, layers, moonScreen: probe.moonScreen };
        };
        probe.firstMeteorEvidence ??= snapshotMeteor(meteor);
        probe.firstResourceCatalog ??= structuredClone(probe.resourceCatalog);
        probe.firstPerformance ??= { ...probe.performance };
        probe.captureMeteorPair = () => {
          const visible = meteor?.visible;
          render.call(renderer, scene, camera);
          const withMeteor = renderer.domElement.toDataURL('image/png');
          if (meteor) meteor.visible = false;
          render.call(renderer, scene, camera);
          const withoutMeteor = renderer.domElement.toDataURL('image/png');
          if (meteor) meteor.visible = visible;
          render.call(renderer, scene, camera);
          const corners = [];
          if (meteor) {
            const point = meteor.position.clone(), positions = meteor.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) corners.push(point.fromBufferAttribute(positions, i)
              .applyMatrix4(meteor.matrixWorld).project(camera).toArray());
          }
          return { withMeteor, withoutMeteor, corners, moonScreen: probe.moonScreen };
        };
        // Same camera/clock, only the star batch hidden. This is test-only
        // paired pixel evidence; restore visibility and the final framebuffer.
        probe.captureStarPair = () => {
          const visible = stars?.visible;
          render.call(renderer, scene, camera);
          const withStars = renderer.domElement.toDataURL('image/png');
          if (stars) stars.visible = false;
          render.call(renderer, scene, camera);
          const withoutStars = renderer.domElement.toDataURL('image/png');
          if (stars) stars.visible = visible;
          render.call(renderer, scene, camera);
          const projected = [];
          if (stars) {
            const point = stars.position.clone(), positions = stars.geometry.attributes.position;
            const sizes = stars.geometry.attributes.starSize;
            for (let i = 0; i < positions.count; i++) {
              point.fromBufferAttribute(positions, i).applyMatrix4(stars.matrixWorld).project(camera);
              if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || Math.abs(point.z) > 1) continue;
              projected.push({ x: (point.x + 1) * renderer.domElement.width / 2,
                y: (1 - point.y) * renderer.domElement.height / 2,
                size: Math.max(1.5, Math.min(6, sizes.getX(i) * stars.material.uniforms.starPixelRatio.value)) });
            }
          }
          return { withStars, withoutStars, projected, vertices: stars?.geometry.attributes.position.count ?? 0 };
        };
        // Test-only paired render proves that low wisps contribute pixels;
        // production code exposes no scene controls or capture endpoint.
        probe.captureMistPair = () => {
          const visible = mist.visible;
          render.call(renderer, scene, camera);
          const withMist = renderer.domElement.toDataURL('image/png');
          mist.visible = false; render.call(renderer, scene, camera);
          const withoutMist = renderer.domElement.toDataURL('image/png');
          mist.visible = visible; render.call(renderer, scene, camera);
          return { withMist, withoutMist };
        };
        probe.uploadedWaterFog = water.fogColor.value.toArray();
        probe.outputFog = scene.fog.color.clone().convertLinearToSRGB().toArray();
        // Infer the optical target from the real layer clock/envelope, without
        // exporting a production game-clock or audio debug endpoint.
        const cycle = snapshot.mistTime % 360, phase = cycle - 180;
        const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
        const fade = cycle < 180 ? 0 : smooth(phase / 12) * smooth((180 - phase) / 12);
        probe.denseFade = fade > 0 && snapshot.fogStrength / fade > 0.9 ? fade : 0;
        return result;
      };
    });
  }, { data, randomValue, starSnapshotSource: starSnapshot.toString(), meteorSnapshotSource: meteorSnapshot.toString(),
    auroraSnapshotSource: auroraSnapshot.toString(), auroraGPUSource: observeAuroraGPU.toString(), worldLightSource: observeAuroraWorldLight.toString() });
  if (freeze) {
    await installPausedClock(page, now);
  }
  await page.goto('./');
  if (freeze) await tick(page);
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  // Check acceptance by the loaded production build before trusting any
  // rendering/camera comparison. A rejected seed must never fall back silently.
  const initial = await page.evaluate(() => ({ first: window.lightingProbe.first,
    initialSavePhase: window.lightingProbe.initialSavePhase,
    raw: localStorage.getItem('barb.save.v1.slotA') }));
  expect(initial.initialSavePhase).toBe('restored');
  expect(initial.first.boat).toEqual([data.boat.x, data.boat.z]);
  expect(initial.first.mistTime).toBeCloseTo(elapsedSeconds % 3600, 7);
  expect(initial.raw).toBe(JSON.stringify({ storageVersion: 1, generation: 1, data }));
}

export function assertEnvironment(actual, elapsedSeconds) {
  const clock = createGameClock(undefined, { elapsedSeconds }).state;
  const expected = sampleDayNight(clock);
  const night = sampleNightFog(clock);
  if (actual.worldLight?.model === 'aurora-world-light-v1') {
    const light = sampleAuroraLight(sampleAurora(clock, night.fogType));
    const lit = sampleAuroraEnvironment(expected, light);
    expected.ambientIntensity = lit.ambientIntensity;
    actual.worldLight.ambient.color.forEach((value, i) => expect(value).toBeCloseTo(lit.ambientSky[i], 10));
    actual.worldLight.ambient.ground.forEach((value, i) => expect(value).toBeCloseTo(lit.ambientGround[i], 10));
    expect(actual.worldLight.water.light.strength).toBeCloseTo(light.lightStrength, 10);
    expect(actual.worldLight.water.light.color).toEqual(light.lightColor);
    // GLSL vec2 uploads Float32. Node/Chromium cos can differ by one
    // Float64 ULP at the identical angle; require identical GPU bits, no epsilon.
    expect(actual.worldLight.water.light.direction.map(Math.fround)).toEqual(light.lightDirection.map(Math.fround));
  }
  expected.fogColor = new Color().fromArray(expected.horizon).lerp(new Color('#53646f'), night.effectiveFogAmount * 0.65).toArray();
  expected.moonOpacity *= (1 - night.effectiveFogAmount) ** 2;
  for (const [field, parameter] of Object.entries({ ambient: 'ambientIntensity', sun: 'sunIntensity', moon: 'moonIntensity',
    sky: 'skyDaylight', fog: 'fogColor', deep: 'waterDeep', reflection: 'waterReflection', sunDirection: 'sunDirection',
    moonDirection: 'moonDirection', sunHighlight: 'sunHighlight', moonHighlight: 'moonHighlight', moonOpacity: 'moonOpacity' })) {
    if (Array.isArray(expected[parameter])) expected[parameter].forEach((v, i) => expect(actual[field][i]).toBeCloseTo(v, 7));
    else expect(actual[field]).toBeCloseTo(expected[parameter], 7);
  }
  expect(actual.shadows).toBe(1);
  expect(actual.fogStrength).toBeCloseTo(night.effectiveFogAmount, 7);
  expect(actual.fogDensity).toBeCloseTo(getNightFogDensity(night.effectiveFogAmount), 9);
  expect(actual.mistAmount).toBeCloseTo(night.effectiveFogAmount, 7);
  expect(actual.mistVisible).toBe(night.effectiveFogAmount > 0);
  expect(actual.mistTime).toBeCloseTo(elapsedSeconds % 3600, 7);
  expect(actual.waterFogDensity).toBe(actual.fogDensity);
  const outputFog = new Color().fromArray(actual.fog).convertLinearToSRGB().toArray();
  actual.waterFog.forEach((v, i) => expect(v).toBeCloseTo(outputFog[i], 7));
  expect(actual.skyFog).toEqual(actual.fog);
  if (actual.stars) {
    const stars = sampleStars(clock, night.fogType);
    expect(actual.stars.visible).toBe(stars.visible);
    expect(actual.stars.opacity).toBeCloseTo(stars.opacity, 7);
    expect(actual.stars.time).toBeCloseTo(stars.time, 7);
    expect(actual.stars.position).toEqual([actual.boat[0], 0, actual.boat[1]]);
  }
}
