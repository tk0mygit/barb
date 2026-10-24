# BARBの検証・失敗調査

Codexは原因調査、実装、単体テスト、ビルド、必要な局所E2EとPR作成を担当する。
PRのGitHub Actionsは全PRで `npm ci`、`npm test`、`npm run build` を実行したうえで、
変更リスクに応じてE2Eを選択する。判定が不明なら全件検証へ倒す。
CodexはPRへ検証結果・未実行項目・未解決事項を記録し、URLの報告後は終了する。
CI完了待機・継続ポーリング・ローカル全件E2Eは行わない。

PMが最新HEADの `ci-required`、分類の妥当性、実際のE2E実行結果、差分を確認し、
現在のmainとの統合可能性を判断する。ユーザーだけがマージする。そのmain pushを受けて
GitHub Actionsが自動デプロイする。失敗時は同じPRのCodexスレッドで修正を指示する。
再実行でのみ通ったケースは解決扱いにせず、最初の診断を残し、確認済みの原因と仮説を分ける。

## P3-Bのイベント別CI

| イベント | 共通検証 | Chromium・E2E | Pages |
| --- | --- | --- | --- |
| main宛ての `pull_request` | `npm ci` → 単体テスト → ビルド | L0／L1／L2に従う | デプロイしない |
| mainへの `push` | `npm ci` → 単体テスト → ビルド | 未実行（設計による省略） | 成功後にアップロード・デプロイ |
| `workflow_dispatch`（main指定を含む） | `npm ci` → 単体テスト → ビルド | 必ず全件 | デプロイしない |
| 将来の `schedule`（未有効化） | `npm ci` → 単体テスト → ビルド | mainを必ず全件 | デプロイしない |

P3-Aのマージ後の重複削減を維持する。main pushはChromiumもE2Eも起動せず、そのrunが
マージ後のmainから生成した `dist` を公開する。PR成果物や過去のテスト成功は流用しない。
Pagesアップロードと `deploy` の条件はともに
`github.event_name == 'push' && github.ref == 'refs/heads/main'`。
アップロードは通常の成功条件を保ち、`deploy` は `needs: build` に依存する。
検証の失敗・中断時、PR、手動検証、将来の定期検証では公開しない。

concurrencyはワークフロー名・イベント名・refごとに分離する。同じPRの更新では古いrunを
中断するが、PR・main push・手動検証・将来の定期検証は互いにキャンセルしない。
中断されたrunは最新HEADの成功条件を満たさない。

## リスク分類と選択範囲

| レベル | 判定 | 実行するE2E |
| --- | --- | --- |
| L0 | 登録済みのREADME・説明文書だけ | 未実行。単体テスト・ビルドは必須 |
| L1 | 対応表で影響範囲を明示した局所変更だけ | PCスモーク＋タッチスモーク＋関連specの和集合 |
| L2 | 高リスク・未知・分類不能、差分取得や選択結果の不整合 | 全件 |

L0の初期許可対象は `README.md` と `docs/` 直下の説明文書
`SAVE_DATA.md`、`FISH_SPECIES.md`、`FISH_SALES.md`、`FISHING_SPOTS.md`、
`FISHING_BALANCE.md`、`EQUIPMENT_UPGRADES.md`、`DEPTH_AND_TIME.md`、
`DAY_NIGHT_LIGHTING.md`、`CATCH_COLLECTION.md`、`AUDIO_SYSTEM.md`、`ACHIEVEMENTS.md`。
新規・未知の文書は運用ルールを含む可能性があるため、確認して許可対象へ追加するまでL2とする。
文書と実装の混在は厳しい側を採用する。複数のL1実装変更は関連specの和集合を実行するが、
複数領域のspecだけを変更した場合は保守的にL2とする。分類対象に未登録のspecや、
既存specの削除もL2。個別specの限定変更をL1にするときも、変更されたspec自身を必ず含める。
導入後1〜2週間は保守的に運用し、実測・依存関係の確認なしにL1を拡大しない。

`AGENTS.md`、`docs/TESTING_WORKFLOW.md`、GitHub Actions、選択スクリプトとそのテスト、
Playwright設定、共通fixture、ビルド設定・依存関係・lockfileはL2。
`src/main.js`、入力、ゲーム時計・状態遷移、セーブ・復元・検証、共通描画・環境、
`src/audio/audio-session.js` など共有音声ライフサイクル、複数機能を横断する変更もL2。
未知パス・影響範囲が曖昧なUI変更をL0／L1に推定しない。P3-BのPR自身もL2となる。

