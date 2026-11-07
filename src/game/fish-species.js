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
  species({
    id: 'common-carp', name: 'コイ', minLengthCm: 25, maxLengthCm: 90,
    weight: { referenceLengthCm: 50, referenceWeightKg: 3, exponent: 3 },
    fight: { baseResistance: 0.87, lengthScaleCm: 150, surgeAmplitude: 0.14, surgeFrequency: 1.5, style: 'ゆったりした周期で粘り強く引く' },
    basePricePerKg: 25,
    description: '大きなうろこと口元のひげを持つコイ科の魚。湖や流れの緩い川で、底の小動物や植物質などを食べる。',
    image: new URL('../assets/fish/common-carp.png', import.meta.url).href,
  }),
  species({
    id: 'tench', name: 'テンチ', minLengthCm: 20, maxLengthCm: 55,
    weight: { referenceLengthCm: 35, referenceWeightKg: 0.8, exponent: 3 },
    fight: { baseResistance: 0.68, lengthScaleCm: 130, surgeAmplitude: 0.10, surgeFrequency: 1.8, style: '緩やかな強弱をつけて引き続ける' },
    basePricePerKg: 50,
    description: '細かなうろこと丸みのあるひれを持つコイ科の魚。水草の多い穏やかな水域で、底の小動物などを探す。',
    image: new URL('../assets/fish/tench.png', import.meta.url).href,
  }),
  species({
    id: 'pumpkinseed', name: 'パンプキンシード', minLengthCm: 10, maxLengthCm: 30,
    weight: { referenceLengthCm: 20, referenceWeightKg: 0.18, exponent: 3 },
    fight: { baseResistance: 0.55, lengthScaleCm: 120, surgeAmplitude: 0.12, surgeFrequency: 3.9, style: '速い周期で小さく抵抗する' },
    basePricePerKg: 50,
    description: '丸く平たい体と、えらぶた後端の赤い縁取りが目印。北米原産で、浅い水域の昆虫や貝などを食べる。',
    image: new URL('../assets/fish/pumpkinseed.png', import.meta.url).href,
  }),
  species({
    id: 'black-crappie', name: 'ブラッククラッピー', minLengthCm: 15, maxLengthCm: 45,
    weight: { referenceLengthCm: 30, referenceWeightKg: 0.55, exponent: 3 },
    fight: { baseResistance: 0.72, lengthScaleCm: 130, surgeAmplitude: 0.15, surgeFrequency: 3.4, style: '細かな引きに短い突進を交える' },
    basePricePerKg: 60,
    description: '銀色の平たい体に不規則な黒い斑点が散る北米の淡水魚。湖や池の水草や障害物の周辺で、小魚などを捕らえる。',
    image: new URL('../assets/fish/black-crappie.png', import.meta.url).href,
  }),
  species({
    id: 'rock-bass', name: 'ロックバス', minLengthCm: 12, maxLengthCm: 35,
    weight: { referenceLengthCm: 25, referenceWeightKg: 0.3, exponent: 3 },
    fight: { baseResistance: 0.79, lengthScaleCm: 120, surgeAmplitude: 0.17, surgeFrequency: 3.2, style: '小刻みに力を込めて引く' },
    basePricePerKg: 65,
    description: '赤い目と体側に並ぶ暗い斑点が特徴のサンフィッシュ科の魚。北米の岩や石の多い水域で、甲殻類や小魚を食べる。',
    image: new URL('../assets/fish/rock-bass.png', import.meta.url).href,
  }),
  species({
    id: 'freshwater-drum', name: 'フレッシュウォータードラム', minLengthCm: 25, maxLengthCm: 95,
    weight: { referenceLengthCm: 50, referenceWeightKg: 1.6, exponent: 3 },
    fight: { baseResistance: 0.96, lengthScaleCm: 170, surgeAmplitude: 0.14, surgeFrequency: 2.3, style: '持続する引きに中周期のうねりを重ねる' },
    basePricePerKg: 35,
    description: '盛り上がった背と下向きの口を持つ北米のニベ科の魚。淡水にすみ、底にいる貝や水生昆虫などを食べる。',
    image: new URL('../assets/fish/freshwater-drum.png', import.meta.url).href,
  }),
  species({
    id: 'white-bass', name: 'ホワイトバス', minLengthCm: 18, maxLengthCm: 45,
    weight: { referenceLengthCm: 30, referenceWeightKg: 0.45, exponent: 3 },
    fight: { baseResistance: 0.82, lengthScaleCm: 120, surgeAmplitude: 0.21, surgeFrequency: 3.3, style: '素早く強弱を切り替えて走る' },
    basePricePerKg: 60,
    description: '銀白色の体に細い暗色の横じまが走る北米の淡水魚。湖や川で群れを作り、小魚などを追って捕食する。',
    image: new URL('../assets/fish/white-bass.png', import.meta.url).href,
  }),
  species({
    id: 'brook-trout', name: 'ブルックトラウト', minLengthCm: 20, maxLengthCm: 65,
    weight: { referenceLengthCm: 40, referenceWeightKg: 0.75, exponent: 3 },
    fight: { baseResistance: 0.95, lengthScaleCm: 140, surgeAmplitude: 0.22, surgeFrequency: 3.4, style: '速い周期の強い引きと走りを繰り返す' },
    basePricePerKg: 95,
    description: '背の虫食い状の模様と、腹側のひれの白い前縁が目印のイワナの仲間。北米原産で、冷たい渓流や湖にすむ。',
    image: new URL('../assets/fish/brook-trout.png', import.meta.url).href,
  }),
  species({
    id: 'striped-bass', name: 'ストライプドバス', minLengthCm: 35, maxLengthCm: 130,
    weight: { referenceLengthCm: 70, referenceWeightKg: 3.5, exponent: 3 },
    fight: { baseResistance: 1.17, lengthScaleCm: 180, surgeAmplitude: 0.24, surgeFrequency: 2.4, style: '力強い走りに周期的な突進を交える' },
    basePricePerKg: 45,
    description: '銀色の体に明瞭な暗い横じまを持つ北米原産の魚。沿岸や河川にすみ、淡水の湖にも定着して小魚を追う。',
    image: new URL('../assets/fish/striped-bass.png', import.meta.url).href,
  }),
  species({
    id: 'burbot', name: 'バーボット', minLengthCm: 30, maxLengthCm: 110,
    weight: { referenceLengthCm: 65, referenceWeightKg: 2.5, exponent: 3 },
    fight: { baseResistance: 1.12, lengthScaleCm: 190, surgeAmplitude: 0.11, surgeFrequency: 1.3, style: '低い周期で粘り強く引き続ける' },
    basePricePerKg: 55,
    description: '下あごの1本のひげと、まだら模様の細長い体が特徴の淡水性のタラの仲間。北半球の冷たい水域の底にすみ、夜に小魚などを探す。',
    image: new URL('../assets/fish/burbot.png', import.meta.url).href,
  }),
  species({
    id: 'grayling', name: 'グレイリング', minLengthCm: 20, maxLengthCm: 65,
    weight: { referenceLengthCm: 40, referenceWeightKg: 0.65, exponent: 3 },
    fight: { baseResistance: 0.92, lengthScaleCm: 140, surgeAmplitude: 0.23, surgeFrequency: 3.4, style: '速い周期の引きと軽快な走り' },
    basePricePerKg: 105,
    description: '帆のように大きな背びれを持つサケ科の魚（Thymallus arcticus）。北極圏を含む冷たい川や湖にすみ、主に水生昆虫などを食べる。',
    image: new URL('../assets/fish/grayling.png', import.meta.url).href,
  }),
  species({
    id: 'lake-trout', name: 'レイクトラウト', minLengthCm: 30, maxLengthCm: 125,
    weight: { referenceLengthCm: 70, referenceWeightKg: 3.8, exponent: 3 },
    fight: { baseResistance: 1.15, lengthScaleCm: 190, surgeAmplitude: 0.20, surgeFrequency: 2.0, style: '持続する重い引きに突進を重ねる' },
    basePricePerKg: 45,
    description: '暗い体に淡い斑点が散り、尾びれが深く二つに分かれたイワナの仲間。北米原産で、冷たい湖の深場などにすみ、小魚を捕らえる。',
    image: new URL('../assets/fish/lake-trout.png', import.meta.url).href,
  }),
  species({
    id: 'arctic-char', name: 'アークティックチャー', minLengthCm: 25, maxLengthCm: 90,
    weight: { referenceLengthCm: 50, referenceWeightKg: 1.1, exponent: 3 },
    fight: { baseResistance: 1.05, lengthScaleCm: 160, surgeAmplitude: 0.21, surgeFrequency: 3.0, style: '強弱のある引きと素早い突進' },
    basePricePerKg: 85,
    description: '暗い体に淡い斑点を持ち、繁殖期には腹が鮮やかに色づくイワナの仲間。北極圏を中心とする冷たい湖や川にすみ、海へ下るものもいる。',
    image: new URL('../assets/fish/arctic-char.png', import.meta.url).href,
  }),
  species({
    id: 'bowfin', name: 'ボウフィン', minLengthCm: 30, maxLengthCm: 95,
    weight: { referenceLengthCm: 55, referenceWeightKg: 1.7, exponent: 3 },
    fight: { baseResistance: 1.14, lengthScaleCm: 160, surgeAmplitude: 0.19, surgeFrequency: 2.4, style: '粘る引きに短い走りを交える' },
    basePricePerKg: 70,
    description: '背に沿って伸びる長い背びれと丸い尾びれを持つ北米の淡水魚。水草の多い緩やかな水域で、小魚や甲殻類を捕らえる。',
    image: new URL('../assets/fish/bowfin.png', import.meta.url).href,
  }),
  species({
    id: 'murray-cod', name: 'マーレーコッド', minLengthCm: 40, maxLengthCm: 150,
    weight: { referenceLengthCm: 80, referenceWeightKg: 9, exponent: 3 },
    fight: { baseResistance: 1.26, lengthScaleCm: 210, surgeAmplitude: 0.22, surgeFrequency: 1.7, style: 'ゆっくりした周期で力強く引く' },
    basePricePerKg: 30,
    description: '大きな口と緑褐色のまだら模様を持つオーストラリアの淡水魚。マレー・ダーリング水系にすみ、沈木などの陰から魚や甲殻類を狙う。',
    image: new URL('../assets/fish/murray-cod.png', import.meta.url).href,
  }),
  species({
    id: 'golden-dorado', name: 'ゴールデンドラード', minLengthCm: 30, maxLengthCm: 115,
    weight: { referenceLengthCm: 65, referenceWeightKg: 4, exponent: 3 },
    fight: { baseResistance: 1.20, lengthScaleCm: 150, surgeAmplitude: 0.29, surgeFrequency: 3.5, style: '速い周期の強い突進を繰り返す' },
    basePricePerKg: 40,
    description: '金色に輝く体と強いあごを持つ南米の淡水魚。パラナ川などの流域にすみ、流れの中で素早く泳いで小魚を追う。',
    image: new URL('../assets/fish/golden-dorado.png', import.meta.url).href,
  }),
  species({
    id: 'red-bellied-piranha', name: 'レッドベリーピラニア', minLengthCm: 12, maxLengthCm: 38,
    weight: { referenceLengthCm: 25, referenceWeightKg: 0.55, exponent: 3 },
    fight: { baseResistance: 0.95, lengthScaleCm: 135, surgeAmplitude: 0.19, surgeFrequency: 4, style: '速い周期で小刻みに引く' },
    basePricePerKg: 120,
    description: '赤い腹と、平たく厚みのある体、鋭い歯が特徴の南米の淡水魚。川や湖で魚や水生動物などを食べる。',
    image: new URL('../assets/fish/red-bellied-piranha.png', import.meta.url).href,
  }),
  species({
    id: 'barramundi', name: 'バラマンディ', minLengthCm: 40, maxLengthCm: 160,
    weight: { referenceLengthCm: 80, referenceWeightKg: 6, exponent: 3 },
    fight: { baseResistance: 1.25, lengthScaleCm: 200, surgeAmplitude: 0.27, surgeFrequency: 2.8, style: '強い突進と周期的な引きを重ねる' },
    basePricePerKg: 30,
    description: '銀色の大きなうろこと斜め上を向いた大きな口が特徴。河川や沿岸にすむ捕食魚で、この湖でも小魚を追う。',
    image: new URL('../assets/fish/barramundi.png', import.meta.url).href,
  }),
  species({
    id: 'muskellunge', name: 'マスキー', minLengthCm: 50, maxLengthCm: 150,
    weight: { referenceLengthCm: 90, referenceWeightKg: 5, exponent: 3 },
    fight: { baseResistance: 1.37, lengthScaleCm: 200, surgeAmplitude: 0.28, surgeFrequency: 2.5, style: '重い引きに鋭い突進を交える' },
    basePricePerKg: 100,
    description: '細長い体と平たい口先、尾に近い背びれを持つ北米の大型のパイクの仲間。水草や障害物の陰から魚を狙う。',
    image: new URL('../assets/fish/muskellunge.png', import.meta.url).href,
  }),
  species({
    id: 'peacock-bass', name: 'ピーコックバス', minLengthCm: 25, maxLengthCm: 70,
    weight: { referenceLengthCm: 45, referenceWeightKg: 1.5, exponent: 3 },
    fight: { baseResistance: 1.33, lengthScaleCm: 160, surgeAmplitude: 0.30, surgeFrequency: 3.4, style: '速い周期で力強く走る' },
    basePricePerKg: 190,
    description: '鮮やかな体色と体側の縦帯、尾の付け根の眼状斑が目印の南米のシクリッド。浅い水域で小魚を追って捕らえる。',
    image: new URL('../assets/fish/peacock-bass.png', import.meta.url).href,
  }),
  species({
    id: 'northern-snakehead', name: 'カムルチー', minLengthCm: 35, maxLengthCm: 100,
    weight: { referenceLengthCm: 60, referenceWeightKg: 2, exponent: 3 },
    fight: { baseResistance: 1.32, lengthScaleCm: 175, surgeAmplitude: 0.20, surgeFrequency: 1.8, style: '粘り強い引きと長い走り' },
    basePricePerKg: 135,
    description: 'ヘビに似た頭と長い背びれ、体側のまだら模様が特徴のライギョの仲間。水草の多い穏やかな水域で魚などを捕食する。',
    image: new URL('../assets/fish/northern-snakehead.png', import.meta.url).href,
  }),
  species({
    id: 'lake-sturgeon', name: 'レイクスタージョン', minLengthCm: 70, maxLengthCm: 220,
    weight: { referenceLengthCm: 130, referenceWeightKg: 14, exponent: 3 },
    fight: { baseResistance: 1.48, lengthScaleCm: 280, surgeAmplitude: 0.18, surgeFrequency: 1.25, style: '低い周期で重く引き続ける' },
    basePricePerKg: 35,
    description: '体に並ぶ硬い骨板と、口先の下のひげが特徴の北米のチョウザメ。湖や川の底で小動物を探す。',
    image: new URL('../assets/fish/lake-sturgeon.png', import.meta.url).href,
  }),
  species({
    id: 'arapaima', name: 'ピラルク', minLengthCm: 100, maxLengthCm: 240,
    weight: { referenceLengthCm: 180, referenceWeightKg: 44, exponent: 3 },
    fight: { baseResistance: 1.50, lengthScaleCm: 300, surgeAmplitude: 0.24, surgeFrequency: 1.4, style: 'ゆっくりとした強い引きと大きな突進' },
    basePricePerKg: 40,
    description: '大きなうろこに覆われた長い体と、尾に近い背びれ・尻びれを持つ南米の大型淡水魚。水面で空気を吸い、魚などを食べる。',
    image: new URL('../assets/fish/arapaima.png', import.meta.url).href,
  }),
  species({
    id: 'payara', name: 'パヤーラ', minLengthCm: 35, maxLengthCm: 110,
    weight: { referenceLengthCm: 70, referenceWeightKg: 4, exponent: 3 },
    fight: { baseResistance: 1.38, lengthScaleCm: 165, surgeAmplitude: 0.32, surgeFrequency: 3.6, style: '速い周期の鋭い突進を繰り返す' },
    basePricePerKg: 150,
    description: '銀色の細長い体と、下あごから伸びる2本の長い牙が特徴の南米の淡水魚。流れのある水域で小魚を捕らえる。',
    image: new URL('../assets/fish/payara.png', import.meta.url).href,
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
