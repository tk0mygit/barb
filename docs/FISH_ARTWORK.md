# 通常魚12種の画像制作（Phase 4C-1B）

通常魚の画像を、自然史図鑑を参考にしたセミリアルな2Dイラストへ置き換えます。
制作者表記はBARB project、制作手段はOpenAI `image_gen.imagegen`によるAI生成です。
ツールからモデル名・モデルバージョンは公開されていないため、推測で記載しません。
最終的な作品品質の承認はユーザーとPMが行います。

## 制作仕様と工程

- 全点が右向きの真横・全身。魚種固有の体型・模様・ヒレの位置を維持。
- 精密な鱗・ヒレ条・眼・口と控えめな絵画的質感。自然色、左上光源、強い演出光なし。
- 画像自体に背景・文字・ロゴ・釣り具・水・水草・岩・床の影を含めない。
- 1280×560px、PNG、8bit RGBA、非インターレース、明示的なsRGB、完全透過の外周。
- 各800KiB以下、12点合計8MiB以下。縦横比を保ち、長い魚と体高の高い魚を同じ輪郭へ変形しない。

最初にブラックバスとブルーギルを別々に生成し、比較画像で画風・ヒレ・余白を確認しました。
残り10点も各種の新しい画像として個別生成しています。同一魚体の色替えはしていません。
独立した画像レビューで、ブルーギルの胸びれと後部背びれ斑点、アロワナの体型と尾びれを確認・修正しました。
完成画像・統一背景のコンタクトシート・明暗背景での外周を確認してから本番へ配置しました。

生成指示・使用した自作スタイル参照・修正履歴は[制作記録](artwork/fish-generation.json)に収録します。
資料サイトの写真・図版をダウンロード、トレース、切り抜き、生成入力として使用していません。
スタイル参照に使用した画像は、この工程で制作したBARB用の画像だけです。

## 出力加工の再現

```bash
node scripts/normalize-fish-artwork.mjs ORIGINAL.png src/assets/fish/SPECIES-ID.png
```

Node 24とImageMagickを使用。元画像を1136×464以内へ比例縮小し、中央に配置して
1280×560の透明キャンバスへ余白を追加します。魚体を引き伸ばしたり、ヒレを切ったりしません。
生成・縮小後にalpha 250〜254のほぼ不透明な魚体画素があるため、縮小後のalpha 250以上を255へ正規化します。
それより低い輪郭・ヒレの半透明画素と、完全透過の背景画素は維持します。
8bit RGBAへ変換して可逆圧縮し、sRGBチャンクを明示、日時・コメント等の不要なメタデータを除去します。
減色・非可逆圧縮・第三者素材の合成・SVG拡大は行っていません。
修正は画像生成ツールで行い、このスクリプトは納品形式への変換だけを担当します。
元の生成ファイルは作業環境に保持し、納品PNGと正確なプロンプトをリポジトリへ記録します。

## 利用条件と出典

