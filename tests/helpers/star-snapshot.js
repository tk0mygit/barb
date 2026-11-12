// Serialized into the browser observer; no product debug endpoint. IDs are
// checked for lifetime stability there, while source replay compares values.
export function starSnapshot(object) {
  if (!object) return null;
  return {
    name: object.name, visible: object.visible, position: object.position.toArray(),
    quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
    geometryId: object.geometry.id, materialId: object.material.id,
    attributes: Object.fromEntries(Object.entries(object.geometry.attributes).map(([key, attribute]) =>
      [key, { itemSize: attribute.itemSize, count: attribute.count, version: attribute.version, array: Array.from(attribute.array) }])),
    drawRange: { ...object.geometry.drawRange },
    uniforms: Object.fromEntries(Object.entries(object.material.uniforms).map(([key, uniform]) => [key, uniform.value])),
    material: { type: object.material.type, transparent: object.material.transparent,
      depthTest: object.material.depthTest, depthWrite: object.material.depthWrite, fog: object.material.fog,
      vertexColors: object.material.vertexColors, blending: object.material.blending,
      vertexShader: object.material.vertexShader, fragmentShader: object.material.fragmentShader },
    renderOrder: object.renderOrder, frustumCulled: object.frustumCulled,
    castShadow: object.castShadow, receiveShadow: object.receiveShadow,
  };
}
