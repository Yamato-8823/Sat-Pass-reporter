# Sat-Pass-reporter

Sat-Pass-reporter は、人工衛星の TLE を取得し、指定した地上局から見える PASS を予測して、Slack へ自動通知するためのレポート生成ツールです。

主に `Mono-Nikko(H)` の PASS 予報を対象としており、GitHub Actions 上で毎日 18:00 JST に実行することで、常時稼働サーバーを用意せずに Slack 通知を行えます。

## 開発背景

本プロジェクトは、 [`satpass-ops-console`](https://github.com/FujimotoShota-toruca/satpass-ops-console) をベースにしています。

`satpass-ops-console` は、TLE と地上局情報を用いて、衛星の地上軌跡、可視パス、方位角・仰角、日照/蝕、Doppler CSV などを表示・出力する運用支援アプリです。

Sat-Pass-reporter では、その考え方をもとに、ブラウザ上での手動確認ではなく、以下のような Slack 通知向けの自動運用に特化しました。

- TLE の定期取得
- 指定地上局での PASS 予測
- MEL による運用 / 非運用の判定
- Slack への PASS 予報投稿
- レーダーチャート PNG の自動生成・添付
- GitHub Actions による定時実行
- 送信済みマーカーによる二重送信防止

## AI 利用について

本リポジトリのコード作成、改修補助、README 作成には GPT（ChatGPT）を使用しています。

ただし、生成されたコード・文章はそのまま無条件に利用するのではなく、目的に合うように開発者が確認・修正しています。実際の衛星運用に利用する場合は、TLE、地上局設定、しきい値、時刻、Slack 投稿内容を必ず事前に確認してください。

## 主な機能

- CelesTrak などの URL から TLE を取得
- `satellite.js` による衛星位置計算
- 指定した地上局から見える PASS を予測
- AOS / LOS / MEL を Slack 向けに整形
- MEL しきい値により `[運用]` / `[非運用]` を分類
- 運用 PASS のレーダーチャート PNG を生成
- Slack に本文と画像を投稿
- GitHub Actions で毎日 18:00 JST に自動実行
- 手動実行時に対象日・MEL しきい値・強制送信を指定可能
- 送信済みマーカーにより同一日の二重送信を防止

## リポジトリ構成

```text
Sat-Pass-reporter
├── .github/
│   └── workflows/
│       ├── pass-slack-report.yml   # PASS予報のSlack定時通知
│       └── update-tle.yml          # TLE更新用workflow
├── config/
│   ├── slack-pass-report.json      # 地上局・予測・通知設定
│   └── skyline-teikyo.csv          # 方位別スカイライン設定
├── data/
│   └── tle-sources.json            # TLE取得元一覧
├── public/
│   └── tle/
│       └── mono-nikko-h.tle        # 取得済みTLE
├── reports/
│   ├── sent/                       # Slack送信済みマーカー
│   └── tle-updated/                # TLE更新確認済みマーカー
├── scripts/
│   ├── update-tle.mjs              # TLE取得・更新
│   ├── send-pass-report.mjs        # PASS予報生成・Slack投稿
│   └── lib/
│       ├── satpass-core.mjs        # PASS予測・時刻整形・判定処理
│       ├── radar-png.mjs           # レーダーチャートPNG生成
│       └── slack-client.mjs        # Slack APIクライアント
├── package.json
└── package-lock.json
```

## 必要環境

- Node.js 20 以上
- npm
- GitHub Actions
- Slack Bot Token

## セットアップ

### 1. 依存関係のインストール

```bash
npm ci
```

### 2. Slack App の準備

Slack App を作成し、Bot User OAuth Token を発行します。

必要な Bot Token Scopes は次の通りです。

```text
chat:write
files:write
```

作成した Bot を投稿先チャンネルに追加してください。

### 3. GitHub Secrets の設定

GitHub リポジトリの `Settings` から、以下の Secrets を登録します。

```text
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
```

| Name | 内容 |
|---|---|
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token |
| `SLACK_CHANNEL_ID` | 投稿先 Slack チャンネル ID |

任意で Repository Variables に以下を設定できます。

| Name | 内容 | 既定値 |
|---|---|---|
| `PASS_OPERATION_MIN_ELEVATION_DEG` | 運用 / 非運用判定に使う MEL しきい値 | `10` |

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
    "date_selection": "today_when_not_specified",
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

### 主な設定項目

| 項目 | 説明 |
|---|---|
| `timezone` | レポートで使用するタイムゾーン |
| `satellite_id` | `data/tle-sources.json` に定義された衛星 ID |
| `station` | 地上局の緯度・経度・高度 |
| `horizon_hours` | PASS 予測対象時間 |
| `command_elevation_deg` | PASS 検出に使う最低仰角 |
| `operation_min_elevation_deg` | 運用 / 非運用判定に使う MEL しきい値 |
| `radar_sample_step_sec` | レーダーチャート描画用のサンプリング間隔 |
| `skyline.csv_path` | 方位別スカイライン CSV |

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

MEL しきい値を `N` 度とした場合、判定は次の通りです。

```text
MEL <= N度 : 非運用
MEL >  N度 : 運用
```

既定では `N = 10` 度です。

## Slack 通知形式

Slack には、使用した TLE、PASS 一覧、レーダーチャートの凡例を投稿します。

PASS 一覧は次の形式です。

```text
Pass[No] [AOS時刻]to[LOS時刻]@MEL=[MEL][deg.] [運用/非運用]
```

投稿例:

```text
〖パス予報〗
使用したTLE
```

```text
Mono-Nikko(H)
1 XXXXXU ...
2 XXXXX ...
```

```text
Pass[No] [AOS時刻]to[LOS時刻]@MEL=[MEL][deg.] [運用/非運用] の形式で書いております

6/7
Pass[01] 01:23 to 01:34 @ MEL=8.2[deg.] [非運用]
Pass[02] 03:01 to 03:12 @ MEL=44.6[deg.] [運用]

レーダーチャート
水色：Pass[02]
```

## レーダーチャート

Slack 投稿時には、運用 PASS を描画したレーダーチャート PNG も添付します。

- `[運用]` 判定の PASS を描画
- `[非運用]` 判定の PASS は凡例対象外
- 方位は `N / E / S / W` で表示
- `config/skyline-teikyo.csv` によるスカイラインを反映
- 最大 6 PASS まで色分けして描画

凡例の色は次の順番で割り当てます。

| 順番 | 表示名 |
|---|---|
| 1 | 水色 |
| 2 | 黄緑 |
| 3 | 桃色 |
| 4 | 橙色 |
| 5 | 紫色 |
| 6 | 赤色 |

## GitHub Actions による自動実行

`.github/workflows/pass-slack-report.yml` により、毎日 18:00 JST に PASS 予報を Slack へ投稿します。

GitHub Actions の cron は UTC 基準のため、18:00 JST は 09:00 UTC です。

```yaml
schedule:
  - cron: "0 9 * * *"
```

処理の流れは次の通りです。

1. リポジトリを checkout
2. Node.js をセットアップ
3. `npm ci` で依存関係をインストール
4. 当日分の TLE を確認・更新
5. PASS 予報を生成
6. Slack へ投稿
7. TLE や送信済みマーカーに変更があれば commit / push

## 手動実行

GitHub Actions の `PASS Slack Report 18 JST` は手動実行にも対応しています。

指定可能な入力は次の通りです。

| 入力 | 説明 | 既定値 |
|---|---|---|
| `date_ymd` | 対象日。例: `2026-06-07` | 空なら当日 |
| `operation_min_elevation_deg` | MEL 判定しきい値 | `10` |
| `force_send` | 送信済みでも再送するか | `false` |

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

任意の日付を指定する場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_REPORT_DATE_YMD="2026-06-07" \
PASS_FORCE_SEND=true \
npm run send-pass-report
```

MEL 判定しきい値を変更する場合:

```bash
SLACK_BOT_TOKEN="xoxb-..." \
SLACK_CHANNEL_ID="CXXXXXXXXXX" \
PASS_OPERATION_MIN_ELEVATION_DEG=15 \
npm run send-pass-report
```

## 生成されるファイル

| パス | 内容 |
|---|---|
| `public/tle/*.tle` | 取得・更新された TLE |
| `public/tle/manifest.json` | TLE 更新結果のメタ情報 |
| `output/slack-pass-report/*.png` | 生成されたレーダーチャート |
| `output/slack-pass-report/*.txt` | Slack 本文の保存結果 |
| `reports/sent/YYYY-MM-DD.json` | Slack 送信済みマーカー |
| `reports/tle-updated/YYYY-MM-DD.json` | TLE 更新確認済みマーカー |

## 二重送信防止

Slack 送信後、`reports/sent/YYYY-MM-DD.json` が作成されます。

同じ日付のマーカーが存在する場合、通常実行では再送しません。再送したい場合は、手動実行時に `force_send=true` を指定します。

## 注意事項

- Slack Bot は投稿先チャンネルに参加している必要があります。
- `SLACK_BOT_TOKEN` と `SLACK_CHANNEL_ID` は GitHub Secrets に登録し、リポジトリへ直接 commit しないでください。
- TLE は軌道予測の元データであるため、古い TLE を使うと予測精度が低下します。
- GitHub Actions の cron は UTC 基準です。
- 実運用前に、TLE、地上局座標、スカイライン、MEL しきい値、Slack 投稿先を確認してください。
- 本ツールの出力は運用判断の補助であり、最終的な運用可否は利用者が確認してください。

## 謝辞

本プロジェクトは、FujimotoShota-toruca 氏の [`satpass-ops-console`](https://github.com/FujimotoShota-toruca/satpass-ops-console) をベースに作成しました。

衛星 PASS 可視化・運用支援という基本方針を参考にしつつ、本リポジトリでは Slack 通知と GitHub Actions による自動運用に特化しています。

## ライセンス

現時点ではライセンス未設定です。

公開・再利用・改変を想定する場合は、`LICENSE` ファイルを追加し、ベース元リポジトリのライセンス条件も確認してください。