### L1対応表

対応表は `scripts/ci-risk.js` が唯一の判定元。独立した出力・表示処理に限定し、
ゲーム状態・入力・時計・セーブの変更へ自動拡張しない。

| 変更ファイル | 関連spec（すべて `tests/browser/`） |
| --- | --- |
| `src/audio/generated-sources.js`、`src/audio/ambient-player.js` | `audio.spec.js`、`audio-gain.spec.js` |
| `src/ui/sound-settings.js` | `audio.spec.js`、`collection-menu.spec.js` |
| `src/ui/achievements-view.js` | `achievements.spec.js`、`achievement-notice.spec.js`、`collection-menu.spec.js` |
| `src/ui/equipment-view.js` | `equipment-ui.spec.js`、`equipment-game.spec.js`、`collection-menu.spec.js` |

音源と環境音プレイヤーは音声の生成・再生の境界、設定UIと表示UIは各機能のDOM表示の
境界として選択する。設定・表示UIが共通メニューへ接続するため `collection-menu.spec.js` も含める。
実績・装備のゲーム状態側や共通音声制御へ変更が広がればL2となる。
`src/ui/sales-hud.js` と `src/ui/achievement-notice.js` も、状態・入力や通知の連携を保守的に
扱いL2のままとする。既知の個別specだけの変更はその対応領域のspecも選択する。

L1には常に `tests/browser/smoke-pc.spec.js` と `tests/browser/smoke-touch.spec.js` を加える。
本番ビルド上でアプリ起動・UIの操作可能性・重大なconsole/page errorの不在を確認し、
PCはマウス操船・停船・釣り視点への基本遷移、タッチはモバイル相当のviewportで
操船・タッチ終了とキャンセル・主要UIのタップを確認する。既存の `game.spec.js` や
他specのassertionは維持し、この共通スモークによって既存検証を置き換えない。

### 差分取得と実行の安全性

PRのbase SHA・head SHA、実際にcheckoutした検証ref・SHAを照合して記録する。
PRの変更集合は全履歴を取得したGitの差分で求め、追加・変更・削除・リネームを扱う。
リネームは旧パスと新パスの両方を分類する。NUL区切りでパスを扱い、空白・改行・
特殊文字を含む名前で判定を分割しない。差分取得エラー、空の異常結果、履歴不足、
SHA不整合はL2へ倒し、不完全なファイル集合からL0／L1を返さない。

specがディスクに存在することと、Playwrightが実際にテストを収集することは別に検証する。
L1の関連specが空・欠落、PC／タッチスモークが欠落、収集件数が0、実行結果が不足する場合は
全件へフォールバックするか明示的に失敗する。選択したテストの失敗・中断・未実行を
成功へ変換しない。L2も全件の収集・実行結果を確認する。

検証ジョブ `build` の表示名は `ci-required` に固定し、PRのjob全体をスキップする
pathsフィルターは設けない。共通検証と選択E2Eは同じジョブで順に実行する。
`continue-on-error` や成功だけを返す集約jobを設けず、診断アップロードが成功しても
先行する失敗は残す。途中の失敗や中断、必要な検証がskippedになった状態では成功しない。
Playwrightの `workers: 1`、共通診断fixture、Clock・描画負荷対策を維持する。

## Job SummaryとPRへの記録

Job SummaryにはPR番号、PR HEAD SHA、base SHA、実際の検証ref・SHA、選択レベルと理由、
変更ファイル、選択spec、PC／タッチスモーク、E2E実行の有無を記録する。
検証計画と実行結果は分けて表示し、最終的な成功・失敗・中断を確認する。
L0は「E2E未実行（L0設計）」と記録する。L1の未選択specは未実行であり、成功とは書かない。
job自体が中断されたときはActionsのcancelled表示も確認する。

PR本文は作成者・PMがSummaryを確認して更新する。自動編集専用のGitHub書き込み権限は追加しない。
最低限、次を本文へ記録する。

```text
分類: L0 / L1 / L2
根拠・変更領域:
PR HEAD / base / 検証SHA:
共通検証の結果:
選択E2E・PC/タッチスモーク:
実行結果（未選択・未実行を区別）:
未検証・未解決事項:
```

## 手動全件E2Eと定期実行の承認待ち

手動検証はGitHubの **Actions → Build and deploy BARB → Run workflow** から対象ブランチを
選んで起動する。mainを指定しても全件E2Eを実行し、Pagesへデプロイしない。
L0／L1へ強制変更して全件要求を弱める入力は用意しない。

