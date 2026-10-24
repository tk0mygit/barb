# BARBの検証・失敗調査

Codexは原因調査、実装、単体テスト、ビルド、必要な関連E2EとPR作成を担当する。
GitHub ActionsはPR作成・更新時に `npm ci`、`npm test`、`npm run build`、
`npm run test:e2e` を実行する。全件E2Eの実行場所と最終確認担当をCI・PMへ移すもので、
全件検証を廃止するものではない。

CodexはPRに局所検証結果、未実行項目、未解決の原因を記載し、URLの報告後は終了する。
CI完了を待機・継続監視しない。PMが最新HEADのCIと差分を確認し、失敗時は同じPRの
Codexスレッドで追加修正を指示する。最新HEADの全件CI成功とPMレビューを満たしてから、
ユーザーだけがマージ・デプロイする。再実行でのみ通ったケースは解決扱いにせず、
最初の失敗の診断を残し、原因が確認できた範囲と仮説を分ける。

## 局所検証

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npx playwright test tests/browser/equipment-game.spec.js --grep 'touch:' --reporter=line
npx playwright test tests/browser/fishing.spec.js --grep 'mouse: blur/lost capture' --reporter=line
npx playwright test tests/browser/day-night.spec.js --grep 'night sailing' --reporter=line
```

必要なケースを選ぶ。複数の調査結果を残す場合は
`--output=test-results/local-equipment` など実行ごとに別の出力先を指定する。
Playwrightは実行開始時に指定出力ディレクトリを消去する。
極端に遅いケースを長時間反復せず、取得した診断と未解決事項を報告する。
タイムアウト延長、assertion緩和、固定sleep追加、無条件リトライで対処しない。

## CI失敗時の調査

1. 失敗したHEAD SHA・run ID・attempt・テスト名・最初に失敗した操作を記録する。
2. Actionsの `browser-test-results` をダウンロードする。失敗時も `if: always()` で
   `test-results/` を保存する。保存期間は14日。
3. `error-context.md`、失敗時PNG、`trace.zip`、`*-diagnostics.json` を同じテストで照合する。
4. Traceはローカルで `npx playwright show-trace <展開先>/trace.zip` を開く。
   操作名、locator、DOM snapshot、console、操作前後を確認する。
5. JSONの `failures` と `actions` を確認する。ボタンのvisible・enabled・中心hit target、
   現在のmode・phase・focus、console.error・pageerrorと入力履歴を比較する。
   pointerdown/upが届いてclickがない場合と、click後にゲームが拒否した場合を区別する。
   `sequence` と仮想時刻も比較し、ドラッグのcapture解除やblur/focusの順序を調べる。
6. 原因に対応する修正を行い、関連E2Eだけを局所実行して同じPRを更新する。
   CIの最終判定はPMが行う。再現しない問題を修正済みと断定しない。

Traceは失敗時のみ保持する。DOM snapshot・sourceを記録し、連続スクリーンショットと
動画は記録しない。静止画は失敗時だけ自動保存する。画像品質を確認する既存テストの
明示的な比較画像・レビュー用画像は引き続き保存する。

## 共通fixtureと手動Context

すべてのspecは `diagnostics-fixture.js` の `test` / `expect` を使う。
通常の `page` / `context` には自動で診断listenerを登録する。追加Contextは
`browser.newContext()` を直接使わず、同fixtureの `createContext` を使用する。

```js
test('touch interaction', async ({ createContext }) => {
  const context = await createContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await context.newPage();
  // 操作とassertion。context.close()はfixtureに任せる。
});
```

追加Contextは共通contextOptionsを引き継ぎ、viewport等の明示値を優先する。
Playwright自身のTrace・失敗時スクリーンショット機能は手動作成Contextにも適用される。
fixtureは失敗時のJSON取得を試みた後、`finally` で全Contextを閉じる。
ページ取得不能時もJSONへ取得エラーを残し、診断listenerを解放する。
スナップショット取得は5秒で打ち切り、consoleはerrorのみ、入力は直近100件、
操作記録は直近30件に制限する。通常操作はlocatorのclick/tapとactionability検査を使う。
disabled時の不正イベント拒否を確認する明示的なnegative testは通常操作と区別する。

各テストは新しいContextを使うためlocalStorage・sessionStorageは前テストと共有しない。
reload時に保存状態を検証するテストがあるため、navigationごとの一律clearはしない。
乱数固定・セーブ初期値は各テストのinit scriptに限り、ゲーム本体の乱数仕様は変えない。
ClockとlistenerはContext破棄で終了する。

## Clock・描画・入力

仮想時計が必要なケースは `clock-fixture.js` の `installPausedClock()` を起動前に使う。
rendererがrAFを保持した後のClock導入を避ける。`setFixedTime` は `pauseAt` への
通信中に壁時計が進む競合を防ぎ、停止後の `setSystemTime` はDateを再び仮想時計の
進行に追随させる。Dateとperformanceの絶対値は異なるが、進行量を揃える。
`fastForward(250)` はゲーム既存のdt上限に対応した1更新として使い、長時間の
fastForwardを多数のシミュレーション更新と同一視しない。

状態遷移はlocator assertionやexpect.pollで待つ。停止中のシミュレーションを
pollで進める場合は、poll間隔によって必要な更新数を実行できなくならないようにする。
実時間の入力を検証する操船・視点テストは実時間を維持し、ドラッグの視点移動が
描画へ反映されたことを確認してからpointerupする。pointerupは未消費のlook入力を解除する。
blur/非表示中はゲーム時計が止まり、focus復帰で非操作時間を取り戻さないことも確認する。

SwiftShaderの負荷対策はテスト目的に限定する。装備取引テストの低いbackbuffer比率は
CSS viewport・操作座標・シミュレーションを変えない。昼夜・霧の画像品質テストには
その設定を適用しない。描画観測・診断のための本番デバッグAPIは追加しない。
