import { QTE_LABELS, qteArrowMarkup, qteTargetMarkup, qteTapProgress } from './qte-glyphs.js';

const playSteps = [
  ['航行中', '画面をドラッグして操船し、離すと減速します。「停船中」からもドラッグで操船を始められます。'],
  ['停船中', '「釣りをする」を押すと釣り視点へ移ります。'],
  ['キャスト前', 'ルアーを選び、「キャスト準備」を押します。'],
  ['キャスト準備', 'ドラッグで方向と飛距離を調整し、「着水予測」を目安に離して投げます。'],
  ['静寂を聴く', '長押しで巻き、短いフリックで誘い、離して待ちます。'],
  ['シグナルを検知した', '長押し中ならいったん離し、改めて短くタップしてアワセます。離すだけではアワセになりません。'],
  ['抵抗を検知', '長押しで巻き、離してテンションを緩めます。QTEが出たら画面の指示に従います。'],
  ['個体を回収した', '釣果画面で「保管して続ける」か「売却して続ける」を選びます。'],
];
const qteExamples = [
  ['flick', '矢印の方向へ、短く素早く動かします。'],
  ['swipe', '矢印の方向へ、大きく動かします。'],
  ['tap', 'すばやく3回タップします。'],
  ['target', '表示された円の中をタップします。'],
];
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// Display only: no game, delivery, input, audio or persistence dependencies.
// Placement belongs to help CSS; the live HUD's geometry is never instantiated.
export function renderHelp(content, menuEntries) {
  const page = element('div', undefined, 'help-page');
  const jumps = element('nav', undefined, 'help-jumps');
  jumps.setAttribute('aria-label', 'ヘルプの節へ移動');
  const sections = new Map();
  for (const [id, label] of [['play', 'プレイ'], ['qte', 'QTE'], ['menu', 'メニュー'], ['save', 'セーブ']]) {
    const section = element('section', undefined, 'help-section');
    const heading = element('h3', label); heading.id = `help-${id}`; heading.tabIndex = -1;
    section.setAttribute('aria-labelledby', heading.id); section.append(heading);
    const jump = element('button', label); jump.type = 'button'; jump.dataset.helpSection = id;
    jump.addEventListener('click', () => {
      heading.scrollIntoView({ block: 'start' }); heading.focus({ preventScroll: true });
    });
    jumps.append(jump); sections.set(id, section);
  }
  const play = sections.get('play');
  const steps = element('dl', undefined, 'help-play-steps');
  for (const [label, action] of playSteps) {
    const row = element('div'); row.append(element('dt', label), element('dd', action)); steps.append(row);
  }
  play.append(steps,
    element('p', '「離して緩める！」は押している指やマウスを離す合図、「長押しで巻く！」は押し続けて巻く合図です。キャスト中・回収中は、そのまま待ちます。', 'help-extra'),
    element('p', 'PCのタップは短い左クリック、長押しは左ボタンを押し続ける操作です。フリック・スワイプは押して動かし、離します。スマートフォンは指1本で同じ操作をします。', 'help-extra'),
    element('p', 'PCの操船にはWASD・方向キーも使えます（W／↑で前進、A・D／←・→で操舵）。', 'help-extra'));

  const qte = sections.get('qte');
  qte.append(element('p', '「入力受付中」と表示されたら、残り時間内に画面の指示に従います。図は説明用の静止した見本です。実際の矢印の方向を優先してください。'));
  const examples = element('ul', undefined, 'help-qte-list');
  for (const [operation, explanation] of qteExamples) {
    const row = element('li', undefined, 'help-qte-row'); row.dataset.operation = operation;
    const figure = element('div', undefined, 'help-qte-figure'); figure.setAttribute('aria-hidden', 'true');
    if (operation === 'flick' || operation === 'swipe') {
      figure.innerHTML = qteArrowMarkup({ className: 'help-qte-arrow-shape', secondaryClassName: 'help-qte-arrow-secondary' });
    } else if (operation === 'target') figure.innerHTML = qteTargetMarkup('help-qte-target');
    else figure.append(element('span', qteTapProgress(0), 'help-qte-taps'));
    const text = element('div', undefined, 'help-qte-description');
    text.append(element('h4', QTE_LABELS[operation]), element('p', explanation)); row.append(figure, text); examples.append(row);
  }
  qte.append(examples, element('p', '成功すると釣獲を助け、売却価格にボーナスが付きます。'));

  const menu = sections.get('menu');
  menu.append(element('p', 'メニュー中はゲームが一時停止します。'));
  const roles = element('dl', undefined, 'help-menu-roles');
  for (const [view, label, description] of menuEntries) {
    if (view === 'help') continue;
    const row = element('div'); row.append(element('dt', label), element('dd', description)); roles.append(row);
  }
  menu.append(roles);
  sections.get('save').append(element('p', '進行はこのブラウザに自動保存を試みます。メニューなどに表示される実際の保存状態を確認してください。'),
    element('p', 'ブラウザのサイトデータを削除した場合などは、記録が失われることがあります。'));
  page.append(element('p', '画面の表示から、次の操作を確認できます。', 'help-intro'), jumps, ...sections.values()); content.append(page);
}
