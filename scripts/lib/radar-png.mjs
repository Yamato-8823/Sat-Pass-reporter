import zlib from "node:zlib";

const DEFAULT_COLORS = ["#38bdf8", "#a3e635", "#f472b6", "#fb923c", "#a78bfa", "#fb7185"];

const FONT = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  "0": ["111", "101", "101", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "010", "010", "111"],
  "2": ["111", "001", "001", "111", "100", "100", "111"],
  "3": ["111", "001", "001", "111", "001", "001", "111"],
  "4": ["101", "101", "101", "111", "001", "001", "001"],
  "5": ["111", "100", "100", "111", "001", "001", "111"],
  "6": ["111", "100", "100", "111", "101", "101", "111"],
  "7": ["111", "001", "001", "010", "010", "010", "010"],
  "8": ["111", "101", "101", "111", "101", "101", "111"],
  "9": ["111", "101", "101", "111", "001", "001", "111"],
  "A": ["010", "101", "101", "111", "101", "101", "101"],
  "C": ["111", "100", "100", "100", "100", "100", "111"],
  "D": ["110", "101", "101", "101", "101", "101", "110"],
  "E": ["111", "100", "100", "111", "100", "100", "111"],
  "H": ["101", "101", "101", "111", "101", "101", "101"],
  "I": ["111", "010", "010", "010", "010", "010", "111"],
  "L": ["100", "100", "100", "100", "100", "100", "111"],
  "M": ["101", "111", "111", "101", "101", "101", "101"],
  "N": ["101", "111", "111", "111", "101", "101", "101"],
  "O": ["111", "101", "101", "101", "101", "101", "111"],
  "P": ["111", "101", "101", "111", "100", "100", "100"],
  "R": ["110", "101", "101", "110", "101", "101", "101"],
  "S": ["111", "100", "100", "111", "001", "001", "111"],
  "T": ["111", "010", "010", "010", "010", "010", "010"],
  "W": ["101", "101", "101", "101", "111", "111", "101"],
  "[": ["110", "100", "100", "100", "100", "100", "110"],
  "]": ["011", "001", "001", "001", "001", "001", "011"],
  ":": ["000", "010", "000", "000", "010", "000", "000"],
  ".": ["000", "000", "000", "000", "000", "110", "110"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
};

function parseHex(hex) {
  const text = String(hex || "#ffffff").replace("#", "").trim();
  const full = text.length === 3 ? text.split("").map((c) => c + c).join("") : text;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function makeCanvas(width, height, bg = "#020617") {
  const pixels = Buffer.alloc(width * height * 4);
  const [r, g, b] = parseHex(bg);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
  return { width, height, pixels };
}

function setPixel(canvas, x, y, color, alpha = 1) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= canvas.width || yi >= canvas.height) return;
  const offset = (yi * canvas.width + xi) * 4;
  const inv = 1 - alpha;
  canvas.pixels[offset] = Math.round(color[0] * alpha + canvas.pixels[offset] * inv);
  canvas.pixels[offset + 1] = Math.round(color[1] * alpha + canvas.pixels[offset + 1] * inv);
  canvas.pixels[offset + 2] = Math.round(color[2] * alpha + canvas.pixels[offset + 2] * inv);
  canvas.pixels[offset + 3] = 255;
}

function drawDisc(canvas, x, y, radius, color, alpha = 1) {
  const r2 = radius * radius;
  for (let yy = Math.floor(y - radius); yy <= Math.ceil(y + radius); yy += 1) {
    for (let xx = Math.floor(x - radius); xx <= Math.ceil(x + radius); xx += 1) {
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy <= r2) setPixel(canvas, xx, yy, color, alpha);
    }
  }
}

function drawLine(canvas, x0, y0, x1, y1, color, thickness = 2, alpha = 1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    drawDisc(canvas, x0 + dx * t, y0 + dy * t, thickness / 2, color, alpha);
  }
}

function drawCircleOutline(canvas, cx, cy, radius, color, thickness = 2, alpha = 1) {
  const steps = Math.max(96, Math.ceil(radius * 4));
  let px = cx + radius;
  let py = cy;
  for (let i = 1; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    drawLine(canvas, px, py, x, y, color, thickness, alpha);
    px = x;
    py = y;
  }
}

