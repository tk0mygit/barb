import { sampleAurora } from '../world/aurora.js';
import { sampleMeteor } from '../world/meteor.js';
import { sampleNightFog } from '../world/night-fog.js';
import { createCelestialVisibility } from './celestial-visibility.js';
import { createObservationOcclusion } from './observation-occlusion.js';

export const OBSERVATION_SECONDS = Object.freeze({ aurora: .5, meteor: .1 });
export const OBSERVATION_MAX_GAP_MS = 250;

export function createObservationTracker({ recorded = [], onObservation }) {
  const done = new Set(recorded), previous = new Map();
  return Object.freeze({
    needs: kind => !done.has(kind),
    reset() { previous.clear(); },
    frame(kind, event, now, valid) {
      if (!Object.hasOwn(OBSERVATION_SECONDS, kind) || done.has(kind)) return;
      const last = previous.get(kind);
      if (!valid || !Number.isFinite(now) || event == null) { previous.delete(kind); return; }
      const gap = last ? now - last.now : Infinity;
      if (gap <= 0) { previous.delete(kind); return; }
      if (!last || last.event !== event || gap > OBSERVATION_MAX_GAP_MS) {
        previous.set(kind, { event, now, start: now }); return;
      }
      last.now = now;
      // One-nanosecond tolerance only compensates floating-point frame grids.
      if (now - last.start + 1e-6 < OBSERVATION_SECONDS[kind] * 1000) return;
      done.add(kind); previous.delete(kind); onObservation(kind);
    },
  });
}

// Only this internal rendering boundary accepts normal frames. Nothing is
// published on window, and no test/lighting probes participate in admission.
export function createCelestialObservation({ renderer, scene, camera, targets, recorded, onObservation, getViewport }) {
  const tracker = createObservationTracker({ recorded, onObservation });
  const visibility = createCelestialVisibility(camera, createObservationOcclusion(scene));
  const submitted = new Set(), hooks = [], aurora = {}, meteor = {}, fog = {};
  let armed = false, disposed = false;
  for (const mesh of [...targets.aurora, targets.meteor]) {
    const before = mesh.onBeforeRender, after = mesh.onAfterRender;
    let calls = -1;
    const beforeHook = function(...args) {
      before.apply(this, args);
      calls = armed && args[0] === renderer && args[1] === scene && args[2] === camera ? renderer.info.render.calls : -1;
    };
    const afterHook = function(...args) {
      after.apply(this, args);
      if (armed && calls >= 0 && args[0] === renderer && args[1] === scene && args[2] === camera
        && renderer.info.render.calls > calls) submitted.add(mesh);
      calls = -1;
    };
    mesh.onBeforeRender = beforeHook; mesh.onAfterRender = afterHook;
    hooks.push(() => {
      if (mesh.onBeforeRender === beforeHook) mesh.onBeforeRender = before;
      if (mesh.onAfterRender === afterHook) mesh.onAfterRender = after;
    });
  }
  return Object.freeze({
    reset() { armed = false; submitted.clear(); tracker.reset(); },
    renderFrame(now, clock, canObserve) {
      submitted.clear(); armed = !disposed && canObserve() && Number.isFinite(now);
      try {
        // The normal render is identical whether observation is allowed or not.
        renderer.render(scene, camera);
        if (!armed || !canObserve() || renderer.getContext().isContextLost() || renderer.getRenderTarget() !== null) {
          tracker.reset(); return;
        }
        sampleNightFog(clock, fog); sampleAurora(clock, fog.fogType, aurora); sampleMeteor(clock, fog.fogType, meteor);
        const auroraNeeded = tracker.needs('aurora') && aurora.visible && targets.aurora.some(mesh => submitted.has(mesh));
        const meteorNeeded = tracker.needs('meteor') && meteor.visible && submitted.has(targets.meteor);
        if (auroraNeeded || meteorNeeded) visibility.begin(getViewport());
        tracker.frame('aurora', aurora.nightIndex, now, auroraNeeded && targets.aurora.some(mesh => submitted.has(mesh) && visibility.aurora(mesh)));
        tracker.frame('meteor', `${meteor.nightIndex}:${meteor.slotIndex}`, now, meteorNeeded && visibility.meteor(targets.meteor));
      } catch (error) { tracker.reset(); throw error; }
      finally { armed = false; submitted.clear(); }
    },
    dispose() { disposed = true; tracker.reset(); for (const unhook of hooks) unhook(); },
  });
}
