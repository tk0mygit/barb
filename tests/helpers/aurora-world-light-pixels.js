// Browser-side photometry of actual PNGs, including independent object masks.
export async function measureAuroraWorldLight(before, after, moonScreen) {
  const cache = new Map();
  const decode = async url => {
    if (cache.has(url)) return cache.get(url);
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const result = { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    cache.set(url, result); return result;
  };
  const images = async parts => ({ full: await decode(parts.full.image), meshOff: await decode(parts.meshOff.image),
    ambientOff: await decode(parts.ambientOff.image), waterOff: await decode(parts.waterOff.image),
    lightOff: await decode(parts.lightOff.image), bothOff: await decode(parts.bothOff.image),
    masks: Object.fromEntries(await Promise.all(Object.entries(parts.masks).map(async ([key, url]) => [key, await decode(url)]))) });
  const a = await images(before), b = await images(after), { width, height } = b.full;
  const y = (data, i) => data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
  const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const linearY = (data, i) => linear(data[i] / 255) * .2126 + linear(data[i + 1] / 255) * .7152 + linear(data[i + 2] / 255) * .0722;
  const delta = (x, z, i) => Math.max(...[0, 1, 2].map(c => Math.abs(x[i + c] - z[i + c])));
  const marked = (image, i) => Math.max(image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]) > 32;
  const hues = image => {
    const counts = { emerald: 0, cyan: 0, violet: 0 }, points = {}, histogram = new Array(36).fill(0);
    let selected = 0;
    for (let p = 0; p < width * height; p++) {
      const i = p * 4, rgb = Array.from(image.pixels.slice(i, i + 3)), [r, g, bl] = rgb.map(v => v / 255);
      const max = Math.max(r, g, bl), min = Math.min(r, g, bl), span = max - min;
      if (max < 8 / 255 || span / max < .25) continue;
      let hue = max === r ? 60 * ((g - bl) / span % 6) : max === g ? 60 * ((bl - r) / span + 2) : 60 * ((r - g) / span + 4);
      hue = (hue + 360) % 360;
      const name = hue >= 80 && hue < 165 ? 'emerald' : hue >= 165 && hue < 235 ? 'cyan' : hue >= 235 && hue < 330 ? 'violet' : null;
      histogram[Math.floor(hue / 10)]++; selected++;
      if (name) {
        counts[name]++;
        if (!points[name] || y(image.pixels, i) > points[name].luminance) points[name] = {
          x: p % width, y: Math.floor(p / width), rgb, hue, luminance: y(image.pixels, i),
          sceneRGB: Array.from(b.lightOff.pixels.slice(i, i + 3)) };
      }
    }
    return { selected, counts, fractions: Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count / Math.max(selected, 1)])), points, histogram };
  };
  const maskedDifference = (on, off, mask) => {
    let area = 0, changed = 0, distinct = 0, sum = 0, positive = 0, maximum = 0;
    const rgbSum = [0, 0, 0];
    for (let i = 0; i < on.pixels.length; i += 4) if (marked(mask, i)) {
      area++; const d = delta(on.pixels, off.pixels, i), dy = y(on.pixels, i) - y(off.pixels, i);
      if (d) changed++; if (d >= 2) distinct++; if (dy > 0) positive++;
      maximum = Math.max(maximum, d); sum += dy;
      for (let c = 0; c < 3; c++) rgbSum[c] += on.pixels[i + c] - off.pixels[i + c];
    }
    return { area, changed, distinct, positive, maximum, meanLuminanceDelta: sum / Math.max(area, 1),
      meanRGBDelta: rgbSum.map(v => v / Math.max(area, 1)), changedFraction: changed / Math.max(area, 1) };
  };
  let offMaximum = 0, offChanged = 0, area = 0, beforeY = 0, afterY = 0, beforeContribution = 0, afterContribution = 0;
  let beforeLinear = 0, afterLinear = 0, lowerMesh = 0, clipped = 0, moonPixels = 0, moonChanged = 0;
  const histogramBefore = new Array(256).fill(0), histogramAfter = new Array(256).fill(0);
  const [mx, my, mz] = moonScreen, moonX = (mx + 1) * width / 2, moonY = (1 - my) * height / 2;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4, row = Math.floor(p / width), col = p % width, d = delta(a.bothOff.pixels, b.bothOff.pixels, i);
    offMaximum = Math.max(offMaximum, d); if (d) offChanged++;
    const bodyDelta = delta(b.lightOff.pixels, b.bothOff.pixels, i);
    if (bodyDelta && row >= height * .60) lowerMesh++;
    if (mz > -1 && mz < 1 && Math.hypot(col - moonX, row - moonY) < height * .004
      && b.bothOff.pixels[i] > 170 && b.bothOff.pixels[i + 1] > 170) { moonPixels++; if (bodyDelta) moonChanged++; }
    if (Math.max(a.masks.aurora.pixels[i], a.masks.aurora.pixels[i + 1], a.masks.aurora.pixels[i + 2],
      b.masks.aurora.pixels[i], b.masks.aurora.pixels[i + 1], b.masks.aurora.pixels[i + 2]) <= 4) continue;
    area++;
    const ay = y(a.lightOff.pixels, i), by = y(b.lightOff.pixels, i);
    beforeY += ay; afterY += by; beforeContribution += ay - y(a.bothOff.pixels, i); afterContribution += by - y(b.bothOff.pixels, i);
    beforeLinear += linearY(a.lightOff.pixels, i); afterLinear += linearY(b.lightOff.pixels, i);
    histogramBefore[Math.min(255, Math.floor(ay))]++; histogramAfter[Math.min(255, Math.floor(by))]++;
    if (bodyDelta && Math.max(b.lightOff.pixels[i], b.lightOff.pixels[i + 1], b.lightOff.pixels[i + 2]) >= 250) clipped++;
  }
  const quantile = (histogram, q) => { let count = 0; for (let i = 0; i < histogram.length; i++) { count += histogram[i]; if (count >= area * q) return i; } return 0; };
  return { width, height, off: { maximum: offMaximum, changed: offChanged },
    colorBefore: hues(a.masks.aurora), colorAfter: hues(b.masks.aurora),
    brightness: { area, beforeMean: beforeY / Math.max(area, 1), afterMean: afterY / Math.max(area, 1),
      beforeContribution: beforeContribution / Math.max(area, 1), afterContribution: afterContribution / Math.max(area, 1),
      beforeLinearMean: beforeLinear / Math.max(area, 1), afterLinearMean: afterLinear / Math.max(area, 1),
      p50: [quantile(histogramBefore, .5), quantile(histogramAfter, .5)], p95: [quantile(histogramBefore, .95), quantile(histogramAfter, .95)],
      histogramBefore, histogramAfter, clipped, lowerMesh, moonPixels, moonChanged },
    boatAmbient: maskedDifference(b.full, b.ambientOff, b.masks.boat),
    terrainAmbient: maskedDifference(b.full, b.ambientOff, b.masks.terrain),
    waterReflection: maskedDifference(b.full, b.waterOff, b.masks.water),
    beforeBoat: maskedDifference(a.full, a.ambientOff, a.masks.boat), beforeWater: maskedDifference(a.full, a.waterOff, a.masks.water) };
}
