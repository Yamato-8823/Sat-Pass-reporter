import * as satellite from "satellite.js";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

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


function positiveNumberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function refineCrossingTime({
  satrec,
  station,
  prevTime,
  prevEl,
  currTime,
  currEl,
  thresholdDeg,
  wantAbove,
  epsilonSec,
}) {
  const fallback = interpolateCrossing(
    prevTime,
    prevEl,
    currTime,
    currEl,
    thresholdDeg
  );

  let lo = prevTime;
  let hi = currTime;
  let best = currTime;

  while ((hi.getTime() - lo.getTime()) / 1000 > epsilonSec) {
    const mid = new Date((lo.getTime() + hi.getTime()) / 2);
    const look = lookAnglesAt(satrec, station, mid);

    if (!look) return fallback;

    const isAbove = look.elDeg >= thresholdDeg;

    if (isAbove === wantAbove) {
      best = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return best;
}

function refineMaxElevation({
  satrec,
  station,
  aos,
  los,
  coarseBestTime,
  coarseStepSec,
  refineTimeSec,
}) {
  const stepMs = Math.max(
    1,
    Math.round(positiveNumberOr(refineTimeSec, 0.1) * 1000)
  );

  const windowSec = Math.max(5, positiveNumberOr(coarseStepSec, 20) * 1.5);

  const aosMs = aos.getTime();
  const losMs = los.getTime();
  const centerMs = coarseBestTime.getTime();

  const startMs = Math.max(aosMs, centerMs - windowSec * 1000);
  const endMs = Math.min(losMs, centerMs + windowSec * 1000);

  let bestTime = new Date(Math.max(startMs, Math.min(centerMs, endMs)));
  let bestLook = lookAnglesAt(satrec, station, bestTime);

  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const time = new Date(ms);
    const look = lookAnglesAt(satrec, station, time);

    if (look && (!bestLook || look.elDeg > bestLook.elDeg)) {
      bestLook = look;
      bestTime = time;
    }
  }

  for (const ms of [startMs, endMs]) {
    const time = new Date(ms);
    const look = lookAnglesAt(satrec, station, time);

    if (look && (!bestLook || look.elDeg > bestLook.elDeg)) {
      bestLook = look;
      bestTime = time;
    }
  }

  return {
    maxElTime: bestTime,
    maxElDeg: bestLook?.elDeg ?? null,
  };
}

export function predictPasses(tle, station, startUtc, options = {}) {
  const horizonHours = Number(options.horizon_hours ?? 24);

  const coarseStepSec = positiveNumberOr(
    options.coarse_step_sec ?? options.step_sec,
    20
  );

  const refineTimeSec = positiveNumberOr(options.refine_time_sec, 0.1);
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

  for (
    let t = addSeconds(startUtc, coarseStepSec);
    t <= endUtc;
    t = addSeconds(t, coarseStepSec)
  ) {
    const look = lookAnglesAt(satrec, station, t);

    if (!look || !prevLook) {
      prevTime = t;
      prevLook = look;
      continue;
    }

    const wasAbove = prevLook.elDeg >= commandElevationDeg;
    const isAbove = look.elDeg >= commandElevationDeg;

    if (!inPass && !wasAbove && isAbove) {
      const aos = refineCrossingTime({
        satrec,
        station,
        prevTime,
        prevEl: prevLook.elDeg,
        currTime: t,
        currEl: look.elDeg,
        thresholdDeg: commandElevationDeg,
        wantAbove: true,
        epsilonSec: refineTimeSec,
      });

      current = {
        aos,
        los: null,
        maxElDeg: look.elDeg,
        maxElTime: t,
      };

      inPass = true;
    }

    if (inPass && current && look.elDeg > current.maxElDeg) {
      current.maxElDeg = look.elDeg;
      current.maxElTime = t;
    }

    if (inPass && wasAbove && !isAbove) {
      const los = refineCrossingTime({
        satrec,
        station,
        prevTime,
        prevEl: prevLook.elDeg,
        currTime: t,
        currEl: look.elDeg,
        thresholdDeg: commandElevationDeg,
        wantAbove: false,
        epsilonSec: refineTimeSec,
      });

      current.los = los;

      const refinedMax = refineMaxElevation({
        satrec,
        station,
        aos: current.aos,
        los: current.los,
        coarseBestTime: current.maxElTime,
        coarseStepSec,
        refineTimeSec,
      });

      if (refinedMax.maxElDeg !== null) {
        current.maxElDeg = refinedMax.maxElDeg;
        current.maxElTime = refinedMax.maxElTime;
      }

      passes.push(current);
      current = null;
      inPass = false;
    }

    prevTime = t;
    prevLook = look;
  }

  if (inPass && current) {
    current.los = endUtc;

    const refinedMax = refineMaxElevation({
      satrec,
      station,
      aos: current.aos,
      los: current.los,
      coarseBestTime: current.maxElTime,
      coarseStepSec,
      refineTimeSec,
    });

    if (refinedMax.maxElDeg !== null) {
      current.maxElDeg = refinedMax.maxElDeg;
      current.maxElTime = refinedMax.maxElTime;
    }

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
