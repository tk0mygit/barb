import test from 'node:test';
import assert from 'node:assert/strict';
import { BUYER_LINES, NORMAL_BUYER_DIALOGUE, createBuyerLinePicker } from '../src/game/buyer-lines.js';

// Public copy approved by the PM on 2026-11-05; keep punctuation verbatim.
const approved = [
  ['N01', 'お疲れさん。少し休むといい。'],
  ['N02', '無理はしない方がいい。'],
  ['N03', 'たまには何もしない時間も必要だな。'],
  ['N04', '焦ることはない。ゆっくりするといい。'],
  ['N05', 'また来るといい。いつでもいるからな。'],
  ['N06', 'さて、次はどうするんだ？'],
  ['N07', '急がなくても、時間はあるだろう。'],
  ['N08', 'そうか。今日も一日、いろいろあるな。'],
  ['N09', '静かな場所は落ち着くものだな。'],
  ['N10', '気が向いたら、また顔を出すといい。'],
  ['N11', 'まあ、そういう日もあるだろう。'],
  ['N12', '自分のペースでやるのが一番だな。'],
  ['N13', '何かあれば、また声をかけるといい。'],
  ['N14', '少し肩の力を抜くといい。'],
  ['N15', '遠回りも、悪いことばかりじゃないな。'],
  ['N16', '帰り道は気をつけるんだぞ。'],
  ['N17', 'そうだな。慌てて決めることもない。'],
  ['N18', 'ここにいると、考え事が増えるものだな。'],
  ['N19', '何も変わらない日も、案外いいものだ。'],
  ['N20', '時には立ち止まってみるといい。'],
  ['N21', 'まあ、元気でやることだな。'],
  ['N22', '大事なのは、続けられることだろう。'],
  ['N23', '気分を変えるのも悪くないな。'],
  ['N24', '一息ついてから行くといい。'],
  ['N25', 'ここは急ぐような場所じゃないからな。'],
  ['N26', 'ありがとう。またよろしく頼むよ。'],
  ['N27', '何でも話してみるといい。聞くくらいはできる。'],
  ['N28', 'たまには違う景色を見るのもいいものだな。'],
  ['N29', '気になることは、自分の目で確かめるといい。'],
  ['N30', '何事も、ほどほどが一番だな。'],
  ['N31', '黙っていても構わんよ。落ち着くまでな。'],
  ['N32', '後回しにしていいこともあるだろう。'],
  ['N33', '遠慮はいらん。気楽に来るといい。'],
  ['N34', '話すことがなくても、顔を出してくれればいい。'],
  ['N35', 'まあ、好きに過ごすといい。ここではな。'],
  ['X01', '昨日は確か、明日だったな。'],
  ['X02', 'あれはまだ、こちら側には来ていないはずだ。'],
  ['X03', '数が合わないな。まあ、今はいいだろう。'],
  ['X04', '三度目だったか。いや、最初だったな。'],
  ['X05', '前の担当の席は、まだ空けてある。誰も座っていないんだがな。'],
  ['X06', '右に置いたら、左が先になくなった。'],
  ['X07', '先に名前を呼ぶと、順番が逆になるんだったな。'],
  ['X08', 'あの記録は、最初からなかったことになっているんだ。'],
  ['X09', '二つあるときは、三つ目を数えない方がいい。'],
  ['X10', '帰ってきたはずなんだが、まだ帰す方に名前があるな。'],
  ['X11', '返事はあったが、誰も尋ねていなかった。'],
  ['X12', '受け取った覚えはある。渡した人間は、もういないんだがな。'],
  ['X13', 'やり直すなら、終わる前に戻すといい。'],
  ['X14', '数は合っている。消えた分を入れなければな。'],
  ['X15', '見えている間は、まだ見つかっていない。'],
];

function sequence(rolls) {
  let calls = 0;
  return { random() { assert.ok(calls < rolls.length, 'Unexpected RNG consumption'); return rolls[calls++]; },
    get calls() { return calls; } };
}

test('normal dialogue contains exactly the approved 35 N and 15 X IDs and public text', () => {
  assert.deepEqual(NORMAL_BUYER_DIALOGUE.map(category => [category.weight, category.lines.length]), [[85, 35], [15, 15]]);
  const lines = NORMAL_BUYER_DIALOGUE.flatMap(category => category.lines);
  assert.deepEqual(lines.map(line => [line.id, line.text]), approved);
  assert.equal(new Set(lines.map(line => line.id)).size, 50);
  assert.deepEqual(BUYER_LINES, approved.map(([, text]) => text));
  assert.equal(new Set(BUYER_LINES).size, 50);
  assert.ok(Object.isFrozen(NORMAL_BUYER_DIALOGUE) && Object.isFrozen(BUYER_LINES));
  for (const category of NORMAL_BUYER_DIALOGUE) {
    assert.ok(Object.isFrozen(category) && Object.isFrozen(category.lines));
    for (const line of category.lines) assert.ok(Object.isFrozen(line));
  }
});

