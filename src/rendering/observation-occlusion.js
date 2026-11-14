import { Box3, Matrix4, Ray, Vector3 } from 'three';

const visible = object => {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return object.material?.visible !== false && object.material?.opacity !== 0;
};

function tree(boxes) {
  if (!boxes.length) return null;
  const bounds = new Box3();
  for (const box of boxes) bounds.union(box);
  if (boxes.length <= 8) return { bounds, boxes };
  const size = bounds.getSize(new Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  boxes.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
  const mid = Math.floor(boxes.length / 2);
  return { bounds, left: tree(boxes.slice(0, mid)), right: tree(boxes.slice(mid)) };
}

// Build once from immutable scenery. Triangle AABBs preserve the open lake
// inside the shore/ridge rings; one enclosing world box would cover the eye.
// Instance AABBs deliberately treat foliage gaps as solid. No mesh raycasts,
// per-frame scene/forest traversal, GPU resources or randomness are needed.
export function createObservationOcclusion(scene) {
  scene.updateMatrixWorld(true);
  const boxes = [], dynamic = [], instance = new Matrix4(), matrix = new Matrix4();
  const point = new Vector3();
  scene.traverse(object => {
    if (!object.isMesh || object.isSky || object.name === 'lake-water'
      || object.name.startsWith('clear-night-') || object.material?.isShaderMaterial) return;
    const staticScenery = (() => {
      for (let node = object; node; node = node.parent) if (node.name === 'lake-scenery') return true;
      return false;
    })();
    const positions = object.geometry.attributes.position;
    if (!staticScenery) {
      dynamic.push({ object, local: new Box3(), world: new Box3(), geometry: null, version: -1 });
    } else if (object.isInstancedMesh) {
      const local = new Box3().setFromBufferAttribute(positions);
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance); matrix.multiplyMatrices(object.matrixWorld, instance);
        boxes.push(local.clone().applyMatrix4(matrix));
      }
    } else {
      const index = object.geometry.index, count = index?.count ?? positions.count;
      for (let i = 0; i < count; i += 3) {
        const box = new Box3();
        for (let j = 0; j < 3; j++) box.expandByPoint(point.fromBufferAttribute(positions, index ? index.getX(i + j) : i + j)
          .applyMatrix4(object.matrixWorld));
        boxes.push(box);
      }
    }
  });
  const root = tree(boxes), ray = new Ray(), expanded = new Box3(), hit = new Vector3();
  const center = new Vector3(), size = new Vector3();
  let distance, aperture;
  function intersects(box) {
    // The ray cone encloses the entire candidate patch, not just its centre.
    // Expanding by the farthest possible distance overestimates occlusion.
    box.getCenter(center); box.getSize(size);
    const radius = aperture * (center.distanceTo(ray.origin) + size.length() / 2) + .01;
    expanded.copy(box).expandByScalar(radius);
    if (expanded.containsPoint(ray.origin)) return true;
    return ray.intersectBox(expanded, hit) !== null && hit.distanceTo(ray.origin) <= distance;
  }
  function blocked(node) {
    if (!node || !intersects(node.bounds)) return false;
    return node.boxes ? node.boxes.some(intersects) : blocked(node.left) || blocked(node.right);
  }
  return Object.freeze({
    update() {
      for (const row of dynamic) {
        const { object } = row;
        if (!visible(object)) continue;
        const position = object.geometry.attributes.position;
        if (row.geometry !== object.geometry || row.version !== position.version) {
          row.local.setFromBufferAttribute(position); row.geometry = object.geometry; row.version = position.version;
        }
        row.world.copy(row.local).applyMatrix4(object.matrixWorld);
      }
    },
    isClear(origin, direction, far, tanAngle) {
      ray.set(origin, direction); distance = far; aperture = tanAngle;
      if (blocked(root)) return false;
      return !dynamic.some(row => visible(row.object) && intersects(row.world));
    },
  });
}
