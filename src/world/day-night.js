// Rendering-independent, linear RGB parameters. The caller supplies the shared
// game clock snapshot; animation time and wall time never enter this calculation.
const smoothstep = (lo, hi, value) => {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const rgb = hex => hex.match(/\w\w/g).map(channel => {
  const v = parseInt(channel, 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const palette = {
  skyTop: [rgb('080f25'), rgb('81b5d4'), rgb('8e94aa')],
  horizon: [rgb('283e50'), rgb('b9ccc3'), rgb('bca69b')],
  ambientSky: [rgb('9caecb'), rgb('dfede9'), rgb('ded0c3')],
  ambientGround: [rgb('39445a'), rgb('5e6f4b'), rgb('6a6257')],
  sunColor: [rgb('efb68c'), rgb('fff0cd'), rgb('efb68c')],
  waterDeep: [[0.009, 0.025, 0.042], [0.055, 0.24, 0.25], [0.09, 0.115, 0.13]],
  waterReflection: [[0.04, 0.07, 0.12], [0.61, 0.75, 0.71], [0.38, 0.32, 0.30]],
};

export const INITIAL_DAY_CLOCK = Object.freeze({ cycleSeconds: 0, timeOfDay: 'day', phaseProgress: 0 });

export function createEnvironmentParameters() {
  return { ...Object.fromEntries(Object.keys(palette).map(key => [key, [0, 0, 0]])),
    sunDirection: [0, 0, 0], moonDirection: [0, 0, 0] };
}

// Reuse target in the render loop: no materials, vectors or GPU resources are
// created here. Absolute clock sampling also handles a multi-cycle slow frame.
export function sampleDayNight(clock, target = createEnvironmentParameters()) {
  const angle = clock.cycleSeconds / 360 * Math.PI * 2;
  const height = Math.sin((clock.phaseProgress + (clock.timeOfDay === 'night' ? 1 : 0)) * Math.PI);
  const daylight = smoothstep(-0.35, 0.35, height);
  const twilight = (1 - smoothstep(0.05, 0.4, Math.abs(height))) * 0.5;
  target.daylight = daylight;
  target.skyDaylight = smoothstep(-0.25, 0.1, height);
  target.ambientIntensity = 0.65 + daylight * 1.75;
  target.sunIntensity = 3.2 * smoothstep(-0.04, 0.5, height);
  target.moonIntensity = 0.55 * smoothstep(0.02, 0.5, -height);
  target.moonOpacity = smoothstep(0.02, 0.18, -height);
  target.sunHighlight = target.sunIntensity / 3.2 * 0.7;
  target.moonHighlight = target.moonIntensity / 0.55 * 0.16;
  target.waterDetail = 0.35 + daylight * 0.65;
  for (const key of Object.keys(palette)) {
    const [night, day, warm] = palette[key];
    for (let i = 0; i < 3; i++) {
      const base = night[i] + (day[i] - night[i]) * daylight;
      target[key][i] = base + (warm[i] - base) * twilight;
    }
  }
  const x = -Math.cos(angle), y = height * 0.55, z = -height * 0.84;
  const length = Math.hypot(x, y, z);
  target.sunDirection[0] = x / length;
  target.sunDirection[1] = y / length;
  target.sunDirection[2] = z / length;
  for (let i = 0; i < 3; i++) target.moonDirection[i] = -target.sunDirection[i];
  return target;
}
