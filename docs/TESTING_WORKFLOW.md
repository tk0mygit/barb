# BARBの検証・失敗調査

Codexは原因調査、実装、単体テスト、ビルド、必要な関連E2EとPR作成を担当する。
GitHub ActionsはPR作成・更新時に `npm ci`、`npm test`、`npm run build`、
Chromiumセットアップ、`npm run test:e2e` を実行する。全件E2Eの実行場所と最終確認担当をCI・PMへ移すもので、
全件検証を廃止するものではない。

CodexはPRに局所検証結果、未実行項目、未解決の原因を記載し、URLの報告後は終了する。
CI完了を待機・継続監視しない。PMが最新HEADのCIと差分を確認し、失敗時は同じPRの
Codexスレッドで追加修正を指示する。最新HEADの `ci-required`（全件E2Eを含む）の成功と
PMレビューを満たしてから、ユーザーだけがマージする。そのmainへのpushを受けて
GitHub Actionsが自動デプロイする。再実行でのみ通ったケースは解決扱いにせず、
最初の失敗の診断を残し、原因が確認できた範囲と仮説を分ける。

## P3-Aのイベント別CI

P3-Aではマージ後の重複だけを削減する。文書のみのPRも全件E2Eの対象で、
L0／L1／L2の選択実行とscheduleはまだ導入しない。

| イベント | 共通検証 | Chromium・全件E2E | Pages |
| --- | --- | --- | --- |
| main宛ての `pull_request` | `npm ci` → 単体テスト → ビルド | 全件実行 | デプロイしない |
| mainへの `push` | `npm ci` → 単体テスト → ビルド | 未実行（設計による省略） | 成功後にアップロード・デプロイ |
| `workflow_dispatch`（main指定を含む） | `npm ci` → 単体テスト → ビルド | 全件実行 | デプロイしない |

PR・手動実行の診断成果物は引き続き `browser-test-results` として14日間保持する。
main pushではChromiumセットアップも全件E2Eも行わず、そのrunがマージ後のmainから
ビルドした `dist` を公開する。PRのビルド成果物や過去のテスト成功は流用しない。

検証ジョブ `build` の表示名は `ci-required` に固定する。PRではジョブ全体の条件や
pathsフィルターを設けず、単体テスト・ビルド・全件E2Eを同じジョブで順に実行する。
失敗の無視や集約用の成功ジョブは設けない。診断アップロードが成功しても先行する失敗は
残り、中断は中断として扱う。更新されたHEADは別runで検証するため、古いHEADの成功を
新しいHEADの成功として扱わない。必須チェックとしての登録などブランチ保護の変更は、
Codexが無断で行わない。

Pagesアップロードと `deploy` ジョブの条件はともに
`github.event_name == 'push' && github.ref == 'refs/heads/main'` とする。
アップロードは通常の成功条件を維持し、`deploy` は `needs: build` に依存するため、
単体テスト・ビルド・アップロードの失敗時や中断時には公開しない。手動実行はmainでも
デプロイ対象外となり、将来scheduleを追加してもこの条件では公開されない。

concurrencyはワークフロー名・イベント名・refごとに分離する。同じPRの更新では古いrunを
キャンセルするが、mainへのpushと同じrefの手動検証は互いにキャンセルしない。
将来のscheduleも別イベントのグループになる。

`Record validation scope` はログとJob Summaryにイベント、HEADブランチ・SHA、
対象ブランチ、検証ref・SHAを記録する。PRの検証ref・SHAはcheckoutするマージ用ref・SHAで、
PRのHEAD SHAと区別する。表示は実行予定であり、実際の成否は各stepとジョブで確認する。
main pushのE2Eは成功と表現せず「未実行（設計による省略）」と明記する。

PMはPRの最新HEADで全件CIと差分を確認する。ユーザーによるマージ後は、mainのrunで
Chromium・E2Eが実際にスキップされ、単体テスト・ビルド・Pagesアップロード・デプロイが
成功したことを確認する。P3-Aのマージ・デプロイ確認後にP3-Bへ進み、選択E2Eと
定期全件E2Eの追加に合わせて運用文書を再更新する。

### CIでの確認と時間計測

PRでは文書のみの変更でも全件E2Eが起動し、単体テスト・ビルド・E2Eの失敗や中断を
`ci-required` が成功扱いしないことを確認する。手動実行はmain指定でも単体テスト・ビルド・
全件E2Eを行い、Pagesアップロードとdeployがスキップされることを確認する。

変更前後それぞれの成功したPR runと対応するmain push runについて、run ID・attempt・
HEAD SHA・イベントを記録し、Actionsのjob／stepの開始・終了時刻から共通検証、Chromium、
E2E、アップロード、deployの所要時間を比較する。失敗・再実行・キャンセル・待ち時間は
別記し、比較条件を揃える。全件E2Eは従来どおりPRで維持されていることも確認する。
公開までの時間はPR承認（承認機能を使わない場合はPM承認記録）・マージ・deploy完了の
各時刻を記録し、人によるマージ待ちとmain push後の処理時間を区別して比較する。
Codexはこの計測のためにCI完了待機や継続ポーリングを行わない。

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
