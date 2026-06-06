import * as satellite from "satellite.js";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function parseTleBlock(tleText) {
  const lines = String(tleText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const line1Index = lines.findIndex((line) => line.startsWith("1 "));
  const line2Index = lines.findIndex((line) => line.startsWith("2 "));
  if (line1Index < 0 || line2Index < 0 || line2Index <= line1Index) {
    throw new Error("TLE line1/line2 not found.");
  }
  return {
    name: line1Index > 0 ? lines[line1Index - 1] : "UNKNOWN",
    line1: lines[line1Index],
    line2: lines[line2Index],
  };
}

export function tleTextFromSat(sat) {
  return `${sat.name}\n${sat.line1}\n${sat.line2}`;
}

export function tleEpochLabel(line1) {
  return String(line1).slice(18, 32).trim();
}

export function formatYmdInZone(date, timeZone = "Asia/Tokyo") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatMdInZone(date, timeZone = "Asia/Tokyo") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${Number(parts.month)}/${Number(parts.day)}`;
}

export function formatHmInZone(date, timeZone = "Asia/Tokyo") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.hour}:${parts.minute}`;
}

function zonedParts(date, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
}

function offsetMsForTimeZone(utcDate, timeZone) {
  const p = zonedParts(utcDate, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - utcDate.getTime();
}

export function zonedDateStartUtc(ymd, timeZone = "Asia/Tokyo") {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const guessUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offset = offsetMsForTimeZone(guessUtc, timeZone);
  return new Date(guessUtc.getTime() - offset);
}

export function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

export function makeSatrec(tle) {
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  if (!satrec) throw new Error(`Failed to parse TLE for ${tle.name}`);
  return satrec;
}

export function lookAnglesAt(satrec, station, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv.position) return null;

  const gmst = satellite.gstime(date);
  const satEcf = satellite.eciToEcf(pv.position, gmst);
  const observerGd = {
    longitude: Number(station.longitude_deg) * DEG2RAD,
    latitude: Number(station.latitude_deg) * DEG2RAD,
    height: Number(station.altitude_m || 0) / 1000,
  };

  const look = satellite.ecfToLookAngles(observerGd, satEcf);
  return {
    azDeg: ((look.azimuth * RAD2DEG) % 360 + 360) % 360,
    elDeg: look.elevation * RAD2DEG,
    rangeKm: look.rangeSat,
  };
}

function interpolateCrossing(prevTime, prevEl, currTime, currEl, thresholdDeg) {
  const denom = currEl - prevEl;
  if (Math.abs(denom) < 1e-9) return currTime;
  const ratio = Math.max(0, Math.min(1, (thresholdDeg - prevEl) / denom));
  return new Date(prevTime.getTime() + ratio * (currTime.getTime() - prevTime.getTime()));
}

export function predictPasses(tle, station, startUtc, options = {}) {
  const horizonHours = Number(options.horizon_hours ?? 24);
  const stepSec = Number(options.step_sec ?? 20);
  const commandElevationDeg = Number(options.command_elevation_deg ?? 5);
  const satrec = makeSatrec(tle);
  const endUtc = addSeconds(startUtc, horizonHours * 3600);
  const passes = [];

  let prevTime = startUtc;
  let prevLook = lookAnglesAt(satrec, station, prevTime);
  let inPass = prevLook && prevLook.elDeg >= commandElevationDeg;
  let current = inPass
    ? {
        aos: startUtc,
        los: null,
        maxElDeg: prevLook.elDeg,
        maxElTime: prevTime,
      }
    : null;

  for (let t = addSeconds(startUtc, stepSec); t <= endUtc; t = addSeconds(t, stepSec)) {
    const look = lookAnglesAt(satrec, station, t);
    if (!look || !prevLook) {
      prevTime = t;
      prevLook = look;
      continue;
    }

    const wasAbove = prevLook.elDeg >= commandElevationDeg;
    const isAbove = look.elDeg >= commandElevationDeg;

    if (!inPass && !wasAbove && isAbove) {
      const aos = interpolateCrossing(prevTime, prevLook.elDeg, t, look.elDeg, commandElevationDeg);
      current = { aos, los: null, maxElDeg: look.elDeg, maxElTime: t };
      inPass = true;
    }

    if (inPass && current && look.elDeg > current.maxElDeg) {
      current.maxElDeg = look.elDeg;
      current.maxElTime = t;
    }

    if (inPass && wasAbove && !isAbove) {
      const los = interpolateCrossing(prevTime, prevLook.elDeg, t, look.elDeg, commandElevationDeg);
      current.los = los;
      passes.push(current);
      current = null;
      inPass = false;
    }

    prevTime = t;
    prevLook = look;
  }

  if (inPass && current) {
    current.los = endUtc;
    passes.push(current);
  }

  return passes;
}

export function sampleRadarPath(tle, station, pass, stepSec = 20) {
  const satrec = makeSatrec(tle);
  const rows = [];
  const durationSec = Math.max(0, Math.round((pass.los.getTime() - pass.aos.getTime()) / 1000));
  const count = Math.max(1, Math.ceil(durationSec / stepSec));

  for (let i = 0; i <= count; i += 1) {
    const seconds = Math.min(durationSec, i * stepSec);
    const time = addSeconds(pass.aos, seconds);
    const look = lookAnglesAt(satrec, station, time);
    if (look) rows.push({ time, ...look });
  }

  return rows;
}

export function passNo(index) {
  return String(index + 1).padStart(2, "0");
}

export function classifyPass(pass, operationMinElevationDeg) {
  return pass.maxElDeg <= operationMinElevationDeg ? "非運用" : "運用";
}
