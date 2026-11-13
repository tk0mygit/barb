// Test-only and self-contained: serialized into the existing renderer observer.
// It changes no product state during ordinary observation and creates no GPU asset.
export function observeAuroraWorldLight(renderer, observeBuffers) {
  const gl = renderer.getContext(), waterGPU = observeBuffers(renderer), locations = new WeakMap();
  const uniform = (program, name) => {
    if (!program) return null;
    let names = locations.get(program);
    if (!names) { names = new Map(); locations.set(program, names); }
    if (!names.has(name)) names.set(name, gl.getUniformLocation(program.program, name));
    const location = names.get(name);
    if (location === null) return null;
    const value = gl.getUniform(program.program, location);
    return ArrayBuffer.isView(value) ? Array.from(value) : value;
  };
  const programs = material => [...(renderer.properties.get(material).programs?.values() ?? [])];
  const read = (scene, { gpu = false } = {}) => {
    const ambient = scene.children.find(o => o.isHemisphereLight), water = scene.getObjectByName('lake-water');
    const u = water.material.uniforms, geometry = water.geometry, material = water.material;
    let litProgram;
    if (gpu) scene.traverse(object => {
      if (litProgram || !object.material?.isMeshStandardMaterial) return;
      litProgram = programs(object.material).find(program => uniform(program, 'hemisphereLights[0].skyColor') !== null);
    });
    const waterPrograms = programs(material), program = waterPrograms[0];
    return {
      model: u.auroraStrength ? 'aurora-world-light-v1' : 'baseline',
      ambient: { id: ambient.id, color: ambient.color.toArray(), ground: ambient.groundColor.toArray(), intensity: ambient.intensity },
      lights: scene.children.filter(o => o.isLight).map(light => ({ id: light.id, type: light.type, castShadow: light.castShadow,
        color: light.color.toArray(), ground: light.groundColor?.toArray() ?? null, intensity: light.intensity,
        position: light.position.toArray(), target: light.target?.position.toArray() ?? null,
        shadowMapSize: light.castShadow ? light.shadow.mapSize.toArray() : null,
        shadowTarget: Boolean(light.shadow?.map) })),
      hemisphereGPU: gpu ? { programKey: litProgram?.cacheKey ?? null,
        sky: uniform(litProgram, 'hemisphereLights[0].skyColor'), ground: uniform(litProgram, 'hemisphereLights[0].groundColor') } : null,
      water: { geometryId: geometry.id, materialId: material.id,
        attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, a]) => [key,
          { itemSize: a.itemSize, count: a.count, version: a.version, bytes: a.array.byteLength }])),
        index: { count: geometry.index.count, version: geometry.index.version, bytes: geometry.index.array.byteLength },
        drawRange: { start: geometry.drawRange.start, count: Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : geometry.index.count },
        material: { type: material.type, fog: material.fog, transparent: material.transparent, side: material.side,
          depthTest: material.depthTest, depthWrite: material.depthWrite, forceSinglePass: material.forceSinglePass, blending: material.blending,
          vertexShader: material.vertexShader, fragmentShader: material.fragmentShader },
        light: u.auroraStrength ? { color: u.auroraColor.value.toArray(), strength: u.auroraStrength.value,
          direction: u.auroraDirection.value.toArray() } : null,
        gpuLight: gpu ? { color: uniform(program, 'auroraColor'), strength: uniform(program, 'auroraStrength'), direction: uniform(program, 'auroraDirection') } : null,
        gpu: waterGPU([water]) },
    };
  };

  const capture = (scene, camera, render, base) => {
    const ambient = scene.children.find(o => o.isHemisphereLight), water = scene.getObjectByName('lake-water');
    const u = water.material.uniforms, auroras = [0, 1].map(i => scene.getObjectByName(`clear-night-aurora-${i}`));
    const original = { sky: ambient.color.toArray(), ground: ambient.groundColor.toArray(), intensity: ambient.intensity,
      strength: u.auroraStrength?.value, color: u.auroraColor?.value.toArray(), direction: u.auroraDirection?.value.toArray(),
      visible: auroras.map(mesh => mesh.visible) };
    const restoreLight = () => {
      ambient.color.fromArray(original.sky); ambient.groundColor.fromArray(original.ground); ambient.intensity = original.intensity;
      if (u.auroraStrength) {
        u.auroraStrength.value = original.strength; u.auroraColor.value.fromArray(original.color); u.auroraDirection.value.fromArray(original.direction);
      }
      auroras.forEach((mesh, i) => { mesh.visible = original.visible[i]; });
    };
    const normalAmbient = () => {
      ambient.color.fromArray(base.ambientSky); ambient.groundColor.fromArray(base.ambientGround); ambient.intensity = base.ambientIntensity;
    };
    const waterOff = () => { if (u.auroraStrength) u.auroraStrength.value = 0; };
    const photo = () => { render(); return { image: renderer.domElement.toDataURL('image/png'), world: read(scene, { gpu: true }) }; };
    const result = {};
    try {
      result.full = photo();
      auroras.forEach(mesh => { mesh.visible = false; }); result.meshOff = photo(); restoreLight();
      normalAmbient(); result.ambientOff = photo(); restoreLight();
      waterOff(); result.waterOff = photo(); restoreLight();
      normalAmbient(); waterOff(); result.lightOff = photo();
      auroras.forEach(mesh => { mesh.visible = false; }); result.bothOff = photo();
      result.layers = auroras.map((mesh, i) => {
        mesh.visible = original.visible[i]; const part = photo(); mesh.visible = false; return part;
      });
      restoreLight();

      // Semantic masks retain the actual scene geometry/depth/alpha maps.
      // Existing emissive/color uniforms suffice: no material or mask shader.
      const materials = new Map(), visibility = new Map(), lights = scene.children.filter(o => o.isLight);
      const intensities = lights.map(light => light.intensity), fog = scene.fog.color.toArray(), background = scene.background.toArray();
      const waterValues = Object.fromEntries(['deepColor', 'reflectionColor', 'fogColor'].map(key => [key, u[key].value.toArray()]));
      const waterScalars = Object.fromEntries(['sunHighlight', 'moonHighlight', 'waterDetail'].map(key => [key, u[key].value]));
      const boat = scene.children.find(o => o.isGroup && o.children.some(child => child.geometry?.type === 'ExtrudeGeometry'));
      const terrain = scene.getObjectByName('lake-scenery');
      const belongs = (object, root) => { for (let p = object; p; p = p.parent) if (p === root) return true; return false; };
      const objects = [];
      scene.traverse(object => {
        objects.push(object);
        const material = object.material;
        if (material && !materials.has(material)) materials.set(material, {
          color: material.color?.toArray(), emissive: material.emissive?.toArray() });
        if ((material?.isShaderMaterial && object !== water && !auroras.includes(object)) || object.isSky) {
          visibility.set(object, object.visible); object.visible = false;
        }
      });
      const mask = target => {
        for (const [material] of materials) {
          material.color?.setRGB(0, 0, 0); material.emissive?.setRGB(0, 0, 0);
        }
        lights.forEach(light => { light.intensity = 0; }); scene.fog.color.setRGB(0, 0, 0); scene.background.setRGB(0, 0, 0);
        for (const key of Object.keys(waterValues)) u[key].value.setRGB(0, 0, 0);
        for (const key of Object.keys(waterScalars)) u[key].value = 0;
        waterOff();
        auroras.forEach((mesh, i) => { mesh.visible = target === 'aurora' && original.visible[i]; });
        if (target === 'boat' || target === 'terrain') for (const object of objects) {
          if (belongs(object, target === 'boat' ? boat : terrain)) object.material?.emissive?.setRGB(8, 8, 8);
        }
        if (target === 'water') { u.deepColor.value.setRGB(8, 8, 8); u.reflectionColor.value.setRGB(8, 8, 8); }
        render(); return renderer.domElement.toDataURL('image/png');
      };
      try { result.masks = Object.fromEntries(['aurora', 'boat', 'terrain', 'water'].map(name => [name, mask(name)])); }
      finally {
        for (const [material, values] of materials) {
          if (values.color) material.color.fromArray(values.color); if (values.emissive) material.emissive.fromArray(values.emissive);
        }
        for (const [object, visible] of visibility) object.visible = visible;
        lights.forEach((light, i) => { light.intensity = intensities[i]; });
        scene.fog.color.fromArray(fog); scene.background.fromArray(background);
        for (const [key, value] of Object.entries(waterValues)) u[key].value.fromArray(value);
        for (const [key, value] of Object.entries(waterScalars)) u[key].value = value;
      }
      return result;
    } finally { restoreLight(); render(); }
  };
  return { read, capture };
}
