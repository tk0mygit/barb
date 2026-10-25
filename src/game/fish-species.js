// Public, ordinary fish only. Values are tunable game balance, not biological limits.
// Units: length cm, mass kg, basePricePerKg in game currency/kg.
// Weight = referenceWeightKg * (length / referenceLengthCm) ** exponent, rounded to 0.01kg.
// Resistance = baseResistance + (length - minLengthCm) / lengthScaleCm
//              + surgeAmplitude * sin(seconds * surgeFrequency), in radians/second.
// All species can be encountered; lure/appearance balance lives in separate modules.
import { defineFishSpecies as species, createFishSpeciesRegistry } from './fish-species-registry.js';

// Keep the existing ID, display name and Phase 2 balance for compatibility.
export const BLACK_BASS = species({
  id: 'black-bass', name: 'ブラックバス', alternateName: 'ラージマウスバス',
  minLengthCm: 25, maxLengthCm: 55,
  weight: { referenceLengthCm: 40, referenceWeightKg: 1.1, exponent: 3 },
  fight: { baseResistance: 0.85, lengthScaleCm: 100, surgeAmplitude: 0.15, surgeFrequency: 2.4, style: '周期的な引きと短い突進' },
  basePricePerKg: 100,
  description: '大きな口と体側の黒い帯が特徴の淡水魚。水草や障害物の周辺に潜み、小魚などを捕らえる。',
  image: new URL('../assets/fish/black-bass.png', import.meta.url).href,
});

