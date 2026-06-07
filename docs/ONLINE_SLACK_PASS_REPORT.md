# Online Slack PASS Report

- 18:00 JSTにGitHub ActionsからSlackへ投稿します。
- Slack本文では全PASSを表示します。
- PASS行は `Pass[No] [AOS時刻]to[LOS時刻]@MEL=[MEL][deg.]` の形式です。
- `[運用]` / `[非運用]` 表記は出しません。
- RadarChartには全PASS軌道を表示します。
- スカイラインCSVが有効な場合、スカイライン以下の軌跡はカットします。
