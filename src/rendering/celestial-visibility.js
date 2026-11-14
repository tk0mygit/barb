import { Matrix4, Vector3 } from 'three';

const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };

// CPU evaluation of the existing optical envelope. Rendering sources stay
// unchanged; tests bind these expressions to their production shader sources.
export function auroraAlpha(u, v, uniforms) {
  const t = uniforms.auroraTime.value * .03490658503988;
  const p = uniforms.auroraPhase.value + uniforms.auroraLayer.value * .8;
  const fold = u + .031 * Math.sin(u * 14 + t * 3 + p) + .013 * Math.sin(u * 31 - t * 2 + p);
  const hem = .15 + .077 * Math.sin(u * 12 + t * 2 + p) + .049 * Math.sin(u * 23 - t * 3);
  const height = v - hem;
  const edge = smooth(0, .10, u) * smooth(0, .10, 1 - u);
  const veil = smooth(-.03, .08, height) * Math.exp(-Math.max(height, 0) * 4) * (1 - smooth(.60, .95, v));
  const rays = .40 + .38 * (.5 + .5 * Math.sin(fold * 173 + p)) ** 2 + .22 * Math.sin(fold * 57 - t * 4) ** 2;
  const broad = .63 + .37 * Math.sin(fold * 19 + p) ** 2;
  return edge * veil * rays * broad * uniforms.auroraOpacity.value * (.44 - uniforms.auroraLayer.value * .08);
}

export function meteorAlpha(u, v, uniforms) {
  const tail = uniforms.meteorTail.value, head = tail + (1 - tail) * uniforms.meteorProgress.value;
  const behind = head - u;
  if (behind < 0 || behind > tail || tail <= 0) return 0;
  return ((1 - behind / tail) ** 1.8 * .5 + Math.exp(-((behind * 150) ** 2)) * .35)
    * Math.exp(-(((v - .5) * 5.5) ** 2)) * (1 - smooth(.35, .5, Math.abs(v - .5)))
    * uniforms.meteorOpacity.value * uniforms.meteorBrightness.value;
}

export function createCelestialVisibility(camera, occlusion) {
  const points = Array.from({ length: 4 }, () => new Vector3()), projected = points.map(() => new Vector3());
  const vertices = Array.from({ length: 3 }, () => new Vector3());
  const projection = new Matrix4(), eye = new Vector3(), center = new Vector3(), direction = new Vector3(), delta = new Vector3();
  let viewport;
  function patch(count) {
    center.set(0, 0, 0);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const ndc = projected[i].copy(points[i]).applyMatrix4(projection);
      // All corners must be in front of the camera AND inside near/far/NDC.
      delta.subVectors(points[i], eye).transformDirection(camera.matrixWorldInverse);
      if (delta.z >= 0 || ![ndc.x, ndc.y, ndc.z].every(Number.isFinite)
        || Math.abs(ndc.x) >= .995 || Math.abs(ndc.y) >= .995 || Math.abs(ndc.z) >= 1) return false;
      center.add(points[i]);
      minX = Math.min(minX, (ndc.x + 1) * viewport.width / 2); maxX = Math.max(maxX, (ndc.x + 1) * viewport.width / 2);
      minY = Math.min(minY, (1 - ndc.y) * viewport.height / 2); maxY = Math.max(maxY, (1 - ndc.y) * viewport.height / 2);
    }
    let area = 0;
    for (let i = 0; i < count; i++) {
      const a = projected[i], b = projected[(i + 1) % count]; area += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area) * viewport.width * viewport.height / 8 < 1) return false;
    if (viewport.occlusions?.some(r => minX < r.right && maxX > r.left && minY < r.bottom && maxY > r.top)) return false;
    center.multiplyScalar(1 / count); direction.subVectors(center, eye).normalize();
    let aperture = 0, far = 0;
    for (let i = 0; i < count; i++) {
      delta.subVectors(points[i], eye); const along = delta.dot(direction);
      if (along <= 0) return false;
      far = Math.max(far, delta.length());
      aperture = Math.max(aperture, Math.sqrt(Math.max(0, delta.lengthSq() - along * along)) / along);
    }
    return occlusion.isClear(eye, direction, far, aperture);
  }
  function aurora(mesh) {
    const geometry = mesh.geometry, uv = geometry.attributes.uv, positions = geometry.attributes.position;
    const uniforms = mesh.material.uniforms, columns = 80;
    const t = uniforms.auroraTime.value * .03490658503988, p = uniforms.auroraPhase.value + uniforms.auroraLayer.value * .8;
    // Fixed interior patches on actual rendered triangles, with exact vertex
    // deformation followed by barycentric interpolation (not a sphere/quad).
    for (let row = 1; row <= 6; row++) for (let col = 4; col < 77; col += 4) {
      const a = row * (columns + 1) + col, ids = [a, a + columns + 1, a + 1];
      let meaningful = true;
      for (let k = 0; k < 3; k++) {
        let u = 0, v = 0;
        for (let j = 0; j < 3; j++) { const weight = j === k ? .6 : .2; u += uv.getX(ids[j]) * weight; v += uv.getY(ids[j]) * weight; }
        if (auroraAlpha(u, v, uniforms) < .015) { meaningful = false; break; }
      }
      if (!meaningful) continue;
      for (let j = 0; j < 3; j++) {
        const u = uv.getX(ids[j]), v = uv.getY(ids[j]), point = vertices[j].fromBufferAttribute(positions, ids[j]);
        point.x += 45 * Math.sin(u * 10 + t * 3 + p) * Math.sin(v * 2.4 + .2);
        point.y += 29 * Math.sin(u * 15 - t * 2 + p);
        point.applyMatrix4(mesh.matrixWorld);
      }
      for (let k = 0; k < 3; k++) {
        points[k].set(0, 0, 0);
        for (let j = 0; j < 3; j++) points[k].addScaledVector(vertices[j], j === k ? .6 : .2);
      }
      if (patch(3)) return true;
    }
    return false;
  }
  function meteor(mesh) {
    const uniforms = mesh.material.uniforms, tail = uniforms.meteorTail.value;
    const head = tail + (1 - tail) * uniforms.meteorProgress.value;
    for (const behind of [.008, .025, .06, .12, .20]) {
      const u = head - behind;
      const corners = [[u - .016, .27], [u + .016, .27], [u + .016, .73], [u - .016, .73]];
      if (corners.some(([x, y]) => x <= 0 || x >= 1 || meteorAlpha(x, y, uniforms) < .025)) continue;
      corners.forEach(([x, y], i) => points[i].set(x - .5, y - .5, 0).applyMatrix4(mesh.matrixWorld));
      if (patch(4)) return true;
    }
    return false;
  }
  return Object.freeze({
    begin(nextViewport) {
      viewport = nextViewport;
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      eye.setFromMatrixPosition(camera.matrixWorld); occlusion.update();
    },
    aurora, meteor,
  });
}
