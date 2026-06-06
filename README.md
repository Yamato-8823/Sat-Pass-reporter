# Sat-Pass Reporter

Sat-Pass Reporter は、人工衛星の可視パスを自動計算し、運用可否・使用TLE・レーダーチャートを Slack に通知するための GitHub Actions ベースの運用支援ツールです。

現在の設定では、**Mono-Nikko(H)** の TLE を CelesTrak から取得し、**Teikyo GS** から見える当日分のパスを計算します。
毎日 **18:00 JST** に GitHub Actions が実行され、Slack にパス予報とレーダーチャート画像を投稿します。

---

## Overview

このリポジトリでは、以下を自動化します。

```text
TLE取得
↓
当日PASS計算
↓
運用 / 非運用 判定
↓
スカイラインCSV反映
↓
レーダーチャートPNG生成
↓
Slack投稿
```

Slack本文には、使用したTLEと各PASSの AOS / LOS / MEL / 運用可否を出力します。
レーダーチャートには、運用PASSのみを描画し、非運用部分やスカイライン以下の遮蔽部分は表示しません。

---

## Features

* CelesTrak から最新 TLE を取得
* TLE は JST 基準で 1 日 1 回だけ更新
* Teikyo GS から見える当日分のPASSを計算
* AOS / LOS / MEL を Slack に投稿
* MELしきい値により `[運用]` / `[非運用]` を自動判定
* 使用したTLEを Slack 本文に表示
* レーダーチャート PNG を自動生成して Slack に添付
* 非運用PASSはレーダーチャートから除外
* 運用PASSでも、しきい値以下の低仰角部分はレーダーチャートからカット
* スカイラインCSVを読み込み、遮蔽領域をレーダーチャートへ反映
* 送信済みマーカーにより、同じ日の二重送信を防止
* GitHub Actions だけでオンライン運用可能

---

## Current Configuration

現在の主な設定は以下です。

```yaml
timezone: Asia/Tokyo
min_elevation_deg: 0.0
command_elevation_deg: 5.0

ground_stations:
  - id: Teikyo_Utsunomiya
    name: Teikyo GS
    latitude_dms: "36°36'18\"N"
    longitude_dms: "139°52'54\"E"
    altitude_m: 180
    min_elevation_deg: 0.0

tle_sources: |
  Mono-Nikko(H)@https://celestrak.org/NORAD/elements/gp.php?CATNR=68799&FORMAT=TLE
```

---

## Slack Output Format

Slack には以下のような形式で投稿されます。

```text
【パス予報】
判定基準: MEL <= 0.0[deg.] は [非運用]
レーダーチャート: 非運用PASS、N度以下の低仰角部分、スカイライン以下の部分はカット
スカイライン: config/skyline-teikyo.csv
送信判定: 18:00 JST 定時送信

使用したTLE
```

```text
Mono-Nikko(H)
1 68799U ...
2 68799 ...
```

```text
6/6
Pass[0606-01] 01:23to01:34@MEL=8.2[deg.] [運用]
Pass[0606-02] 03:01to03:12@MEL=44.6[deg.] [運用]
Pass[0606-03] 14:28to14:39@MEL=-1.5[deg.] [非運用]

レーダーチャート
水色：Pass[0606-01]
黄緑：Pass[0606-02]
```

`Pass[0606-01]` は、`MMDD-その日の通番` を表します。

例:

```text
0606-01 = 6月6日の1本目のPASS
0606-02 = 6月6日の2本目のPASS
```

---

## Operation Rule

運用判定は `operation_min_elevation_deg` によって決まります。

```text
MEL <= N度 : [非運用]
MEL >  N度 : [運用]
```

現在の設定では以下の通りです。

```json
"operation_min_elevation_deg": 10.0
```

そのため、MEL が 10.0 度を超えるPASSは `[運用]` と判定されます。

---

## Pass Detection Rule

PASS検出には `command_elevation_deg` を使用します。

```json
"command_elevation_deg": 10.0
```

この設定では、仰角5度以上の区間を通信コマンド対象のPASSとして検出します。

---

## Ground Station Configuration

現在の地上局設定は Teikyo GS です。

```yaml
ground_stations:
  - id: Teikyo_Utsunomiya
    name: Teikyo GS
    latitude_dms: "36°36'18\"N"
    longitude_dms: "139°52'54\"E"
    altitude_m: 180
    min_elevation_deg: 0.0
```

内部では以下の10進度へ変換して使用します。

```text
latitude_deg  = 36.605
longitude_deg = 139.88166666666666
altitude_m    = 180
```

設定ファイルは以下です。

```text
config/slack-pass-report.json
```

---

## TLE Source

現在の TLE 取得元は CelesTrak です。

```text
Mono-Nikko(H)@https://celestrak.org/NORAD/elements/gp.php?CATNR=68799&FORMAT=TLE
```

設定ファイルは以下です。

```text
data/tle-sources.json
```

TLE は GitHub Actions 実行時に確認され、JST 基準で 1 日 1 回だけ更新されます。
更新された TLE は以下に保存されます。

```text
public/tle/mono-nikko-h.tle
public/tle/manifest.json
```

---

## Skyline CSV

レーダーチャートには、スカイラインCSVを反映できます。

設定ファイル:

```text
config/skyline-teikyo.csv
```

CSV形式:

```csv
azimuth_deg,elevation_deg
0,5
45,12
90,8
135,3
180,0
225,4
270,10
315,7
360,5
```

方位角の定義は以下です。

```text
0   = 北
90  = 東
180 = 南
270 = 西
360 = 北
```

`azimuth_deg` は方位角、`elevation_deg` はその方位における遮蔽角です。

スカイラインCSVは、方位角ごとの地形・建物・アンテナ周辺環境による遮蔽角を表します。
レーダーチャートでは、スカイライン以下の領域を薄く表示し、衛星軌跡のうちスカイライン以下の部分は描画しません。

---

## Radar Chart Rule

レーダーチャートには以下のみを描画します。

```text
[運用] 判定のPASS
かつ
operation_min_elevation_deg より高い部分
かつ
スカイラインより高い部分
```

つまり、以下は描画されません。

```text
[非運用] PASS
N度以下の低仰角部分
スカイライン以下の遮蔽部分
```

これにより、Slackに添付されるレーダーチャートは、実際に運用対象となる可視区間だけを強調した表示になります。

---

## Schedule

GitHub Actions により、毎日 **18:00 JST** に Slack へ送信します。

GitHub Actions の cron は UTC 基準なので、18:00 JST は 09:00 UTC です。

```yaml
schedule:
  - cron: "0 9 * * *"
```

対象ワークフロー:

```text
.github/workflows/pass-slack-report.yml
```

---

## Required GitHub Secrets

Slack送信には GitHub Secrets が必要です。

GitHub のリポジトリ画面で以下を設定してください。

```text
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
```

必要な secret:

```text
SLACK_BOT_TOKEN
SLACK_CHANNEL_ID
```

Slack Bot Token には最低限以下の権限が必要です。

```text
chat:write
files:write
```

Slack token は絶対にリポジトリへ commit しないでください。

---

## Setup

依存関係をインストールします。

```bash
npm install
```

構文チェック:

```bash
npm run check
```

TLE更新テスト:

```bash
npm run update-tle
```

Slack送信テスト:

```bash
npm run send-pass-report
```

Slack送信テストを行う場合は、環境変数が必要です。

```bash
SLACK_BOT_TOKEN=xoxb-... \
SLACK_CHANNEL_ID=CXXXXXXXXXX \
npm run send-pass-report
```

---

## Manual Workflow Run

GitHub Actions から手動実行できます。

```text
Actions
→ PASS Slack Report 18 JST
→ Run workflow
```

入力項目:

```text
operation_min_elevation_deg
  MEL判定しきい値

date_ymd
  対象日。空なら今日

force_send
  true にすると送信済みマーカーがあっても再送
```

---

## Generated Files

実行時に以下のファイルが生成されます。

```text
public/tle/
  最新TLEとmanifest

reports/tle-updated/
  TLE更新確認済みマーカー

reports/sent/
  Slack送信済みマーカー

output/slack-pass-report/
  生成したSlack本文とレーダーチャートPNG
```

`reports/sent/YYYY-MM-DD.json` が存在する日は、通常再送されません。

---

## Directory Structure

```text
.
├── .github/
│   └── workflows/
│       └── pass-slack-report.yml
├── config/
│   ├── slack-pass-report.json
│   └── skyline-teikyo.csv
├── data/
│   └── tle-sources.json
├── scripts/
│   ├── update-tle.mjs
│   ├── send-pass-report.mjs
│   └── lib/
│       ├── satpass-core.mjs
│       ├── radar-png.mjs
│       └── slack-client.mjs
├── public/
│   └── tle/
├── reports/
├── output/
├── package.json
├── package-lock.json
└── README.md
```

---

## Original Source / Acknowledgement

本リポジトリは、以下の SatPass Ops Console を参考にしています。

```text
Original repository:
https://github.com/FujimotoShota-toruca/satpass-ops-console
```

SatPass Ops Console は、TLE と地上局情報をもとに衛星の可視パス、方位角・仰角、レーダーチャート等を表示する衛星運用支援アプリです。

本リポジトリでは、その考え方と一部構成を参考にしつつ、GitHub Actions 上での自動実行、TLE更新、Teikyo GS向け設定、スカイラインCSV反映、Slack通知、レーダーチャートPNG生成に特化した構成へ変更しています。

---

## Use of AI / ChatGPT

本リポジトリの設計、実装方針、README、GitHub Actions設定、Slack通知処理、TLE更新処理、レーダーチャート生成処理の一部は、OpenAI ChatGPT の支援を受けて作成しています。

ただし、実運用で使用する設定値、TLE、地上局座標、スカイラインCSV、Slack通知先、運用可否判定は、利用者が確認・管理する前提です。

AI支援により生成されたコードや説明は、実運用前に必ず動作確認を行ってください。

---

## Notes

* このツールは運用支援用です。
* 実運用判断では、TLEの鮮度、地上局条件、スカイライン測定値、通信系条件を必ず確認してください。
* Slack通知は GitHub Actions の実行状況や Slack API の状態に依存します。
* GitHub Actions は混雑状況により数分遅延する場合があります。
* スカイラインCSVの精度が低い場合、レーダーチャート上の可視/遮蔽表現も不正確になります。
* Slack token や channel ID は、必ず GitHub Secrets で管理してください。

---

## License

Private / Internal use.
