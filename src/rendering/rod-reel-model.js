import * as THREE from 'three';

// A complete assembly has two draw calls. Each model owns one fixed vertex
// buffer; selecting a level rewrites that buffer, never creates GPU resources.
// The factory owns their one shared material and the immutable CPU templates.
const VERTEX_CAPACITY = 3000;
const TIP = Object.freeze([0, 1, 0]);

export const ROD_REEL_APPEARANCES = Object.freeze({
  rod: Object.freeze([
    'thin blank, straight grip, three guides',
    'four guides and flared end cap',
    'two-tone sections and lower reinforcement sleeve',
    'paired reinforcement collars and faceted end cap',
    'split grip and five-guide carbon-style blank',
    'contoured butt and three raised reinforcement ribs',
    'slender shaft and double-foot guide supports',
    'forked tip support and pointed end cap',
    'premium split grip, paired rings and six guides',
    'sculpted butt, triple rings and seven guides',
  ]),
  reel: Object.freeze([
    'small round housing and plain spool',
    'housing end fin and spool end collar',
    'faceted housing and raised side panel',
    'paired shoulder panels and chamfered spool rim',
    'spool shroud and three structural ribs',
    'elongated housing and five shroud ribs',
    'slim housing and stepped spool rim',
    'slim housing with crown rim and open bridge',
    'precision double rim and twin side panels',
    'triple stepped rim, split bridge and perimeter lugs',
  ]),
});

