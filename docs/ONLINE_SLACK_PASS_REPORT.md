# Online Slack PASS Report

この追加パッチは、GitHub Actions だけで以下を実行します。

1. 毎日18:00 JSTに起動
2. TLEをJSTで1日1回だけ確認・更新
3. 当日分のPASSを計算
4. `MEL <= N度` を非運用、`MEL > N度` を運用として分類。今回の既定Nは `0.0 deg`
5. Slackへ本文とレーダーチャートPNGを送信
6. 送信済みマーカー `reports/sent/YYYY-MM-DD.json` を保存し、同じ日を二重送信しない


## 適用済み運用設定

今回のパッチでは以下を適用済みです。

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

DMSは計算用に `latitude_deg=36.605`、`longitude_deg=139.88166666666666` へ変換しています。

## Slack出力形式

本文には使用したTLEと、その日の全PASSを以下の形式で出します。

```text
【パス予報】
判定基準: MEL <= 0.0[deg.] は [非運用]
レーダーチャート: 非運用PASSおよびN度以下の低仰角部分はカット
送信判定: 18:00 JST 定時送信

使用したTLE
```
```text
MONO-NIKKO(H)
1 68799U ...
2 68799 ...
```
```text
6/6
Pass[0606-01] 01:23to01:34@MEL=8.2[deg.] [非運用]
Pass[0606-02] 03:01to03:12@MEL=44.6[deg.] [運用]
Pass[0606-03] 14:28to14:39@MEL=11.5[deg.] [運用]

レーダーチャート
水色：Pass[0606-02]
黄緑：Pass[0606-03]
```

`Pass[0606-02]` は `MMDD-その日の通番` です。

## レーダーチャート

レーダーチャートには、`[運用]` 判定のPASSだけを描画します。
`[非運用]` 判定のPASSは描画しません。

さらに、`[運用]` PASSであっても `N度以下` の低仰角部分はカットします。
例えば `N=10.0` の場合、レーダーチャートには `elDeg > 10.0` の区間だけを描画します。

## 送信タイミング

既定では毎日18:00 JSTに送信します。
GitHub ActionsのcronはUTC基準なので、18:00 JSTは09:00 UTCです。

```yaml
schedule:
  - cron: "0 9 * * *"
```

## 設定

`config/slack-pass-report.json` の主な設定:

```json
{
  "timezone": "Asia/Tokyo",
  "min_elevation_deg": 0.0,
  "station": {
    "id": "Teikyo_Utsunomiya",
    "name": "Teikyo GS",
    "latitude_dms": "36°36'18\"N",
    "longitude_dms": "139°52'54\"E",
    "latitude_deg": 36.605,
    "longitude_deg": 139.88166666666666,
    "altitude_m": 180,
    "min_elevation_deg": 0.0
  },
  "prediction": {
    "command_elevation_deg": 5.0,
    "operation_min_elevation_deg": 0.0
  },
  "reporting": {
    "send_mode": "fixed_time",
    "fixed_send_time": "18:00",
    "date_selection": "today_when_not_specified"
  }
}
```

## GitHub Secrets

Repository Settings → Secrets and variables → Actions に以下を登録してください。

- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`

Slack Bot Token Scopes:

- `chat:write`
- `files:write`

## 手動実行

Actionsタブから `PASS Slack Report 18 JST` を選び、`Run workflow` で実行できます。

- `date_ymd`: 対象日。空なら「今日」です。
- `operation_min_elevation_deg`: 非運用判定しきい値。
- `force_send`: `true` にすると送信済みマーカーがあっても再送します。

## 注意

18:00時点でまだ当日の運用可能PASSが残っている場合でも、18:00の定時送信が優先されます。
その日の最終LOS後に自動送信したい場合は、after-LOS版のワークフローに戻してください。


## スカイラインCSV

`config/slack-pass-report.json` の `skyline.csv_path` に指定したCSVを読み、Slackへ添付するレーダーチャートに反映します。

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

- `azimuth_deg` は方位角です。0=N、90=E、180=S、270=Wです。
- `elevation_deg` はその方位の遮蔽角です。
- CSVは360度をまたいで線形補間します。
- レーダーチャートではスカイライン以下の領域を薄く塗り、衛星軌跡もスカイライン以下の部分をカットします。
- PASS本文の `[運用/非運用]` 判定は従来どおり `operation_min_elevation_deg` のMEL基準です。