// Stable specification order, suitable for a future encyclopedia. Add records here.
const registry = createFishSpeciesRegistry([
  BLACK_BASS,
  species({
    id: 'smallmouth-bass', name: 'スモールマウスバス', minLengthCm: 20, maxLengthCm: 50,
    weight: { referenceLengthCm: 35, referenceWeightKg: 0.7, exponent: 3 },
    fight: { baseResistance: 0.95, lengthScaleCm: 100, surgeAmplitude: 0.2, surgeFrequency: 3, style: '素早い突進を繰り返す' },
    basePricePerKg: 120,
    description: '褐色がかった体と縦の模様を持つバスの仲間。岩の多い場所や流れのある水域を好み、小魚や甲殻類を食べる。',
    image: new URL('../assets/fish/smallmouth-bass.png', import.meta.url).href,
  }),
  species({
    id: 'bluegill', name: 'ブルーギル', minLengthCm: 10, maxLengthCm: 28,
    weight: { referenceLengthCm: 20, referenceWeightKg: 0.18, exponent: 3 },
    fight: { baseResistance: 0.55, lengthScaleCm: 120, surgeAmplitude: 0.1, surgeFrequency: 3.8, style: '小刻みに引く' },
    basePricePerKg: 70,
    description: '平たく丸みのある体と、えらぶた後方の暗い斑点が目印。岸近くの水草周辺に見られ、昆虫や小さな水生動物などを食べる。',
    image: new URL('../assets/fish/bluegill.png', import.meta.url).href,
  }),
  species({
    id: 'rainbow-trout', name: 'ニジマス', minLengthCm: 20, maxLengthCm: 65,
    weight: { referenceLengthCm: 40, referenceWeightKg: 0.8, exponent: 3 },
    fight: { baseResistance: 0.9, lengthScaleCm: 130, surgeAmplitude: 0.22, surgeFrequency: 3.2, style: '速い走りと強弱のある引き' },
    basePricePerKg: 130,
    description: '銀色の体に小さな黒点が散り、体側に桃色の帯が現れるサケの仲間。冷たく酸素の豊富な水を好む。',
    image: new URL('../assets/fish/rainbow-trout.png', import.meta.url).href,
  }),
  species({
    id: 'brown-trout', name: 'ブラウントラウト', minLengthCm: 20, maxLengthCm: 70,
    weight: { referenceLengthCm: 40, referenceWeightKg: 0.85, exponent: 3 },
    fight: { baseResistance: 1, lengthScaleCm: 140, surgeAmplitude: 0.2, surgeFrequency: 2.1, style: '粘り強く引き、時折突進する' },
    basePricePerKg: 140,
    description: '黄褐色の体に黒や赤の斑点が見られるサケの仲間。川や湖の冷たい水域にすみ、成長すると小魚も多く食べる。',
    image: new URL('../assets/fish/brown-trout.png', import.meta.url).href,
  }),
  species({
    id: 'iwana', name: 'イワナ', minLengthCm: 15, maxLengthCm: 45,
    weight: { referenceLengthCm: 30, referenceWeightKg: 0.3, exponent: 3 },
    fight: { baseResistance: 0.7, lengthScaleCm: 120, surgeAmplitude: 0.14, surgeFrequency: 2.8, style: '短い引きを繰り返す' },
    basePricePerKg: 160,
    description: '暗い体色に淡い斑点を持つ冷水性の魚。山地の渓流などにすみ、水生昆虫や水面に落ちた虫を食べる。',
    image: new URL('../assets/fish/iwana.png', import.meta.url).href,
  }),
  species({
    id: 'northern-pike', name: 'ノーザンパイク', minLengthCm: 40, maxLengthCm: 110,
    weight: { referenceLengthCm: 70, referenceWeightKg: 2.3, exponent: 3 },
    fight: { baseResistance: 1.15, lengthScaleCm: 180, surgeAmplitude: 0.28, surgeFrequency: 2.5, style: '鋭い突進と休止を繰り返す' },
    basePricePerKg: 110,
    description: '細長い体と平たく伸びた口先を持つ捕食魚。背びれは尾に近く、水草の陰から小魚へ素早く飛びかかる。',
    image: new URL('../assets/fish/northern-pike.png', import.meta.url).href,
  }),
  species({
    id: 'european-perch', name: 'ヨーロピアンパーチ', minLengthCm: 15, maxLengthCm: 45,
    weight: { referenceLengthCm: 30, referenceWeightKg: 0.4, exponent: 3 },
    fight: { baseResistance: 0.75, lengthScaleCm: 120, surgeAmplitude: 0.16, surgeFrequency: 3.1, style: '細かな抵抗と短い突進' },
    basePricePerKg: 110,
    description: '体側の暗い縦帯と赤みを帯びた腹びれ・尻びれが特徴。湖や流れの緩やかな川にすみ、昆虫や小魚を食べる。',
    image: new URL('../assets/fish/european-perch.png', import.meta.url).href,
  }),
  species({
    id: 'walleye', name: 'ウォールアイ', minLengthCm: 30, maxLengthCm: 80,
    weight: { referenceLengthCm: 50, referenceWeightKg: 1.2, exponent: 3 },
    fight: { baseResistance: 0.95, lengthScaleCm: 150, surgeAmplitude: 0.12, surgeFrequency: 1.8, style: '低い周期で重く引く' },
    basePricePerKg: 150,
    description: '光を反射する大きな目を持つ北米の淡水魚。薄暗い環境でも餌を探し、主に小魚を捕らえる。',
    image: new URL('../assets/fish/walleye.png', import.meta.url).href,
  }),
  species({
    id: 'catfish', name: 'ナマズ', minLengthCm: 30, maxLengthCm: 80,
    weight: { referenceLengthCm: 50, referenceWeightKg: 1, exponent: 3 },
    fight: { baseResistance: 1.05, lengthScaleCm: 160, surgeAmplitude: 0.1, surgeFrequency: 1.4, style: 'ゆっくりと持続的に引く' },
    basePricePerKg: 90,
    description: 'うろこのない滑らかな体と口の周りのひげが特徴。川や湖の底付近にすみ、夜間を中心に小魚などを探す。',
    image: new URL('../assets/fish/catfish.png', import.meta.url).href,
  }),
  species({
    id: 'alligator-gar', name: 'アリゲーターガー', minLengthCm: 60, maxLengthCm: 180,
    weight: { referenceLengthCm: 100, referenceWeightKg: 7, exponent: 3 },
    fight: { baseResistance: 1.35, lengthScaleCm: 250, surgeAmplitude: 0.25, surgeFrequency: 1.5, style: '重い引きと大きな突進' },
    basePricePerKg: 80,
    description: '幅広く長い口先と硬いうろこを持つ大型の淡水魚。北米の流れの緩やかな川や湖などにすみ、魚を捕食する。',
    image: new URL('../assets/fish/alligator-gar.png', import.meta.url).href,
  }),
  species({
    id: 'arowana', name: 'アロワナ', minLengthCm: 35, maxLengthCm: 90,
    weight: { referenceLengthCm: 60, referenceWeightKg: 1.5, exponent: 3 },
    fight: { baseResistance: 1.1, lengthScaleCm: 170, surgeAmplitude: 0.24, surgeFrequency: 2.8, style: '水面近くで素早く走る' },
    basePricePerKg: 180,
    description: '大きなうろこと上向きの口、下あごのひげが特徴。水面近くを泳ぎ、昆虫や小魚を捕らえる。',
    image: new URL('../assets/fish/arowana.png', import.meta.url).href,
  }),
]);
export const FISH_SPECIES = registry.species;

// Unknown IDs deliberately return undefined; never silently substitute another fish.
export function getFishSpecies(id) { return registry.get(id); }

export function calculateFishWeightKg(id, lengthCm) {
  const fish = getFishSpecies(id);
  if (!fish) throw new RangeError(`Unknown fish species: ${id}`);
  if (!Number.isFinite(lengthCm) || lengthCm < fish.minLengthCm || lengthCm > fish.maxLengthCm) {
    throw new RangeError('Fish length must be within the species range in cm');
  }
  const { referenceLengthCm, referenceWeightKg, exponent } = fish.weight;
  return Math.round(referenceWeightKg * (lengthCm / referenceLengthCm) ** exponent * 100) / 100;
}