定期全件E2Eはmainを対象とし、手動検証と同じく全件・デプロイなしで扱う準備をしている。
**cronは未有効化。実行頻度・時刻・タイムゾーンはユーザー承認待ち。**
1日1回は提案であり、承認された設定ではない。承認後の専用変更でscheduleを有効化する。
承認前に日時を推定して定期実行を開始しない。

有効化後はPR検証・main pushと相互キャンセルしないことを確認する。失敗時はActionsログと
14日保持の診断成果物を残し、PMが調査して影響する後続PRのマージ可否を判断する。
未解決の重大な共通回帰が判明したら、影響範囲を把握するまで後続マージを保留する。
日次失敗を成功扱いにせず、通知はGitHub標準のActions通知・Watch設定を優先する。
外部サービス接続・追加権限・自動投稿は無断で導入しない。

## mainの最新性とブランチ保護

2026-10-24のP3-B着手時に、mainは
`c1a56143b526f3da26144957ad614bb0ac339576`、`protected: false`、Rulesetは未設定と再確認した。
保護が有効だと仮定せず、Codexは設定を変更しない。PMはマージ直前に次を確認する。

1. PRの最新HEADに対する `ci-required` が成功し、分類と必要な実行範囲が正しい。
2. PRが現在のmainと統合可能であり、Summaryのbase・検証SHAが対象の組合せを示している。
3. mainが進んで検証済みの組合せが古くなった場合は、必要に応じてブランチ更新と再検証を要求する。
4. CIレベル・分類結果・選択ルールが変わった場合は最新HEADで再検証する。
5. 古いHEADや未検証の統合状態を成功済みとせず、PMが差分・診断品質もレビューする。

`ci-required` をGitHubの必須チェックに設定する案は次のとおり。実施はユーザーが判断する。

1. リポジトリの **Settings → Branches → Add branch protection rule** を開く。
2. Branch name patternを `main` にする。
3. **Require status checks to pass before merging** を有効にし、チェック一覧から
   `ci-required` を選択する。表示されない場合は、この名前のcheckが作成された後に再確認する。
4. **Require branches to be up to date before merging** を有効にし、main更新後の再検証を要求する。
5. 適用対象・bypass権限をPMが確認して保存し、mainに適用されたことを確認する。
   Rulesetsを使う場合は **Settings → Rules → Rulesets → New branch ruleset** でmainを対象にし、
   有効なルールへ同じ必須チェックと最新性の要件を設定する。

設定UIや保存が利用プラン・権限で制限される場合は、その制限をPRへ記録し、
PMの最新HEAD確認・手動マージ判断を継続する。保護未設定のまま強制力があるとは記載しない。
PR本文にもGUI手順と確認した設定状態を記載する。

### CIでの確認と時間計測

P3-BのPR自身はCI選択ロジックを変更するためL2となり、全件E2Eが起動することをPMが確認する。
以降のL0はE2E未実行、L1は両スモークと関連spec、L2は全件が実行されたことを確認する。
手動検証はmainでも全件・公開なし、main pushはChromium・E2E省略とビルド・公開を確認する。
必要な検証の失敗・中断が `ci-required` の成功にならないことも確認する。

所要時間を比較するときはrun ID・attempt・HEAD SHA・イベント・レベル・選択specを記録し、
共通検証、Chromium、E2E、アップロード、deployのstep開始・終了時刻を比較する。
失敗・再実行・中断・待ち時間は別記し、条件を揃える。公開までの時間はPM承認・マージ・
deploy完了を分けて記録する。Codexは計測のためのCI完了待機・継続監視を行わない。

## 局所検証

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npx playwright test tests/browser/smoke-pc.spec.js tests/browser/smoke-touch.spec.js --reporter=line
npx playwright test tests/browser/equipment-game.spec.js --grep 'touch:' --reporter=line
npx playwright test tests/browser/fishing.spec.js --grep 'mouse: blur/lost capture' --reporter=line
npx playwright test tests/browser/day-night.spec.js --grep 'night sailing' --reporter=line
```

選択ロジックの単体テストは `npm test` に含む。局所スモークは上記の2specだけで実行する。
`node scripts/ci-risk.js --output .ci/plan.json` はActionsのイベント情報から検証計画を生成する
CI用コマンドで、`node scripts/ci-e2e.js` がその計画に従って収集・実行を確認する。
模擬差分・失敗・欠落・イベント条件は選択ロジックと実行基盤の単体テストで検証する。
ローカルで全件を起動するためにCI用コマンドを使わない。

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