// Extract once, then dispose the temporary Three geometry. No live template
// Geometry/Material is retained and no complete per-level model is cached.
function template(source) {
  const flat = source.index ? source.toNonIndexed() : source;
  const positions = new Float32Array(flat.attributes.position.array);
  const shade = new Float32Array(positions.length / 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const light = new THREE.Vector3(-0.3, 0.5, 0.8).normalize();
  for (let i = 0; i < positions.length; i += 9) {
    a.fromArray(positions, i); b.fromArray(positions, i + 3); c.fromArray(positions, i + 6);
    b.sub(a); c.sub(a); b.cross(c).normalize();
    const brightness = 0.72 + 0.28 * Math.max(0, b.dot(light));
    shade.fill(brightness, i / 3, i / 3 + 3);
  }
  if (flat !== source) flat.dispose();
  source.dispose();
  return Object.freeze({ positions, shade });
}

function createTemplates() {
  return Object.freeze({
    cylinder: template(new THREE.CylinderGeometry(1, 1, 1, 6, 1)),
    panel: template(new THREE.CylinderGeometry(1, 1, 1, 8, 1)),
    ring: template(new THREE.TorusGeometry(1, 0.16, 3, 8)),
    box: template(new THREE.BoxGeometry(1, 1, 1)),
    body: template(new THREE.SphereGeometry(1, 8, 4)),
    point: template(new THREE.OctahedronGeometry(1)),
  });
}

function createModel(kind, templates, material) {
  const group = new THREE.Group(); group.name = `fishing-${kind}`;
  const positions = new Float32Array(VERTEX_CAPACITY * 3);
  const colors = new Float32Array(VERTEX_CAPACITY * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.type = kind === 'rod' ? 'RodGeometry' : 'ReelGeometry';
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.Mesh(geometry, material); mesh.name = `fishing-${kind}-mesh`;
  mesh.frustumCulled = false;
  // Draw after the world (0), before the existing lure/water guides (1).
  // Near casts can cross the static rod silhouette; equal opaque orders would
  // let material sorting paint the rod over the lure despite disabled depth.
  mesh.renderOrder = 0.5;
  group.add(mesh);
  const point = new THREE.Vector3(), color = new THREE.Color();
  let cursor = 0, labels;
  function add(name, shape, rgb, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, taper = 1) {
    labels.push(name);
    const { positions: vertices, shade } = templates[shape];
    if (cursor + vertices.length > positions.length) throw new RangeError('Rod/reel vertex budget exceeded');
    color.set(rgb);
    const cosX = Math.cos(rx), sinX = Math.sin(rx), cosY = Math.cos(ry), sinY = Math.sin(ry), cosZ = Math.cos(rz), sinZ = Math.sin(rz);
    for (let i = 0; i < vertices.length; i += 3) {
      point.fromArray(vertices, i);
      const radial = shape === 'cylinder' || shape === 'panel' ? 1 + (taper - 1) * (point.y + 0.5) : 1;
      point.x *= sx * radial; point.y *= sy; point.z *= sz * radial;
      let first = point.y * cosX - point.z * sinX, second = point.y * sinX + point.z * cosX;
      point.y = first; point.z = second;
      first = point.x * cosY + point.z * sinY; second = -point.x * sinY + point.z * cosY;
      point.x = first; point.z = second;
      first = point.x * cosZ - point.y * sinZ; second = point.x * sinZ + point.y * cosZ;
      positions[cursor] = first + x; positions[cursor + 1] = second + y; positions[cursor + 2] = point.z + z;
      const light = shade[i / 3];
      colors[cursor] = color.r * light; colors[cursor + 1] = color.g * light; colors[cursor + 2] = color.b * light;
      cursor += 3;
    }
  }
  function cylinder(name, rgb, x, from, z, radius, length, taper = 1, axis = 0) {
    add(name, 'cylinder', rgb, x, from + (axis ? 0 : length / 2), z,
      radius, length, radius, axis, 0, 0, taper);
  }
  const ring = (name, rgb, x, y, z, radius, thickness = 1, rx = Math.PI / 2) =>
    add(name, 'ring', rgb, x, y, z, radius, radius, radius * thickness, rx);
  const box = (name, rgb, x, y, z, sx, sy, sz, rz = 0) => add(name, 'box', rgb, x, y, z, sx, sy, sz, 0, 0, rz);

  function buildRod(level) {
    const band = Math.ceil(level / 2), upper = level % 2 === 0;
    const blank = ['#8b9a8c', '#436969', '#354c52', '#3f5869', '#48645e'][band - 1];
    const metal = band === 5 ? '#e0c88c' : '#c6d4c7';
    const guides = [3, 4, 4, 4, 5, 5, 5, 5, 6, 7][level - 1];
    cylinder('lower-blank', blank, 0, 0.18, 0, 0.012 - band * 0.0005, 0.32, 0.82);
    cylinder('middle-blank', band >= 2 ? '#a4b4ae' : blank, 0, 0.50, 0, 0.008, 0.28, 0.65);
    cylinder('tip-blank', blank, 0, 0.78, 0, 0.0052, 0.22, 0.32);
    if (band <= 2) cylinder('straight-grip', '#786854', 0, 0.01, 0, 0.031, 0.16, band === 2 ? 0.86 : 1);
    else {
      cylinder('lower-split-grip', '#3e4543', 0, 0.012, 0, upper ? 0.035 : 0.030, 0.064, upper ? 0.76 : 0.94);
      cylinder('upper-split-grip', '#59645b', 0, 0.115, 0, 0.028, band === 5 ? 0.052 : 0.045, 0.86);
    }
    cylinder('reel-seat', '#9ca79a', 0, 0.174, 0, 0.019, 0.045, 0.92);
    if (level >= 2) cylinder('end-cap', metal, 0, 0, 0, upper ? 0.039 : 0.032, 0.012, upper ? 0.7 : 1);
    if (band >= 2) {
      cylinder('reinforcement-sleeve', '#788b86', 0, 0.235, 0, 0.016, upper ? 0.095 : 0.058, 0.75);
      if (level === 4) for (const y of [0.238, 0.315]) ring('paired-collar', metal, 0, y, 0, 0.017, 0.7);
    }
    if (level === 6) for (const x of [-0.022, 0, 0.022]) box('butt-rib', '#a7b9b1', x, 0.040, 0.023, 0.005, 0.049, 0.007);
    if (band >= 4) ring('seat-ring', metal, 0, 0.210, 0, 0.020, 0.7);
    if (level === 8) add('pointed-end-cap', 'point', metal, 0, -0.004, 0, 0.028, 0.024, 0.028);
    if (band === 5) {
      for (const y of upper ? [0.077, 0.092, 0.109] : [0.081, 0.102]) ring('premium-grip-ring', metal, 0, y, 0, 0.022, 0.7);
      if (upper) {
        cylinder('sculpted-butt', '#ad9870', 0, 0.016, 0, 0.041, 0.029, 0.60);
        box('butt-spine', metal, 0, 0.044, 0.031, 0.010, 0.045, 0.008);
      }
    }
    for (let i = 0; i < guides - 1; i++) {
      const y = 0.32 + i * 0.58 / (guides - 1), radius = 0.018 - i * 0.0015;
      ring('guide-ring', metal, 0, y, 0.020, radius, 0.7);
      box('guide-foot', blank, 0, y - 0.009, 0.011, 0.005, 0.022, 0.020);
      if (band >= 4) box('second-guide-foot', metal, 0, y + 0.014, 0.010, 0.004, 0.018, 0.018);
    }
    ring('tip-guide', metal, 0, 1, 0, level >= 8 ? 0.0095 : 0.008, 0.6);
    if (level === 8 || level === 10) for (const x of [-0.007, 0.007]) box('forked-tip-support', blank, x, 0.982, 0, 0.003, 0.030, 0.003);
  }

  function buildReel(level) {
    const band = Math.ceil(level / 2), upper = level % 2 === 0;
    const shell = ['#7d8980', '#66817f', '#52646d', '#657a87', '#6f7b6b'][band - 1];
    const metal = band === 5 ? '#ddc894' : '#c3d3ce';
    const width = band === 4 ? 0.043 : level === 6 ? 0.063 : 0.056;
    box('mount-stem', '#5b6660', 0.029, 0.17, 0.01, 0.058, 0.016, 0.022);
    add('housing', band >= 2 ? 'panel' : 'body', shell, 0.055, 0.115, 0.035,
      width, band >= 2 ? 0.067 : 0.060, band >= 2 ? 0.048 : 0.042, Math.PI / 2, 0, band === 4 ? 0.2 : 0);
    cylinder('spool', '#8d9f9a', 0.054, 0.166, 0.048, band === 4 ? 0.031 : 0.036, 0.062, 0.87);
    ring('spool-rim', metal, 0.054, 0.225, 0.048, band === 4 ? 0.034 : 0.040, 0.8);
    add('crank-hub', 'panel', metal, 0.094, 0.125, 0.048, 0.012, 0.018, 0.012, 0, 0, Math.PI / 2);
    box('crank-arm', '#aabbb2', 0.119, 0.112, 0.048, 0.069, 0.012, 0.012, -0.4);
    cylinder('handle-knob', '#46564f', 0.150, 0.080, 0.048, 0.015, 0.033, 0.88);
    if (level === 2) box('end-fin', metal, 0.054, 0.075, 0.074, 0.048, 0.015, 0.017);
    if (level === 2) ring('end-collar', metal, 0.054, 0.173, 0.048, 0.037, 0.5);
    if (band >= 2) add('side-panel', 'panel', metal, 0.055, 0.115, 0.074, 0.038, 0.008, 0.030, Math.PI / 2);
    if (level === 4) for (const x of [0.011, 0.099]) box('shoulder-panel', metal, x, 0.155, 0.040, 0.014, 0.027, 0.065, x < 0.05 ? -0.3 : 0.3);
    if (band === 3) {
      ring('spool-shroud', shell, 0.054, 0.183, 0.048, 0.046, 1.5);
      const count = upper ? 5 : 3;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI * 0.7 + i * Math.PI * 1.4 / (count - 1);
        box('shroud-rib', metal, 0.054 + Math.sin(angle) * 0.043, 0.198, 0.048 + Math.cos(angle) * 0.043, 0.006, 0.034, 0.006);
      }
    }
    if (band >= 4) ring('stepped-rim', shell, 0.054, 0.216, 0.048, 0.044, 0.7);
    if (level === 8) {
      for (const x of [0.022, 0.086]) box('open-bridge', metal, x, 0.174, 0.040, 0.006, 0.052, 0.009, x < 0.05 ? -0.12 : 0.12);
      for (const x of [0.025, 0.083]) add('crown-rim', 'point', metal, x, 0.227, 0.048, 0.009, 0.012, 0.009);
    }
    if (band === 5) {
      ring('precision-rim', metal, 0.054, 0.232, 0.048, upper ? 0.047 : 0.043, 0.6);
      for (const x of [0.025, 0.085]) box('twin-side-panel', '#a4b7a7', x, 0.116, 0.080, 0.015, 0.052, 0.008);
      if (upper) {
        ring('final-rim', '#647c78', 0.054, 0.241, 0.048, 0.039, 0.7);
        for (const x of [0.020, 0.088]) box('split-bridge', metal, x, 0.172, 0.048, 0.008, 0.045, 0.010, x < 0.05 ? -0.15 : 0.15);
        for (const x of [0.010, 0.100]) box('perimeter-lug', metal, x, 0.100, 0.073, 0.015, 0.025, 0.012);
      }
    }
  }

  return {
    group, geometry,
    setLevel(level) {
      if (group.userData.level === level) return false;
      cursor = 0; labels = [];
      if (kind === 'rod') buildRod(level); else buildReel(level);
      geometry.setDrawRange(0, cursor / 3);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      // Bounds use only active vertices, not trailing data from another level.
      geometry.boundingBox = geometry.boundingBox ?? new THREE.Box3();
      geometry.boundingBox.makeEmpty();
      for (let i = 0; i < cursor; i += 3) geometry.boundingBox.expandByPoint(point.fromArray(positions, i));
      geometry.boundingSphere = geometry.boundingSphere ?? new THREE.Sphere();
      geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
      group.userData.level = level;
      group.userData.band = Math.ceil(level / 2);
      group.userData.appearance = ROD_REEL_APPEARANCES[kind][level - 1];
      group.userData.parts = Object.freeze(labels);
      group.userData.triangles = cursor / 9;
      return true;
    },
  };
}

export function createRodReelModel() {
  const templates = createTemplates();
  // This matches the existing lure shader contract: no normal/uv attributes,
  // vertex colours, unlit and fog-aware, with the same depth behaviour.
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const rodModel = createModel('rod', templates, material), reelModel = createModel('reel', templates, material);
  const group = new THREE.Group(); group.name = 'fishing-rod-reel'; group.userData.tip = TIP;
  group.add(rodModel.group, reelModel.group);
  let disposed = false;
  const setLevels = (levels) => {
    if (disposed) throw new Error('Rod/reel model is disposed');
    if (!levels || typeof levels !== 'object') throw new TypeError('Rod/reel level settings are required');
    const { rodLevel, reelLevel } = levels;
    for (const level of [rodLevel, reelLevel]) {
      if (!Number.isSafeInteger(level) || level < 1 || level > 10) throw new RangeError('Rod/reel levels must be integers from 1 to 10');
    }
    const rodChanged = rodModel.setLevel(rodLevel), reelChanged = reelModel.setLevel(reelLevel);
    return rodChanged || reelChanged;
  };
  setLevels({ rodLevel: 1, reelLevel: 1 });
  return {
    group, rod: rodModel.group, reel: reelModel.group, setLevels,
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      rodModel.geometry.dispose(); reelModel.geometry.dispose(); material.dispose();
    },
  };
}
