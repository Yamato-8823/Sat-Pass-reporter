import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SOURCES_PATH = "data/tle-sources.json";
const MANIFEST_PATH = "public/tle/manifest.json";

const TLE_FETCH_MAX_ATTEMPTS = 2;
const TLE_FETCH_RETRY_DELAY_MS = 30_000;

const RETRYABLE_NETWORK_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
]);

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

  const name =
    fallbackName ||
    (line1Index > 0 ? lines[line1Index - 1].trim() : "UNKNOWN");

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
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNetworkErrorCode(error) {
  return error?.cause?.code || error?.code || "";
}

function isRetryableNetworkError(error) {
  const code = getNetworkErrorCode(error);
  return RETRYABLE_NETWORK_CODES.has(code);
}

async function fetchTle(source) {
  for (let attempt = 1; attempt <= TLE_FETCH_MAX_ATTEMPTS; attempt++) {
    console.log(
      `Fetching TLE: ${source.id} attempt=${attempt}/${TLE_FETCH_MAX_ATTEMPTS}`
    );

    let response;

    try {
      response = await fetch(source.url, {
        headers: {
          "User-Agent": "sat-pass-reporter/1.0 (+GitHub Actions)",
        },
        redirect: "follow",
      });
    } catch (error) {
      const code = getNetworkErrorCode(error);
      const retryable = isRetryableNetworkError(error);

      console.error(
        `${source.id}: network fetch failed` +
          ` attempt=${attempt}/${TLE_FETCH_MAX_ATTEMPTS}` +
          `${code ? ` code=${code}` : ""}`
      );

      if (!retryable) {
        throw new Error(
          `${source.id}: non-retryable TLE network error` +
            `${code ? ` (${code})` : ""}`,
          { cause: error }
        );
      }

      if (attempt >= TLE_FETCH_MAX_ATTEMPTS) {
        throw new Error(
          `${source.id}: TLE network fetch failed after ${attempt} attempt(s)` +
            `${code ? ` (${code})` : ""}`,
          { cause: error }
        );
      }

      console.warn(
        `${source.id}: transient network error (${code}). ` +
          `Retrying in ${TLE_FETCH_RETRY_DELAY_MS / 1000}s...`
      );

      await sleep(TLE_FETCH_RETRY_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");

      throw new Error(
        `${source.id}: TLE fetch failed HTTP ${response.status}: ` +
          body.slice(0, 300)
      );
    }

    const text = await response.text();

    return normalizeTle(text, source.name);
  }

  throw new Error(`${source.id}: TLE fetch exhausted unexpectedly.`);
}

async function main() {
  const sources = JSON.parse(
    await fs.readFile(SOURCES_PATH, "utf8")
  );

  const results = [];

  for (const source of sources) {
    const nextTle = await fetchTle(source);
    const currentTle = await readTextIfExists(source.output);

    const nextHash = sha256(nextTle);
    const currentHash = currentTle ? sha256(currentTle) : "";

    const changed = nextHash !== currentHash;

    await fs.mkdir(path.dirname(source.output), {
      recursive: true,
    });

    if (changed) {
      await fs.writeFile(source.output, nextTle, "utf8");
    }

    const [tleName, line1, line2] = nextTle
      .trim()
      .split(/\r?\n/);

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

    console.log(
      `${changed ? "UPDATED" : "UNCHANGED"} ` +
        `${source.id} epoch=${result.epoch}`
    );
  }

  await fs.mkdir(path.dirname(MANIFEST_PATH), {
    recursive: true,
  });

  await fs.writeFile(
    MANIFEST_PATH,
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