function drawText(canvas, text, x, y, color, scale = 3, alpha = 1) {
  let cursor = x;
  for (const raw of String(text).toUpperCase()) {
    const glyph = FONT[raw] || FONT[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] === "1") {
          for (let yy = 0; yy < scale; yy += 1) {
            for (let xx = 0; xx < scale; xx += 1) {
              setPixel(canvas, cursor + col * scale + xx, y + row * scale + yy, color, alpha);
            }
          }
        }
      }
    }
    cursor += 4 * scale;
  }
}

function azElToXY(azDeg, elDeg, cx, cy, radius) {
  const az = (Number(azDeg) * Math.PI) / 180;
  const r = ((90 - Math.max(0, Math.min(90, Number(elDeg)))) / 90) * radius;
  return {
    x: cx + Math.sin(az) * r,
    y: cy - Math.cos(az) * r,
  };
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(canvas) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scanlineLength = canvas.width * 4 + 1;
  const raw = Buffer.alloc(scanlineLength * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * scanlineLength] = 0;
    canvas.pixels.copy(raw, y * scanlineLength + 1, y * canvas.width * 4, (y + 1) * canvas.width * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}


export function parseSkylineCsv(csvText) {
  const rawLines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (rawLines.length === 0) return [];

  const split = (line) => line.split(/[,\t;]/).map((cell) => cell.trim());
  const first = split(rawLines[0]);
  const hasHeader = first.some((cell) => /[a-zA-Z_方位仰角高度]/.test(cell));

  let azIndex = 0;
  let elIndex = 1;
  let dataLines = rawLines;

  if (hasHeader) {
    const headers = first.map((cell) => cell.toLowerCase());
    const findIndex = (patterns, fallback) => {
      const idx = headers.findIndex((header) => patterns.some((pattern) => header.includes(pattern)));
      return idx >= 0 ? idx : fallback;
    };
    azIndex = findIndex(["azimuth", "az_deg", "az", "方位"], 0);
    elIndex = findIndex(["elevation", "el_deg", "altitude", "alt", "el", "仰角", "角度"], 1);
    dataLines = rawLines.slice(1);
  }

  const points = [];
  for (const line of dataLines) {
    const cells = split(line);
    const az = Number(cells[azIndex]);
    const el = Number(cells[elIndex]);
    if (!Number.isFinite(az) || !Number.isFinite(el)) continue;
    points.push({
      azDeg: ((az % 360) + 360) % 360,
      elDeg: Math.max(0, Math.min(90, el)),
    });
  }

  const byAz = new Map();
  for (const point of points) byAz.set(Number(point.azDeg.toFixed(6)), point.elDeg);
  return [...byAz.entries()]
    .map(([azDeg, elDeg]) => ({ azDeg: Number(azDeg), elDeg }))
    .sort((a, b) => a.azDeg - b.azDeg);
}

export function skylineElevationAt(profile, azDeg) {
  if (!Array.isArray(profile) || profile.length === 0) return 0;
  if (profile.length === 1) return Number(profile[0].elDeg) || 0;

  const az = ((Number(azDeg) % 360) + 360) % 360;
  const points = profile
    .map((point) => ({
      azDeg: ((Number(point.azDeg) % 360) + 360) % 360,
      elDeg: Math.max(0, Math.min(90, Number(point.elDeg) || 0)),
    }))
    .sort((a, b) => a.azDeg - b.azDeg);

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (az >= a.azDeg && az <= b.azDeg) {
      const ratio = (az - a.azDeg) / Math.max(1e-9, b.azDeg - a.azDeg);
      return a.elDeg + (b.elDeg - a.elDeg) * ratio;
    }
  }

  const last = points[points.length - 1];
  const first = { azDeg: points[0].azDeg + 360, elDeg: points[0].elDeg };
  const azWrapped = az < points[0].azDeg ? az + 360 : az;
  const ratio = (azWrapped - last.azDeg) / Math.max(1e-9, first.azDeg - last.azDeg);
  return last.elDeg + (first.elDeg - last.elDeg) * ratio;
}

