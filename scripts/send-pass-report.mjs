import fs from "node:fs/promises";
import path from "node:path";
import {
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

function passIdForDate(reportDateYmd, index) {
  return passNo(index);
}

function passLine(row, timeZone, reportDateYmd) {
  const pass = row.pass;
  return `Pass[${passIdForDate(reportDateYmd, row.index)}] ${formatHmInZone(pass.aos, timeZone)} to ${formatHmInZone(pass.los, timeZone)} @ MEL=${pass.maxElDeg.toFixed(1)}[deg.]`;
}


function displayTleText(sat) {
  return `Mono-Nikko(H)\n${sat.line1}\n${sat.line2}`;
}

function buildReportText({ sat, dayStartUtc, reportDateYmd, timeZone, rows, skylineProfile, skylineCsvPath }) {
  const main = [
    ...(boolFromEnv(process.env.PASS_TEST_MODE)

      ? [

          "*※これはテストです*", 

          "*実際の結果とは異なる可能性があります*",

          "",

        ]

      : []),

    "【パス予報】",
    "使用したTLE",
    "```",
    displayTleText(sat),
    "```",
    "",
    "Pass[No] [AOS時刻]to[LOS時刻]@MEL=[MEL][deg.] の形式で書いております",
    "",
    formatMdInZone(dayStartUtc, timeZone),
  ];

  if (rows.length > 0) {
    main.push(...rows.map((row) => passLine(row, timeZone, reportDateYmd)));
  } else {
    main.push("PASSなし");
  }

  main.push("", "レーダーチャート");
  if (rows.length > 0) {
    rows.forEach((row, i) => {
      const color = RADAR_COLORS[i % RADAR_COLORS.length];
      main.push(`${color.name}：Pass[${passIdForDate(reportDateYmd, row.index)}]`);
    });
  } else {
    main.push("表示対象PASSなし");
  }

  return { mainText: main.join("\n") };
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

function rowsForDate({ sat, station, reportDateYmd, timeZone, prediction }) {
  const dayStartUtc = zonedDateStartUtc(reportDateYmd, timeZone);
  const allPasses = predictPasses(sat, station, dayStartUtc, {
    horizon_hours: numberOr(prediction.horizon_hours, 26),
    step_sec: numberOr(prediction.step_sec, 20),
    command_elevation_deg: numberOr(prediction.command_elevation_deg, 5),
  });

  // 26時間予測で深夜またぎLOSを拾いつつ、翌日AOSのPASSは当日レポートに混ぜない。
  const passes = allPasses.filter((pass) => formatYmdInZone(pass.aos, timeZone) === reportDateYmd);

  return {
    dayStartUtc,
    rows: passes.map((pass, index) => ({ pass, index })),
  };
}

function cutRadarRowsToVisibleSegments(rows, radarMinElevationDeg, skylineProfile) {
  const segments = [];
  let current = [];

  for (const point of Array.isArray(rows) ? rows : []) {
    const visible = Number(point.elDeg) > radarMinElevationDeg && isAboveSkyline(point, skylineProfile);
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

async function sendReportForDate({ token, channel, config, sat, skylineProfile, reportDateYmd, forceSend }) {
  const timeZone = config.timezone || "Asia/Tokyo";
  const prediction = config.prediction || {};
  const station = config.station;
  if (!station) throw new Error("config.station is required.");

  const sentMarker = path.join(SENT_DIR, `${reportDateYmd}.json`);
  if (!forceSend && await exists(sentMarker)) {
    return { sent: false, skipped: true, reason: `${reportDateYmd} は送信済み` };
  }

  const { dayStartUtc, rows } = rowsForDate({
    sat,
    station,
    reportDateYmd,
    timeZone,
    prediction,
  });

  const { mainText } = buildReportText({
    sat,
    dayStartUtc,
    reportDateYmd,
    timeZone,
    rows,
    skylineProfile,
    skylineCsvPath: config.skyline?.csv_path,
  });

  const radarStepSec = numberOr(prediction.radar_sample_step_sec, 1);
  const passSeries = rows.map((row, i) => {
    const color = RADAR_COLORS[i % RADAR_COLORS.length];
    return {
      label: `Pass[${passIdForDate(reportDateYmd, row.index)}]`,
      color: color.color,
      rows: sampleRadarPath(sat, station, row.pass, radarStepSec),
    };
  });

  const png = renderRadarPng(passSeries, { width: 900, height: 900, skylineProfile });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const baseName = `pass-radar-${reportDateYmd}`;
  await fs.writeFile(path.join(OUTPUT_DIR, `${baseName}.png`), png);
  await fs.writeFile(path.join(OUTPUT_DIR, `${baseName}.txt`), `${mainText}\n`, "utf8");

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

  await fs.mkdir(SENT_DIR, { recursive: true });
  await fs.writeFile(
    sentMarker,
    `${JSON.stringify({
      date: reportDateYmd,
      sent_at_utc: new Date().toISOString(),
      slack_ts: root.ts,
      pass_count: rows.length,
      reason: "18:00 JST fixed schedule",
    }, null, 2)}\n`,
    "utf8"
  );

  console.log(`Sent PASS report ${reportDateYmd}: pass_count=${rows.length}`);
  return { sent: true, reason: "sent" };
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token) throw new Error("SLACK_BOT_TOKEN is required.");
  if (!channel) throw new Error("SLACK_CHANNEL_ID is required.");

  const config = await readJson(CONFIG_PATH);
  const timeZone = config.timezone || "Asia/Tokyo";
  const now = new Date();
  const reportDateYmd = (process.env.PASS_REPORT_DATE_YMD || "").trim() || formatYmdInZone(now, timeZone);
  const forceSend = boolFromEnv(process.env.PASS_FORCE_SEND);
  const sat = await loadTargetTle(config);
  const skylineProfile = await loadSkylineProfile(config);

  const result = await sendReportForDate({ token, channel, config, sat, skylineProfile, reportDateYmd, forceSend });
  console.log(`${reportDateYmd}: ${result.sent ? "sent" : "not sent"} - ${result.reason}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
