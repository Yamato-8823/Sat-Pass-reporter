import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SOURCES_PATH = "data/tle-sources.json";
const MANIFEST_PATH = "public/tle/manifest.json";

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeTle(text, fallbackName = "UNKNOWN") {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const line1Index = lines.findIndex((line) => line.startsWith("1 "));
  const line2Index = lines.findIndex((line) => line.startsWith("2 "));

  if (line1Index < 0 || line2Index < 0 || line2Index <= line1Index) {
    throw new Error("TLE line1/line2 not found.");
  }

  const name = line1Index > 0 ? lines[line1Index - 1].trim() : fallbackName;
  const line1 = lines[line1Index].trim();
  const line2 = lines[line2Index].trim();

  return `${name}\n${line1}\n${line2}\n`;
}

function tleEpoch(line1) {
  return String(line1).slice(18, 32).trim();
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function fetchTle(source) {
  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "satpass-ops-console/online-tle-updater (+GitHub Actions)",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${source.id}: TLE fetch failed HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  return normalizeTle(await response.text(), source.name);
}

async function main() {
  const sources = JSON.parse(await fs.readFile(SOURCES_PATH, "utf8"));
  const results = [];

  for (const source of sources) {
    const nextTle = await fetchTle(source);
    const currentTle = await readTextIfExists(source.output);

    const nextHash = sha256(nextTle);
    const currentHash = currentTle ? sha256(currentTle) : "";
    const changed = nextHash !== currentHash;

    await fs.mkdir(path.dirname(source.output), { recursive: true });

    if (changed) {
      await fs.writeFile(source.output, nextTle, "utf8");
    }

    const [tleName, line1, line2] = nextTle.trim().split(/\r?\n/);
    const result = {
      id: source.id,
      name: source.name || tleName,
      catnr: source.catnr || null,
      url: source.url,
      output: source.output,
      changed,
      epoch: tleEpoch(line1),
      sha256: nextHash,
      updated_at_utc: new Date().toISOString(),
      line1,
      line2,
    };

    results.push(result);
    console.log(`${changed ? "UPDATED" : "UNCHANGED"} ${source.id} epoch=${result.epoch}`);
  }

  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
