// Test-only, self-contained functions serialized into renderer observers.
// Replay loads the exact committed production factory independently.
export function auroraSnapshot(meshes) {
  if (!meshes?.length) return null;
  const geometry = meshes[0].geometry;
  return { geometryId: geometry.id,
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, a]) =>
      [key, { itemSize: a.itemSize, count: a.count, version: a.version, array: Array.from(a.array) }])),
    indices: Array.from(geometry.index.array), indexVersion: geometry.index.version,
    drawRange: { ...geometry.drawRange },
    boundingSphere: { center: geometry.boundingSphere.center.toArray(), radius: geometry.boundingSphere.radius },
    layers: meshes.map(mesh => ({ name: mesh.name, visible: mesh.visible, geometryId: mesh.geometry.id,
      materialId: mesh.material.id, position: mesh.position.toArray(), quaternion: mesh.quaternion.toArray(), scale: mesh.scale.toArray(),
      uniforms: Object.fromEntries(Object.entries(mesh.material.uniforms).map(([key, u]) => [key, u.value])),
      material: { type: mesh.material.type, transparent: mesh.material.transparent, side: mesh.material.side,
        forceSinglePass: mesh.material.forceSinglePass, depthTest: mesh.material.depthTest,
        depthWrite: mesh.material.depthWrite, fog: mesh.material.fog, blending: mesh.material.blending,
        vertexShader: mesh.material.vertexShader, fragmentShader: mesh.material.fragmentShader },
      renderOrder: mesh.renderOrder, frustumCulled: mesh.frustumCulled, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow })) };
}

export function observeAuroraGPU(renderer) {
  const gl = renderer.getContext(), bindings = new Map(), ids = new WeakMap(), uploads = new WeakMap();
  let nextId = 0;
  const bind = gl.bindBuffer, data = gl.bufferData, sub = gl.bufferSubData;
  gl.bindBuffer = function(target, buffer) { bindings.set(target, buffer); return bind.apply(this, arguments); };
  const record = (target, array) => {
    const buffer = bindings.get(target);
    if (!buffer || !ArrayBuffer.isView(array)) return;
    if (!ids.has(buffer)) ids.set(buffer, ++nextId);
    const previous = uploads.get(array);
    uploads.set(array, { id: ids.get(buffer), bytes: array.byteLength, uploads: (previous?.uploads ?? 0) + 1 });
  };
  gl.bufferData = function(target, array) { record(target, array); return data.apply(this, arguments); };
  gl.bufferSubData = function(target, offset, array) { record(target, array); return sub.apply(this, arguments); };
  return meshes => {
    if (!meshes?.length) return null;
    const geometry = meshes[0].geometry;
    const layers = meshes.map(mesh => ({ geometryId: mesh.geometry.id, materialId: mesh.material.id,
      programKeys: [...(renderer.properties.get(mesh.material).programs?.values() ?? [])].map(p => p.cacheKey).sort() }));
    const keys = [...new Set(layers.flatMap(layer => layer.programKeys))].sort();
    return { objects: meshes.length, layers, programKeys: keys,
      programInstances: renderer.info.programs.filter(p => keys.includes(p.cacheKey)).length,
      buffers: Object.fromEntries([...Object.entries(geometry.attributes), ['index', geometry.index]].map(([key, a]) =>
        [key, uploads.get(a.array) ?? null])) };
  };
}
