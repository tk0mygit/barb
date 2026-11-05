const daily = Object.freeze([
  { id: 'N01', text: 'お疲れさん。少し休むといい。' },
  { id: 'N02', text: '無理はしない方がいい。' },
  { id: 'N03', text: 'たまには何もしない時間も必要だな。' },
  { id: 'N04', text: '焦ることはない。ゆっくりするといい。' },
  { id: 'N05', text: 'また来るといい。いつでもいるからな。' },
  { id: 'N06', text: 'さて、次はどうするんだ？' },
  { id: 'N07', text: '急がなくても、時間はあるだろう。' },
  { id: 'N08', text: 'そうか。今日も一日、いろいろあるな。' },
  { id: 'N09', text: '静かな場所は落ち着くものだな。' },
  { id: 'N10', text: '気が向いたら、また顔を出すといい。' },
  { id: 'N11', text: 'まあ、そういう日もあるだろう。' },
  { id: 'N12', text: '自分のペースでやるのが一番だな。' },
  { id: 'N13', text: '何かあれば、また声をかけるといい。' },
  { id: 'N14', text: '少し肩の力を抜くといい。' },
  { id: 'N15', text: '遠回りも、悪いことばかりじゃないな。' },
  { id: 'N16', text: '帰り道は気をつけるんだぞ。' },
  { id: 'N17', text: 'そうだな。慌てて決めることもない。' },
  { id: 'N18', text: 'ここにいると、考え事が増えるものだな。' },
  { id: 'N19', text: '何も変わらない日も、案外いいものだ。' },
  { id: 'N20', text: '時には立ち止まってみるといい。' },
  { id: 'N21', text: 'まあ、元気でやることだな。' },
  { id: 'N22', text: '大事なのは、続けられることだろう。' },
  { id: 'N23', text: '気分を変えるのも悪くないな。' },
  { id: 'N24', text: '一息ついてから行くといい。' },
  { id: 'N25', text: 'ここは急ぐような場所じゃないからな。' },
  { id: 'N26', text: 'ありがとう。またよろしく頼むよ。' },
  { id: 'N27', text: '何でも話してみるといい。聞くくらいはできる。' },
  { id: 'N28', text: 'たまには違う景色を見るのもいいものだな。' },
  { id: 'N29', text: '気になることは、自分の目で確かめるといい。' },
  { id: 'N30', text: '何事も、ほどほどが一番だな。' },
  { id: 'N31', text: '黙っていても構わんよ。落ち着くまでな。' },
  { id: 'N32', text: '後回しにしていいこともあるだろう。' },
  { id: 'N33', text: '遠慮はいらん。気楽に来るといい。' },
  { id: 'N34', text: '話すことがなくても、顔を出してくれればいい。' },
  { id: 'N35', text: 'まあ、好きに過ごすといい。ここではな。' },
].map(Object.freeze));

const unusual = Object.freeze([
  { id: 'X01', text: '昨日は確か、明日だったな。' },
  { id: 'X02', text: 'あれはまだ、こちら側には来ていないはずだ。' },
  { id: 'X03', text: '数が合わないな。まあ、今はいいだろう。' },
  { id: 'X04', text: '三度目だったか。いや、最初だったな。' },
  { id: 'X05', text: '前の担当の席は、まだ空けてある。誰も座っていないんだがな。' },
  { id: 'X06', text: '右に置いたら、左が先になくなった。' },
  { id: 'X07', text: '先に名前を呼ぶと、順番が逆になるんだったな。' },
  { id: 'X08', text: 'あの記録は、最初からなかったことになっているんだ。' },
  { id: 'X09', text: '二つあるときは、三つ目を数えない方がいい。' },
  { id: 'X10', text: '帰ってきたはずなんだが、まだ帰す方に名前があるな。' },
  { id: 'X11', text: '返事はあったが、誰も尋ねていなかった。' },
  { id: 'X12', text: '受け取った覚えはある。渡した人間は、もういないんだがな。' },
  { id: 'X13', text: 'やり直すなら、終わる前に戻すといい。' },
  { id: 'X14', text: '数は合っている。消えた分を入れなければな。' },
  { id: 'X15', text: '見えている間は、まだ見つかっていない。' },
].map(Object.freeze));

export const NORMAL_BUYER_DIALOGUE = Object.freeze([
  Object.freeze({ weight: 85, lines: daily }),
  Object.freeze({ weight: 15, lines: unusual }),
]);

// Read-only text catalogue for consumers that only check displayed membership.
export const BUYER_LINES = Object.freeze(NORMAL_BUYER_DIALOGUE.flatMap(category => category.lines.map(line => line.text)));

function readRandom(random) {
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('Random value must be in [0, 1)');
  return roll;
}

// Never consume Math.random/the fishing stream, even when the caller does not
// inject a presentation RNG. getRandomValues works on Pages and localhost.
export function createBuyerLinePicker({
  random = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  dialogue = NORMAL_BUYER_DIALOGUE,
} = {}) {
  const totalWeight = dialogue.reduce((total, category) => total + category.weight, 0);
  let previousId = null;
  return function pickBuyerLine() {
    const categoryRoll = readRandom(random) * totalWeight;
    let cumulativeWeight = 0;
    const category = dialogue.find(candidate => {
      cumulativeWeight += candidate.weight;
      return categoryRoll < cumulativeWeight;
    }) ?? dialogue.at(-1);
    // Exclude only within the chosen category, preserving its probability.
    const candidates = category.lines.filter(line => line.id !== previousId);
    if (!candidates.length) throw new RangeError('Buyer category needs another line');
    const line = candidates[Math.min(Math.floor(readRandom(random) * candidates.length), candidates.length - 1)];
    previousId = line.id;
    return line.text;
  };
}
