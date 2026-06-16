# Sat-Pass-reporter

Sat-Pass-reporter は、人工衛星の TLE を取得し、指定した地上局から見える PASS を予測して、Slack に自動通知するためのレポート生成ツールです。

主に `Mono-Nikko(H)` の PASS 予報を対象としており、GitHub Actions を使うことで、常時稼働サーバーを用意せずに定時通知できます。

## できること

* TLE の取得・更新
* 指定地上局から見える PASS の予測
* AOS / LOS / MEL の算出
* MEL しきい値による運用判断の補助
* Slack への PASS 予報投稿
* レーダーチャート PNG の生成・添付
* GitHub Actions による定時実行
* 送信済みマーカーによる二重送信防止
* TLE 更新・Slack 送信漏れの 00〜02 JST リカバリ

## 開発背景

本プロジェクトは、[`satpass-ops-console`](https://github.com/FujimotoShota-toruca/satpass-ops-console) をベースに作成しています。

`satpass-ops-console` は、TLE と地上局情報をもとに、衛星の地上軌跡、可視パス、方位角・仰角、日照/蝕、Doppler CSV などを表示・出力する運用支援アプリです。

Sat-Pass-reporter では、ブラウザ上での手動確認ではなく、Slack 通知と GitHub Actions による自動運用に特化しています。

## 構成

```text
Sat-Pass-reporter
├── .github/
│   └── workflows/
│       ├── pass-slack-report.yml          # 18 JST の翌日 PASS 予報通知
│       ├── recover-today-pass-report.yml  # 00〜02 JST の当日 PASS リカバリ通知
│       └── update-tle.yml                 # TLE 手動更新
├── config/
│   ├── slack-pass-report.json             # 地上局・予測・通知設定
│   └── skyline-teikyo.csv                 # 方位別スカイライン設定
├── data/
│   └── tle-sources.json                   # TLE取得元一覧
├── public/
│   └── tle/                               # 取得済みTLE
├── reports/
│   ├── sent/                              # Slack送信済みマーカー
│   └── tle-updated/                       # TLE更新確認済みマーカー
├── scripts/
│   ├── update-tle.mjs                     # TLE取得・更新
│   ├── send-pass-report.mjs               # PASS予報生成・Slack投稿
│   └── lib/
│       ├── satpass-core.mjs               # PASS予測・判定処理
│       ├── radar-png.mjs                  # レーダーチャートPNG生成
│       └── slack-client.mjs               # Slack APIクライアント
├── package.json
└── package-lock.json
```

## 必要環境

* Node.js 24 以上
* npm
* Slack App
* GitHub Actions

GitHub Actions では Node.js 24 を使用します。

## セットアップ

### 1. 依存関係をインストール

```bash
npm ci
```

### 2. Slack App を用意する

Slack App を作成し、Bot User OAuth Token を発行します。

必要な Bot Token Scopes は以下です。

```text
chat:write
files:write
```

作成した Bot は、投稿先の Slack チャンネルに追加してください。

投稿先が private channel の場合も、Bot をチャンネルへ招待する必要があります。

```text
/invite @Slack App名
```

### 3. GitHub Secrets を設定する

GitHub リポジトリの以下の場所に Secrets を登録します。

```text
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
```

テスト送信用:

| Name               | 内容                   |
| ------------------ | -------------------- |
| `SLACK_BOT_TOKEN`  | テスト用 Slack Bot Token |
| `SLACK_CHANNEL_ID` | テスト用 Slack チャンネル ID  |

本番送信用:

| Name                 | 内容                  |
| -------------------- | ------------------- |
| `SLACK_BOT_TOKEN_1`  | 本番用 Slack Bot Token |
| `SLACK_CHANNEL_ID_1` | 本番用 Slack チャンネル ID  |

任意で Repository Variables に以下を設定できます。

| Name                               | 内容                  | 既定値  |
| ---------------------------------- | ------------------- | ---- |
| `PASS_OPERATION_MIN_ELEVATION_DEG` | 運用判断の補助に使う MEL しきい値 | `10` |

## 設定ファイル

メイン設定は `config/slack-pass-report.json` です。

```json
{
  "timezone": "Asia/Tokyo",
  "satellite_id": "mono-nikko-h",
  "station": {
    "id": "Teikyo_Utsunomiya",
    "name": "Teikyo GS",
    "latitude_deg": 36.605000000000004,
    "longitude_deg": 139.88166666666666,
    "altitude_m": 180
  },
  "prediction": {
    "horizon_hours": 26,
    "step_sec": 0.01,
    "command_elevation_deg": 5.0,
    "operation_min_elevation_deg": 10.0,
    "radar_sample_step_sec": 1.0,
    "radar_min_elevation_deg": 0.0,
    "report_min_elevation_deg": 0.0
  },
  "reporting": {
    "send_mode": "fixed_time",
    "fixed_send_time": "18:00",
    "date_selection": "next_day_for_18jst_schedule",
    "no_operational_pass_policy": "send_at_fixed_time"
  },
  "skyline": {
    "enabled": true,
    "csv_path": "config/skyline-teikyo.csv",
    "format": "azimuth_deg,elevation_deg",
    "behavior": "draw_profile_and_cut_below_skyline"
  }
}
```

主な項目は以下です。

| 項目                            | 説明                                  |
| ----------------------------- | ----------------------------------- |
| `timezone`                    | レポートで使用するタイムゾーン                     |
| `satellite_id`                | `data/tle-sources.json` に定義された衛星 ID |
| `station`                     | 地上局の緯度・経度・高度                        |
| `horizon_hours`               | PASS 予測対象時間                         |
| `command_elevation_deg`       | PASS 検出に使う最低仰角                      |
| `operation_min_elevation_deg` | 運用判断の補助に使う MEL しきい値                 |
| `radar_sample_step_sec`       | レーダーチャート描画用のサンプリング間隔                |
| `skyline.csv_path`            | 方位別スカイライン CSV                       |

## TLE 取得元

TLE 取得元は `data/tle-sources.json` で管理します。

```json
[
  {
    "id": "mono-nikko-h",
    "name": "Mono-Nikko(H)",
    "catnr": "68799",
    "url": "https://celestrak.org/NORAD/elements/gp.php?CATNR=68799&FORMAT=TLE",
    "output": "public/tle/mono-nikko-h.tle"
  }
]
```

`id` は `config/slack-pass-report.json` の `satellite_id` と一致させます。

## PASS 判定ルール

MEL しきい値を `N` 度とした場合、判定は以下です。

```text
MEL <= N度 : 非運用
MEL > N度  : 運用
```

既定値は `N = 10` 度です。

## Slack 通知形式

Slack には、使用した TLE、PASS 一覧、レーダーチャートを投稿します。

PASS 一覧は以下の形式です。

```text
Pass[No] [AOS時刻]to[LOS時刻] @ MEL=[MEL][deg.]
```

投稿例:

```text
〖パス予報〗
使用したTLE
Mono-Nikko(H)
1 XXXXXU ...
2 XXXXX ...

Pass[No] [AOS時刻]to[LOS時刻]@MEL=[MEL][deg.] の形式で書いております

6/17
Pass[01] 01:23 to 01:34 @ MEL=8.2[deg.]
Pass[02] 03:01 to 03:12 @ MEL=44.6[deg.]

レーダーチャート
水色：Pass[01]
橙色：Pass[02]
```

## レーダーチャート

Slack 投稿時には、PASS を描画したレーダーチャート PNG を添付します。

* 方位は `N / E / S / W` で表示
* `config/skyline-teikyo.csv` のスカイラインを反映
* PASS ごとに色分けして描画
* 画像は `output/slack-pass-report/` に保存

## GitHub Actions

### 18 JST の翌日 PASS 予報通知

`.github/workflows/pass-slack-report.yml` により、毎日 18 JST 台に翌日の PASS 予報を Slack へ投稿します。

通常実行では、対象日は JST の翌日です。

例:

```text
2026-06-16 18:07 JST に実行
→ 2026-06-17 の PASS 予報を送信
```

処理の流れ:

1. リポジトリを checkout
2. Node.js をセットアップ
3. `npm ci` で依存関係をインストール
4. 予報対象日を解決
5. `reports/tle-updated/YYYY-MM-DD.json` を確認
6. 未作成なら TLE を更新
7. PASS 予報を生成
8. Slack へ投稿
9. `reports/sent/YYYY-MM-DD.json` を作成
10. TLE やマーカーに変更があれば commit / push

### 00〜02 JST の当日 PASS リカバリ通知

`.github/workflows/recover-today-pass-report.yml` により、00〜02 JST の間に当日分の PASS 予報が送信済みかを再確認します。

通常実行では、対象日は JST の当日です。

例:

```text
2026-06-17 00:00 JST に実行
→ 2026-06-17 の PASS 予報が送信済みか確認
→ 未送信なら TLE を更新して 2026-06-17 の PASS 予報を送信
```

リカバリ対象になる条件:

* `reports/sent/YYYY-MM-DD.json` が存在しない
* `reports/tle-updated/YYYY-MM-DD.json` が存在しない
* 手動実行で `force_send=true` を指定した

00〜02 JST の schedule 実行では、JST 03:00 以降に遅延起動した場合は処理を停止します。

手動実行の場合は、時間帯チェックを bypass します。

### TLE の手動更新

`.github/workflows/update-tle.yml` により、TLE の手動更新を実行できます。

TLE に変更があった場合は、`public/tle/` を commit / push します。

## 予報日と JSON マーカー

本リポジトリでは、`reports/tle-updated/*.json` と `reports/sent/*.json` のファイル名を **予報対象日** に揃えます。

```text
reports/tle-updated/YYYY-MM-DD.json
reports/sent/YYYY-MM-DD.json
```

例:

```text
18時台に 2026-06-17 の予報を送る場合:
reports/tle-updated/2026-06-17.json
reports/sent/2026-06-17.json

00〜02時台に 2026-06-17 の当日予報をリカバリする場合:
reports/tle-updated/2026-06-17.json
reports/sent/2026-06-17.json
```

`reports/tle-updated/YYYY-MM-DD.json` は、その予報対象日に対して TLE 更新確認を行ったことを示します。

`reports/sent/YYYY-MM-DD.json` は、その予報対象日の Slack 投稿が完了したことを示します。

## 手動実行

### PASS Slack Report 18 JST

18 JST の翌日予報 workflow は手動実行にも対応しています。

| 入力                            | 説明                              | 既定値     |
| ----------------------------- | ------------------------------- | ------- |
| `date_ymd`                    | 対象日。例: `2026-06-17`。空なら JST の翌日 | 空       |
| `operation_min_elevation_deg` | MEL 判定しきい値                      | `10`    |
| `force_send`                  | 送信済みでも再送するか                     | `false` |
| `slack_target`                | `test` または `prod`               | `test`  |

### Recover Today PASS Report 00-02 JST

00〜02 JST のリカバリ workflow も手動実行できます。

| 入力                            | 説明                              | 既定値     |
| ----------------------------- | ------------------------------- | ------- |
| `date_ymd`                    | 対象日。例: `2026-06-17`。空なら JST の当日 | 空       |
| `operation_min_elevation_deg` | MEL 判定しきい値                      | `10`    |
| `force_send`                  | 送信済みでも再送するか                     | `false` |
| `slack_target`                | `test` または `prod`               | `test`  |

`slack_target` の対応は以下です。

| `slack_target` | 使用する Secret                               |
| -------------- | ----------------------------------------- |
| `test`         | `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`     |
| `prod`         | `SLACK_BOT_TOKEN_1`, `SLACK_CHANNEL_ID_1` |

## ローカル実行

### 構文チェック

```bash
npm run check
```

### TLE 更新

```bash
npm run update-tle
```

### Slack 通知

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
npm run send-pass-report
```

対象日を指定する場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_REPORT_DATE_YMD="2026-06-17" \
npm run send-pass-report
```

対象日を「今日」にする場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_REPORT_DATE_MODE=today \
npm run send-pass-report
```

対象日を「明日」にする場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_REPORT_DATE_MODE=tomorrow \
npm run send-pass-report
```

送信済みマーカーを無視して再送する場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_REPORT_DATE_YMD="2026-06-17" \
PASS_FORCE_SEND=true \
npm run send-pass-report
```

送信理由を明示する場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_REPORT_DATE_YMD="2026-06-17" \
PASS_SEND_REASON="manual recovery report" \
npm run send-pass-report
```

MEL 判定しきい値を変更する場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_OPERATION_MIN_ELEVATION_DEG=15 \
npm run send-pass-report
```

## 環境変数

`scripts/send-pass-report.mjs` で使用する主な環境変数です。

| 変数                                 | 説明                              | 既定値             |
| ---------------------------------- | ------------------------------- | --------------- |
| `SLACK_BOT_TOKEN`                  | Slack Bot Token                 | 必須              |
| `SLACK_CHANNEL_ID`                 | 投稿先 Slack チャンネル ID              | 必須              |
| `PASS_REPORT_DATE_YMD`             | 予報対象日。`YYYY-MM-DD`              | 空               |
| `PASS_REPORT_DATE_MODE`            | `today` または `tomorrow`          | `today`         |
| `PASS_FORCE_SEND`                  | `true` なら送信済みでも再送               | `false`         |
| `PASS_SEND_REASON`                 | `reports/sent/*.json` に記録する送信理由 | 実行モードから自動設定     |
| `PASS_TEST_MODE`                   | `true` ならテスト文言を Slack 本文へ追加     | `false`         |
| `PASS_OPERATION_MIN_ELEVATION_DEG` | MEL 判定しきい値                      | config または `10` |
| `PASS_SKIP_LOS_CHECK`              | LOS チェックをスキップするための運用フラグ         | workflow 側で指定   |

`PASS_REPORT_DATE_YMD` が指定されている場合、`PASS_REPORT_DATE_MODE` より優先されます。

## 生成されるファイル

| パス                                    | 内容             |
| ------------------------------------- | -------------- |
| `public/tle/*.tle`                    | 取得・更新された TLE   |
| `public/tle/manifest.json`            | TLE 更新結果のメタ情報  |
| `output/slack-pass-report/*.png`      | 生成されたレーダーチャート  |
| `output/slack-pass-report/*.txt`      | Slack 本文の保存結果  |
| `reports/sent/YYYY-MM-DD.json`        | Slack 送信済みマーカー |
| `reports/tle-updated/YYYY-MM-DD.json` | TLE 更新確認済みマーカー |

## 二重送信防止

Slack 送信後、`reports/sent/YYYY-MM-DD.json` が作成されます。

同じ日付のマーカーが存在する場合、通常実行では再送しません。

再送する場合は、手動実行時に `force_send=true` を指定します。

## Slack に送信できない場合

GitHub Actions のログを確認してください。

よくある原因は以下です。

| ログ例                                                | 原因                                     | 対応                            |
| -------------------------------------------------- | -------------------------------------- | ----------------------------- |
| `Slack token or channel ID is empty.`              | Secrets が未設定、または `slack_target` が想定と違う | Secrets と `slack_target` を確認  |
| `chat.postMessage failed: invalid_auth`            | Token が無効                              | Slack Bot Token を再確認          |
| `chat.postMessage failed: missing_scope`           | `chat:write` が不足                       | Slack App に `chat:write` を追加  |
| `chat.postMessage failed: channel_not_found`       | チャンネル ID が違う、または Bot が未参加              | Channel ID と Bot 参加状態を確認      |
| `chat.postMessage failed: not_in_channel`          | Bot が投稿先チャンネルに参加していない                  | `/invite @Slack App名` を実行     |
| `files.getUploadURLExternal failed: missing_scope` | `files:write` が不足                      | Slack App に `files:write` を追加 |

`slack_target=test` の場合は以下を使います。

```text
SLACK_BOT_TOKEN
SLACK_CHANNEL_ID
```

`slack_target=prod` の場合は以下を使います。

```text
SLACK_BOT_TOKEN_1
SLACK_CHANNEL_ID_1
```

通常は `slack_target=test` でテスト送信します。本番送信したい場合は、手動実行時に `slack_target=prod` を指定してください。

## 注意事項

* Slack Bot は投稿先チャンネルに参加している必要があります。
* Slack Bot Token と Channel ID は GitHub Secrets に登録し、リポジトリへ直接 commit しないでください。
* TLE は軌道予測の元データであるため、古い TLE を使うと予測精度が低下します。
* 18 JST の workflow は、通常時は翌日予報を送信します。
* 00〜02 JST の recovery workflow は、通常時は当日予報を送信します。
* `reports/tle-updated/*.json` と `reports/sent/*.json` のファイル名は、実行日ではなく予報対象日です。
* 実運用前に、TLE、地上局座標、スカイライン、MEL しきい値、Slack 投稿先を確認してください。
* 本ツールの出力は運用判断の補助であり、最終的な運用可否は利用者が確認してください。

## AI 利用について

本リポジトリのコード作成、改修補助、README 作成には GPT（ChatGPT）を使用しています。

生成されたコード・文章はそのまま無条件に利用せず、目的に合うように開発者が確認・修正しています。

## 謝辞

本プロジェクトは、FujimotoShota-toruca 氏の [`satpass-ops-console`](https://github.com/FujimotoShota-toruca/satpass-ops-console) をベースに作成しました。

衛星 PASS 可視化・運用支援という基本方針を参考にしつつ、本リポジトリでは Slack 通知と GitHub Actions による自動運用に特化しています。

## ライセンス

現時点ではライセンス未設定です。
