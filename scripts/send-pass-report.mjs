import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyPass,
  formatHmInZone,
  formatMdInZone,
  formatYmdInZone,
  parseTleBlock,
  passNo,
  predictPasses,
  sampleRadarPath,
  tleTextFromSat,
  zonedDateStartUtc,
} from "./lib/satpass-core.mjs";
import { RADAR_COLORS, isAboveSkyline, parseSkylineCsv, renderRadarPng } from "./lib/radar-png.mjs";
import { postMessage, uploadFileExternal } from "./lib/slack-client.mjs";

const CONFIG_PATH = "config/slack-pass-report.json";
const TLE_SOURCES_PATH = "data/tle-sources.json";
const OUTPUT_DIR = "output/slack-pass-report";
const SENT_DIR = "reports/sent";

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolFromEnv(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function addDaysToYmd(ymd, deltaDays) {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays, 0, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseHmToMinutes(hm) {
  const [h, m] = String(hm || "23:30").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 23 * 60 + 30;
  return h * 60 + m;
}

function localMinutes(date, timeZone) {
  const hm = formatHmInZone(date, timeZone);
  return parseHmToMinutes(hm);
}

function passIdForDate(reportDateYmd, index) {
  const [, month, day] = String(reportDateYmd).split("-");
  return `${month}${day}-${passNo(index)}`;
}

function passLine(row, timeZone, reportDateYmd) {
  const pass = row.pass;
  return `Pass[${passIdForDate(reportDateYmd, row.index)}] ${formatHmInZone(pass.aos, timeZone)}to${formatHmInZone(pass.los, timeZone)}@MEL=${pass.maxElDeg.toFixed(1)}[deg.] [${row.status}]`;
}

function buildReportText({ sat, station, dayStartUtc, reportDateYmd, timeZone, thresholdDeg, rows, operationRows, sendReason, skylineProfile, skylineCsvPath }) {
  const main = [
    "【パス予報】",
    "使用したTLE",
    "```",
    tleTextFromSat(sat),
    "```",
    "",
    formatMdInZone(dayStartUtc, timeZone),
    "Pass[No] [AOS時刻]to[LOS時刻]@MEL=[MEL][deg.] [運用/非運用] の形式で書いております",
  ].filter((line) => line !== null);
  if (rows.length > 0) {
    main.push(...rows.map((row) => passLine(row, timeZone, reportDateYmd)));
  } else {
    main.push("PASSなし");
  }

  main.push("", "レーダーチャート");
  if (operationRows.length > 0) {
    operationRows.slice(0, RADAR_COLORS.length).forEach((row, i) => {
      main.push(`${RADAR_COLORS[i].name}：Pass[${passIdForDate(reportDateYmd, row.index)}]`);
    });
  } else {
    main.push("運用PASSなし");
  }

  return { mainText: main.join("\n"), threadText: "" };
}

async function loadTargetTle(config) {
  const sources = await readJson(TLE_SOURCES_PATH);
  const source = sources.find((item) => item.id === config.satellite_id);
  if (!source) {
    throw new Error(`satellite_id not found in ${TLE_SOURCES_PATH}: ${config.satellite_id}`);
  }
  const tleText = await fs.readFile(source.output, "utf8");
  return parseTleBlock(tleText);
}

async function loadSkylineProfile(config) {
  const skyline = config.skyline || {};
  if (skyline.enabled === false || !skyline.csv_path) {
    return [];
  }

  const csvPath = skyline.csv_path;
  const csvText = await fs.readFile(csvPath, "utf8");
  const profile = parseSkylineCsv(csvText);
  if (profile.length < 2) {
    throw new Error(`skyline CSV has too few valid rows: ${csvPath}`);
  }
  console.log(`Loaded skyline profile: ${csvPath} (${profile.length} points)`);
  return profile;
}

function rowsForDate({ sat, station, reportDateYmd, timeZone, prediction, thresholdDeg }) {
  const dayStartUtc = zonedDateStartUtc(reportDateYmd, timeZone);
  const allPasses = predictPasses(sat, station, dayStartUtc, {
    horizon_hours: numberOr(prediction.horizon_hours, 26),
    step_sec: numberOr(prediction.step_sec, 20),
    command_elevation_deg: numberOr(prediction.command_elevation_deg, 5),
  });

  // 26時間予測にして、深夜またぎLOSを取りこぼさない。
  // 一方で、翌日AOSのパスは当日レポートに混ぜない。
  const passes = allPasses.filter((pass) => formatYmdInZone(pass.aos, timeZone) === reportDateYmd);

  const rows = passes.map((pass, index) => ({
    pass,
    index,
    status: classifyPass(pass, thresholdDeg),
  }));

  return {
    dayStartUtc,
    rows,
    operationRows: rows.filter((row) => row.status === "運用"),
    nonOperationRows: rows.filter((row) => row.status === "非運用"),
  };
}

function evaluateEligibility({ reportDateYmd, now, timeZone, operationRows, reporting, forceSend, skipLosCheck }) {
  if (forceSend) {
    return { eligible: true, sendReason: "手動実行のため強制送信" };
  }

  if (skipLosCheck) {
    return { eligible: true, sendReason: "18:00 JST 定時送信" };
  }

  if (operationRows.length > 0) {
    const lastOperation = operationRows.reduce((latest, row) =>
      row.pass.los.getTime() > latest.pass.los.getTime() ? row : latest
    );
    const delayMinutes = numberOr(reporting.send_after_last_operational_pass_minutes, 0);
    const sendAfter = new Date(lastOperation.pass.los.getTime() + delayMinutes * 60 * 1000);

    if (now.getTime() >= sendAfter.getTime()) {
      const delayText = delayMinutes > 0 ? ` + ${delayMinutes}分` : "";
      return {
        eligible: true,
        sendReason: `最終運用PASS ${formatHmInZone(lastOperation.pass.los, timeZone)} LOS${delayText} 後`,
      };
    }

    return {
      eligible: false,
      reason: `まだ最終運用PASS LOS前: send_after=${sendAfter.toISOString()}`,
    };
  }

  const policy = reporting.no_operational_pass_policy || "send_fixed_time";
  if (policy === "send_never") {
    return { eligible: false, reason: "運用可能PASSなし、かつ no_operational_pass_policy=send_never" };
  }

  const todayYmd = formatYmdInZone(now, timeZone);
  if (reportDateYmd < todayYmd) {
    return { eligible: true, sendReason: "対象日が過去日のため、運用PASSなしレポートを送信" };
  }

  const sendTime = reporting.no_operational_pass_send_time || "23:30";
  if (localMinutes(now, timeZone) >= parseHmToMinutes(sendTime)) {
    return { eligible: true, sendReason: `運用可能PASSなし、${sendTime}以降` };
  }

  return { eligible: false, reason: `運用可能PASSなし、${sendTime}前` };
}

function cutRadarRowsToVisibleSegments(rows, thresholdDeg, skylineProfile) {
  // レーダーチャートは「非運用時の部分」を描かない。
  // N度以下、およびスカイラインCSVで遮蔽される仰角以下のサンプル点を落とす。
  const segments = [];
  let current = [];

  for (const point of Array.isArray(rows) ? rows : []) {
    const visible = Number(point.elDeg) > thresholdDeg && isAboveSkyline(point, skylineProfile);
    if (visible) {
      current.push(point);
    } else if (current.length > 0) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

async function sendReportForDate({ token, channel, config, sat, skylineProfile, reportDateYmd, now, forceSend }) {
  const timeZone = config.timezone || "Asia/Tokyo";
  const prediction = config.prediction || {};
  const reporting = config.reporting || {};
  const thresholdDeg = numberOr(
    process.env.PASS_OPERATION_MIN_ELEVATION_DEG,
    numberOr(prediction.operation_min_elevation_deg, 10)
  );
  const station = config.station;
  if (!station) throw new Error("config.station is required.");

  const sentMarker = path.join(SENT_DIR, `${reportDateYmd}.json`);
  if (!forceSend && await exists(sentMarker)) {
    return { sent: false, skipped: true, reason: `${reportDateYmd} は送信済み` };
  }

  const { dayStartUtc, rows, operationRows, nonOperationRows } = rowsForDate({
    sat,
    station,
    reportDateYmd,
    timeZone,
    prediction,
    thresholdDeg,
  });

  const eligibility = evaluateEligibility({
    reportDateYmd,
    now,
    timeZone,
    operationRows,
    reporting,
    forceSend,
    skipLosCheck: boolFromEnv(process.env.PASS_SKIP_LOS_CHECK),
  });

  if (!eligibility.eligible) {
    return { sent: false, skipped: false, reason: eligibility.reason };
  }

  const { mainText, threadText } = buildReportText({
    sat,
    station,
    dayStartUtc,
    reportDateYmd,
    timeZone,
    thresholdDeg,
    rows,
    operationRows,
    sendReason: eligibility.sendReason,
    skylineProfile,
    skylineCsvPath: config.skyline?.csv_path,
  });

  const radarStepSec = numberOr(prediction.radar_sample_step_sec, 20);
  const passSeries = operationRows
    .slice(0, RADAR_COLORS.length)
    .flatMap((row, i) => {
      const segments = cutRadarRowsToVisibleSegments(
        sampleRadarPath(sat, station, row.pass, radarStepSec),
        thresholdDeg,
        skylineProfile
      );
      return segments.map((segmentRows, segmentIndex) => ({
        label: `Pass[${passIdForDate(reportDateYmd, row.index)}]${segmentIndex ? `-${segmentIndex + 1}` : ""}`,
        color: RADAR_COLORS[i].color,
        rows: segmentRows,
      }));
    });

  const png = renderRadarPng(passSeries, { width: 900, height: 900, skylineProfile });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const baseName = `pass-radar-${reportDateYmd}`;
  await fs.writeFile(path.join(OUTPUT_DIR, `${baseName}.png`), png);
  await fs.writeFile(path.join(OUTPUT_DIR, `${baseName}.txt`), `${mainText}\n\n--- thread ---\n${threadText}\n`, "utf8");

  const root = await postMessage({ token, channel, text: mainText });
  await uploadFileExternal({
    token,
    channel,
    threadTs: root.ts,
    buffer: png,
    filename: `${baseName}.png`,
    title: "PASS Radar Chart",
    initialComment: "レーダーチャート",
  });
  if (threadText && threadText.trim()) {
    await postMessage({ token, channel, text: threadText, threadTs: root.ts });
  }

  await fs.mkdir(SENT_DIR, { recursive: true });
  await fs.writeFile(
    sentMarker,
    `${JSON.stringify({
      date: reportDateYmd,
      sent_at_utc: new Date().toISOString(),
      slack_ts: root.ts,
      operation_count: operationRows.length,
      non_operation_count: nonOperationRows.length,
      threshold_deg: thresholdDeg,
      reason: eligibility.sendReason,
    }, null, 2)}\n`,
    "utf8"
  );

  console.log(`Sent PASS report ${reportDateYmd}: operation=${operationRows.length}, non_operation=${nonOperationRows.length}`);
  return { sent: true, reason: eligibility.sendReason };
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token) throw new Error("SLACK_BOT_TOKEN is required.");
  if (!channel) throw new Error("SLACK_CHANNEL_ID is required.");

  const config = await readJson(CONFIG_PATH);
  const timeZone = config.timezone || "Asia/Tokyo";
  const now = new Date();
  const explicitDate = (process.env.PASS_REPORT_DATE_YMD || "").trim();
  const todayYmd = formatYmdInZone(now, timeZone);
  const candidateDates = explicitDate ? [explicitDate] : [addDaysToYmd(todayYmd, -1), todayYmd];
  const forceSend = boolFromEnv(process.env.PASS_FORCE_SEND);
  const sat = await loadTargetTle(config);
  const skylineProfile = await loadSkylineProfile(config);

  for (const reportDateYmd of candidateDates) {
    const result = await sendReportForDate({ token, channel, config, sat, skylineProfile, reportDateYmd, now, forceSend });
    console.log(`${reportDateYmd}: ${result.sent ? "sent" : "not sent"} - ${result.reason}`);
    if (result.sent) return;
  }

  console.log("No eligible PASS report to send in this run.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