export function isAboveSkyline(point, profile, marginDeg = 0) {
  if (!Array.isArray(profile) || profile.length === 0) return true;
  return Number(point.elDeg) > skylineElevationAt(profile, point.azDeg) + Number(marginDeg || 0);
}

function drawSkylineProfile(canvas, profile, cx, cy, radius) {
  if (!Array.isArray(profile) || profile.length === 0) return;
  const maskColor = parseHex("#475569");
  const lineColor = parseHex("#facc15");

  for (let az = 0; az < 360; az += 2) {
    const el = skylineElevationAt(profile, az);
    const boundary = azElToXY(az, el, cx, cy, radius);
    const edge = azElToXY(az, 0, cx, cy, radius);
    drawLine(canvas, boundary.x, boundary.y, edge.x, edge.y, maskColor, 2, 0.22);
  }

  let prev = null;
  for (let az = 0; az <= 360; az += 2) {
    const el = skylineElevationAt(profile, az);
    const curr = azElToXY(az, el, cx, cy, radius);
    if (prev) drawLine(canvas, prev.x, prev.y, curr.x, curr.y, lineColor, 4, 0.95);
    prev = curr;
  }
}

export function renderRadarPng(passSeries, options = {}) {
  const width = Number(options.width || 900);
  const height = Number(options.height || 900);
  const canvas = makeCanvas(width, height, "#020617");
  const cx = width / 2;
  const cy = height / 2 + 10;
  const radius = Math.min(width, height) * 0.39;
  const grid = parseHex("#334155");
  const label = parseHex("#cbd5e1");
  const white = parseHex("#f8fafc");

  drawText(canvas, "RADAR CHART", 34, 32, white, 4, 0.9);

  for (const factor of [1 / 3, 2 / 3, 1]) {
    drawCircleOutline(canvas, cx, cy, radius * factor, grid, 2, 0.8);
  }
  drawDisc(canvas, cx, cy, 5, grid, 0.9);

  for (let az = 0; az < 360; az += 45) {
    const p = azElToXY(az, 0, cx, cy, radius);
    drawLine(canvas, cx, cy, p.x, p.y, grid, 2, 0.55);
  }

  drawText(canvas, "N", cx - 8, cy - radius - 34, label, 5, 1);
  drawText(canvas, "E", cx + radius + 18, cy - 12, label, 5, 1);
  drawText(canvas, "S", cx - 8, cy + radius + 14, label, 5, 1);
  drawText(canvas, "W", cx - radius - 42, cy - 12, label, 5, 1);

  drawSkylineProfile(canvas, options.skylineProfile || [], cx, cy, radius);

  passSeries.forEach((series, i) => {
    const color = parseHex(series.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
    const rows = Array.isArray(series.rows) ? series.rows : [];
    for (let j = 1; j < rows.length; j += 1) {
      const a = azElToXY(rows[j - 1].azDeg, rows[j - 1].elDeg, cx, cy, radius);
      const b = azElToXY(rows[j].azDeg, rows[j].elDeg, cx, cy, radius);
      drawLine(canvas, a.x, a.y, b.x, b.y, color, 5, 0.96);
    }
    if (rows.length > 0) {
      const first = azElToXY(rows[0].azDeg, rows[0].elDeg, cx, cy, radius);
      const last = azElToXY(rows[rows.length - 1].azDeg, rows[rows.length - 1].elDeg, cx, cy, radius);
      drawDisc(canvas, first.x, first.y, 9, color, 1);
      drawDisc(canvas, last.x, last.y, 9, color, 1);
    }
  });

  return encodePng(canvas);
}

export const RADAR_COLORS = [
  { name: "水色", color: "#38bdf8" },
  { name: "黄緑", color: "#a3e635" },
  { name: "桃色", color: "#f472b6" },
  { name: "橙色", color: "#fb923c" },
  { name: "紫色", color: "#a78bfa" },
  { name: "赤色", color: "#fb7185" },
];
