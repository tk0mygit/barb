// Serialized into test-only renderer observers. Resource IDs establish
// lifetime/ownership; all other values are independently replayed from Git.
export function meteorSnapshot(object) {
  if (!object) return null;
  const geometry = object.geometry, material = object.material;
  return { name: object.name, visible: object.visible, position: object.position.toArray(),
    quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
    geometryId: geometry.id, materialId: material.id,
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, attribute]) =>
      [key, { itemSize: attribute.itemSize, count: attribute.count, version: attribute.version, array: Array.from(attribute.array) }])),
    indices: geometry.index ? Array.from(geometry.index.array) : null, drawRange: { ...geometry.drawRange },
    boundingSphere: { center: geometry.boundingSphere.center.toArray(), radius: geometry.boundingSphere.radius },
    uniforms: Object.fromEntries(Object.entries(material.uniforms).map(([key, uniform]) => [key, uniform.value])),
    material: { type: material.type, transparent: material.transparent, side: material.side, forceSinglePass: material.forceSinglePass,
      depthTest: material.depthTest, depthWrite: material.depthWrite, fog: material.fog, blending: material.blending,
      vertexShader: material.vertexShader, fragmentShader: material.fragmentShader },
    renderOrder: object.renderOrder, frustumCulled: object.frustumCulled, castShadow: object.castShadow, receiveShadow: object.receiveShadow };
}