2026-10-24に公式資料を確認しました。
[OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/)のContentと
[OpenAI Services Agreement](https://openai.com/policies/services-agreement/)の4.1は、
法律の許す範囲で出力に関するOpenAIの権利をユーザー／顧客へ帰属させています。
この条件に基づき、オリジナルのテキスト指示と自作参照から生成した画像をBARBの商用・公開用途に使用します。
第三者の写真・素材の利用許諾を代替する条項ではありません。出力の独自性・著作権成立・独占性は保証されません。
[Sharing & Publication Policy](https://openai.com/policies/sharing-publication-policy/)も参照し、
この文書・制作記録・レビューシートへAI生成であることを明記しています。
第三者画像・有料ストック素材は使用していません。

以下の魚類資料は形態の事実確認に利用しています。図版・写真の著作権は各権利者にあり、転載していません。
イワナは *Salvelinus leucomaenis*、ナマズは成魚の *Silurus asotus*、
アロワナはシルバーアロワナ *Osteoglossum bicirrhosum* として制作します。
これらは画像の対象分類の選択で、ゲームのID・表示名・説明は変更しません。

| ID | 制作時の個別指示・識別確認 | 形態資料 |
| --- | --- | --- |
| black-bass | 大きな口、眼の後端より後ろまで延びる上顎、暗い横帯、深くくびれた背びれ | [Michigan DNR](https://www.michigan.gov/dnr/education/michigan-species/fish-species/largemouth) |
| smallmouth-bass | 眼付近で終わる短い上顎、青銅色、縦模様。バスの横帯を流用しない | [Michigan DNR](https://www.michigan.gov/dnr/education/michigan-species/fish-species/smallmouth) |
| bluegill | 円盤状の体、小さい口、黒いえらぶた後端、長く尖った胸びれ、後部背びれの暗斑 | [Michigan DNR](https://www.michigan.gov/dnr/education/michigan-species/fish-species/bluegill) |
| rainbow-trout | 銀色、桃色の体側、尾びれ両葉を含む細かな黒点、主背びれと脂びれ | [Michigan DNR](https://www.michigan.gov/dnr/education/michigan-species/fish-species/rainbow-trout) |
| brown-trout | 黄褐色、黒点と淡い縁のある赤点、やや角張り斑点の少ない尾、脂びれ | [Michigan DNR](https://www.michigan.gov/dnr/education/michigan-species/fish-species/brown-trout) |
| iwana | 暗い細長い体に乳白色の斑点、脂びれ。ブルックトラウトの虫食い模様や青い輪を混ぜない | [青森産技](https://www.aomori-itc.or.jp/soshiki/suisan_naisuimen/naisuimen/iwana.html)、[NIES](https://www.nies.go.jp/biodiversity/invasive/DB/detail/50850.html) |
| northern-pike | 長い胴と平たい口先、暗色地に淡い斑点、尾寄りの背びれと尻びれ、二叉尾 | [North Dakota GF](https://gf.nd.gov/wildlife/id/northern-pike) |
| european-perch | 暗い縦帯、2枚の背びれ、前背びれ後部の暗斑、赤橙の腹・尻びれ | [NSW DPIRD](https://www.dpird.nsw.gov.au/dpi/biosecurity/aquatic-biosecurity/aquatic-pests-and-diseases/freshwater-pests/freshwater-finfish/redfin-perch) |
| walleye | 細長い体、大きな反射眼、2枚の背びれと前部棘条、尾の下端の淡色。眼を発光させない | [Minnesota DNR](https://www.dnr.state.mn.us/fish/walleye/biology.html) |
| catfish | 滑らかな無鱗の体、幅広い頭、小さい背びれ、長い尻びれ、成魚のひげ2対。脂びれなし | [NIES](https://www.nies.go.jp/biodiversity/invasive/DB/detail/50800.html) |
| alligator-gar | 長いが幅広い口先、菱形の装甲鱗、尾寄りの背・尻びれ、丸い尾。ロングノーズガーと混同しない | [TPWD](https://tpwd.texas.gov/fishboat/fish/management/alligator-gar/identify-gar.phtml) |
| arowana | 長く扁平な銀色の体、大きな鱗、上向きの口と下顎先端の2本のひげ、長い背・尻びれ、小さい尾 | [Smithsonian](https://nationalzoo.si.edu/animals/silver-arowana) |

## 統合と検証

本番は `src/assets/fish/<species-id>.png`。静的な `new URL(..., import.meta.url).href` により
Viteの `/barb/` 配信へ対応します。共通の `unknown.svg` は維持します。
4表示面の `.fish-image-frame` と `object-fit: contain`、図鑑・保管の遅延読み込みを維持します。
画像以外の魚種メタデータ・ゲーム処理・保存形式は変更しません。

`tests/fish-artwork.test.js`は12枚の内容重複・PNG構造・寸法・容量・sRGB・実alpha・外周と余白を検証します。
SVG／透過PNGの形式別テストと専用fixtureは継続します。
`tests/browser/fish-assets.spec.js`はPC・スマートフォン縦横で、12種を旧v1セーブから復元し、
図鑑・詳細・保管・釣果で同じ画像が表示されること、未発見魚のDOMマスク、読込前後の枠、画像エラーを検証します。

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/report-fish-artwork.mjs
```

ビルド後に上記を実行すると、`test-results/fish-artwork-review/`へ12種コンタクトシート、
2種の比較画像、各画像の寸法・容量・透過情報・SHA256・ビルド先を含む品質JSON／Markdownを生成します。
同じレポートはfish-assetsのPCケースでも生成し、既存Actionsの`browser-test-results`診断成果物へ保存します。
UIスクリーンショットと初回・図鑑の画像読込JSONも同じ診断成果物へ収録します。
ブラウザによる端末相当の確認とスマートフォン実機の性能確認は区別してください。

## 納品画像と通信量の実測

2026-10-24のローカル検証。全点1280×560、RGBA8、非インターレース、sRGB。
外周alphaは全点0、各画像の魚体に完全不透明画素があり、8px以上の透明余白を維持しています。
個別PNGのSHA256は[制作記録](artwork/fish-generation.json)、画像の目視確認は[独立レビュー](artwork/fish-visual-review.md)を参照してください。

| ID | Bytes | KiB |
| --- | ---: | ---: |
| black-bass | 648,496 | 633.3 |
| smallmouth-bass | 567,716 | 554.4 |
| bluegill | 487,329 | 475.9 |
| rainbow-trout | 533,310 | 520.8 |
| brown-trout | 561,032 | 547.9 |
| iwana | 439,757 | 429.5 |
| northern-pike | 352,051 | 343.8 |
| european-perch | 526,708 | 514.4 |
| walleye | 560,071 | 546.9 |
| catfish | 400,379 | 391.0 |
| alligator-gar | 379,952 | 371.0 |
| arowana | 407,085 | 397.5 |

- 12画像合計: **5,863,886 bytes（5.592 MiB）**。
- 本番ビルドのアセット合計: **6,563,696 bytes**。dist全体: **6,570,160 bytes**（ルートのアイコン等を含む）。
- 初回起動と未発見図鑑: 画像ネットワークリクエスト0、魚PNG転送0 bytes。共通シルエットはインラインSVG。
- 発見済み全12種までスクロールした図鑑: **5,863,886 bytes**（元PNG、HTTP圧縮なし）。
- 全12枚のRGBA展開量の計算値: **34,406,400 bytes（32.8125 MiB）**。ブラウザ内部・GPUの総使用メモリやFPSの実測値ではありません。
- PC 1280×800、タッチ相当390×844／844×390で全12枚のデコード・4表示面・旧v1復元を検証し、画像読込エラー0を確認しました。実機スマートフォンのGPU・通信・FPSは未確認です。
- 既存の遅延読み込みを維持し、全魚画像のpreload・重いライブラリの追加はありません。

[リポジトリ上の画像一覧](artwork/contact-sheet.md)。統一背景のコンタクトシートPNGとUIスクリーンショットは
Actionsの診断成果物に保存します。最終HEADの全件E2Eと描画品質はPMが確認します。

ローカル結果: `npm ci`、`npm test`（442件）、`npm run build`、fish-assets E2E（9件）、
釣り・図鑑・保管／売却・セーブ・PC／タッチスモーク（14件）はすべて成功しました。
最初のPNG検証で検出した近不透明alphaは素材側で補正し、検証を維持しました。
新規PC枠検証のスクロール座標による浮動小数差は、CSS解決寸法の厳密比較へ修正しました。
初回の診断を保持し、最終検証は別ディレクトリへ保存しています。
全件E2Eはローカルで実行せず、P3-BのL2としてActionsへ引き継ぎます。
