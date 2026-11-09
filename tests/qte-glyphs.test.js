import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { QTE_LABELS, qteArrowMarkup, qteTargetMarkup, qteTapProgress } from '../src/ui/qte-glyphs.js';

test('shared arrows retain the exact production shape and two-SVG visibility contract', () => {
  const arrow = '<svg class="qte-arrow-shape" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="M12 36H53V18L86 50 53 82V64H12Z"/></svg>';
  assert.equal(qteArrowMarkup(), arrow + arrow.replace('qte-arrow-shape', 'qte-arrow-shape qte-arrow-secondary'));
  assert.equal(qteTargetMarkup(), '<span class="qte-target"></span>');
});

test('help can use the same shapes without acquiring global HUD layout selectors', () => {
  const arrows = qteArrowMarkup({ className: 'help-arrow', secondaryClassName: 'help-arrow-secondary' });
  assert.equal((arrows.match(/<svg /g) ?? []).length, 2);
  assert.match(arrows, /class="help-arrow help-arrow-secondary"/);
  assert.doesNotMatch(arrows, /qte-arrow/);
  assert.equal(qteTargetMarkup('help-target'), '<span class="help-target"></span>');
});

test('shared labels quote the displayed target instruction and tap progress remains static', () => {
  assert.deepEqual(QTE_LABELS, { flick: '短く素早くフリック', swipe: '長くスワイプ', tap: '3回タップ', target: 'ターゲットを選択' });
  assert.equal(Object.isFrozen(QTE_LABELS), true);
  assert.deepEqual([0, 1, 2, 3].map(qteTapProgress), ['0/3 ○○○', '1/3 ●○○', '2/3 ●●○', '3/3 ●●●']);
  assert.equal(qteTapProgress(), '0/3 ○○○');
});

test('import and rendering need no DOM, clock, RNG, input, timers or WebGL', () => {
  const source = readFileSync(new URL('../src/ui/qte-glyphs.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b/);
  const forbidden = () => { throw new Error('passive glyph invoked a runtime dependency'); };
  const context = {};
  for (const name of ['window', 'document', 'performance', 'Date', 'WebGLRenderingContext', 'WebGL2RenderingContext',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'addEventListener']) {
    Object.defineProperty(context, name, { get: forbidden });
  }
  context.Math = Object.create(Math);
  context.Math.random = forbidden;
  // Execute the exact module in a separate realm, removing only its export
  // declaration prefixes so this test needs no experimental VM module flag.
  const result = runInNewContext(source.replace(/^export /gm, '')
    + '\n[qteArrowMarkup(), qteTargetMarkup(), qteTapProgress(), QTE_LABELS.target]', context);
  assert.equal(result[0], qteArrowMarkup());
  assert.equal(result[1], qteTargetMarkup());
  assert.equal(result[2], '0/3 ○○○');
  assert.equal(result[3], 'ターゲットを選択');
});
