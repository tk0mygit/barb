export const BUYER_LINES = Object.freeze([
  'いい魚ですね。こちらの金額で買い取ります。',
  'ありがとうございます。また釣れたらお持ちください。',
  '今日も良い釣果ですね。代金をお受け取りください。',
  '確かにお預かりしました。次の釣りも楽しんでください。',
]);

// Never consume Math.random/the fishing stream, even when the caller does not
// inject a presentation RNG. getRandomValues works on Pages and localhost.
export function pickBuyerLine(random = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) {
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('Random value must be in [0, 1)');
  return BUYER_LINES[Math.floor(roll * BUYER_LINES.length)];
}