test('category boundaries use a separate draw from first, middle and final candidate selection', () => {
  for (const [categoryRoll, categoryIndex] of [[0, 0], [0.8499999999999999, 0], [0.85, 1], [1 - Number.EPSILON, 1]]) {
    const lines = NORMAL_BUYER_DIALOGUE[categoryIndex].lines;
    for (const candidateRoll of [0, 0.5, 1 - Number.EPSILON]) {
      const source = sequence([categoryRoll, candidateRoll]);
      assert.equal(createBuyerLinePicker(source)(), lines[Math.floor(candidateRoll * lines.length)].text);
      assert.equal(source.calls, 2);
    }
  }
});

test('every category candidate has an equal interval including both ends of each interval', () => {
  for (const [categoryIndex, { lines }] of NORMAL_BUYER_DIALOGUE.entries()) {
    for (const [index, line] of lines.entries()) {
      for (const fraction of [0, 0.5, 1 - 1e-10]) {
        const source = sequence([categoryIndex ? 0.85 : 0, (index + fraction) / lines.length]);
        assert.equal(createBuyerLinePicker(source)(), line.text);
        assert.equal(source.calls, 2);
      }
    }
  }
});

test('each possible previous ID is excluded with equal intervals for all remaining candidates', () => {
  for (const [categoryIndex, { lines }] of NORMAL_BUYER_DIALOGUE.entries()) {
    const categoryRoll = categoryIndex ? 0.85 : 0;
    for (const [previousIndex, previous] of lines.entries()) {
      const candidates = lines.filter(line => line.id !== previous.id);
      for (const [index, line] of candidates.entries()) {
        for (const fraction of [0, 0.5, 1 - 1e-10]) {
          const source = sequence([categoryRoll, (previousIndex + 0.5) / lines.length,
            categoryRoll, (index + fraction) / candidates.length]);
          const pick = createBuyerLinePicker(source);
          assert.equal(pick(), previous.text); assert.equal(pick(), line.text);
          assert.equal(source.calls, 4);
        }
      }
    }
  }
});

test('repeated candidate draws preserve 85:15 categories and never require another draw', () => {
  for (const candidateRoll of [0, 0.5, 1 - Number.EPSILON]) {
    const source = sequence(Array.from({ length: 1000 }, (_, index) => [index / 1000, candidateRoll]).flat());
    const pick = createBuyerLinePicker(source);
    let dailyCount = 0, previous;
    for (let index = 0; index < 1000; index++) {
      const line = pick(); assert.notEqual(line, previous); previous = line;
      if (NORMAL_BUYER_DIALOGUE[0].lines.some(candidate => candidate.text === line)) dailyCount++;
    }
    assert.equal(dailyCount, 850); assert.equal(source.calls, 2000);
  }
});

test('switching categories excludes only the immediately previous ID and pickers stay independent', () => {
  const source = sequence([0, 0, 0.85, 0, 0, 0, 0, 0]);
  const first = createBuyerLinePicker(source), second = createBuyerLinePicker({ random: () => 0 });
  assert.equal(first(), BUYER_LINES[0]); assert.equal(second(), BUYER_LINES[0]);
  assert.equal(first(), BUYER_LINES[35]); assert.equal(first(), BUYER_LINES[0]);
  assert.equal(first(), BUYER_LINES[1]); assert.equal(second(), BUYER_LINES[1]);
});

test('invalid category or candidate random input is rejected without updating previous ID', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -0.01, 1, 2, '0.5', null, undefined]) {
    for (const invalidDraw of [[invalid], [0, invalid]]) {
      const source = sequence([0, 0, ...invalidDraw, 0, 0]);
      const pick = createBuyerLinePicker(source);
      assert.equal(pick(), BUYER_LINES[0]); assert.throws(pick, RangeError);
      assert.equal(pick(), BUYER_LINES[1]);
    }
  }
});

test('default crypto draws cover uint32 boundaries without consuming Math.random', t => {
  const values = [0, 0, 3650722201, 0xffffffff, 3650722202, 0, 0xffffffff, 0xffffffff];
  t.mock.method(Math, 'random', () => { throw new Error('Fishing RNG consumed'); });
  const crypto = t.mock.method(globalThis.crypto, 'getRandomValues', array => {
    assert.ok(array instanceof Uint32Array); assert.equal(array.length, 1);
    assert.ok(values.length); array[0] = values.shift(); return array;
  });
  const pick = createBuyerLinePicker();
  assert.deepEqual([pick(), pick(), pick(), pick()], [BUYER_LINES[0], BUYER_LINES[34], BUYER_LINES[35], BUYER_LINES[49]]);
  assert.equal(crypto.mock.callCount(), 8); assert.equal(values.length, 0);
});

test('picker accepts another weighted dialogue as data without sale receipt classification', () => {
  const dialogue = [{ weight: 1, lines: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] },
    { weight: 3, lines: [{ id: 'c', text: 'three' }, { id: 'd', text: 'four' }] }];
  const source = sequence([0, 0, 0.249999, 0, 0.25, 0, 0.999999, 0]);
  const pick = createBuyerLinePicker({ ...source, dialogue });
  assert.deepEqual([pick(), pick(), pick(), pick()], ['one', 'two', 'three', 'four']);
});
