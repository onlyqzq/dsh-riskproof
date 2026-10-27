import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DAY = 86_400_000;
const PACKAGE = "dsh-riskproof";
const REPOSITORY = "onlyqzq/dsh-riskproof";
const date = (time) => new Date(time).toISOString().slice(0, 10);

/** npm reports UTC dates. Exclude the incomplete current day in every timezone. */
export function downloadWindows(now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY;
  return [7, 30].map((days) => ({
    days,
    current: { start: date(end - (days - 1) * DAY), end: date(end) },
    previous: { start: date(end - (days * 2 - 1) * DAY), end: date(end - days * DAY) },
  }));
}

/** Missing, duplicate or invalid dates must never become an invented zero. */
export function summarizeDownloads(downloads, window) {
  const total = ({ start, end }) => {
    let count = 0;
    for (let day = Date.parse(start); day <= Date.parse(end); day += DAY) {
      const matches = downloads.filter((entry) => entry?.day === date(day));
      if (matches.length !== 1 || !Number.isSafeInteger(matches[0].downloads) || matches[0].downloads < 0) return null;
      count += matches[0].downloads;
      if (!Number.isSafeInteger(count)) return null;
    }
    return count;
  };
  const current = total(window.current);
  const previous = total(window.previous);
  return {
    ...window,
    current: { ...window.current, downloads: current },
    previous: { ...window.previous, downloads: previous },
    change: current === null || previous === null ? null : current - previous,
    changePercent: current === null || previous === null || previous === 0 ? null
      : Math.round((current - previous) / previous * 10_000) / 100,
  };
}

export function renderSummary(report) {
  const value = (number) => number === null ? "unavailable" : String(number);
  return [
    "# RiskProof public growth snapshot",
    "",
    `Captured: ${report.capturedAt}`,
    "",
    "| Window (UTC, completed days) | Downloads | Previous non-overlapping window | Downloads | Change |",
    "| --- | ---: | --- | ---: | ---: |",
    ...report.downloads.map((entry) => `| ${entry.current.start} – ${entry.current.end} | ${value(entry.current.downloads)} | ${entry.previous.start} – ${entry.previous.end} | ${value(entry.previous.downloads)} | ${entry.changePercent === null ? "unavailable" : `${entry.changePercent}%`} |`),
    "",
    `GitHub stars: ${value(report.github?.stars ?? null)} · Forks: ${value(report.github?.forks ?? null)}`,
    "",
    "Downloads include CI, reinstalls and demo trials; they are not unique users or installation conversion. Weekly 30-day snapshots overlap. This report makes no growth attribution.",
    "",
    ...report.errors.map((error) => `- ${error}`),
    "",
    ...Object.entries(report.sources).map(([name, url]) => `- [${name}](${url})`),
    "",
  ].join("\n");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "riskproof-public-metrics" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Public API unavailable");
  return response.json();
}

export async function collectMetrics(now = new Date(), fetcher = fetchJson) {
  const windows = downloadWindows(now);
  const sources = {
    npm: `https://api.npmjs.org/downloads/range/${windows[1].previous.start}:${windows[1].current.end}/${PACKAGE}`,
    github: `https://api.github.com/repos/${REPOSITORY}`,
  };
  const [npm, github] = await Promise.allSettled([fetcher(sources.npm), fetcher(sources.github)]);
  const errors = [];
  const entries = npm.status === "fulfilled" && npm.value?.package === PACKAGE && Array.isArray(npm.value.downloads)
    ? npm.value.downloads : [];
  const downloads = windows.map((window) => summarizeDownloads(entries, window));
  if (downloads.some((entry) => entry.current.downloads === null || entry.previous.downloads === null)) {
    errors.push("npm data is unavailable or incomplete; affected totals are null.");
  }
  const validCount = (number) => Number.isSafeInteger(number) && number >= 0;
  const repo = github.status === "fulfilled" && github.value?.full_name === REPOSITORY
    && validCount(github.value.stargazers_count) && validCount(github.value.forks_count)
    ? { stars: github.value.stargazers_count, forks: github.value.forks_count } : null;
  if (!repo) errors.push("GitHub public repository counts are unavailable.");
  return {
    schemaVersion: 1, package: PACKAGE, repository: REPOSITORY,
    capturedAt: now.toISOString(), sources, downloads, github: repo, errors,
    limitations: ["Downloads are not unique users or conversion.", "CI, reinstalls and demo trials contribute to downloads.", "Weekly 30-day snapshots overlap; no causal attribution."],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const paths = {};
  while (args.length) {
    const flag = args.shift();
    if (!["--output", "--summary"].includes(flag) || !args.length || args[0].startsWith("--") || paths[flag]) {
      console.error("Usage: node scripts/growth-metrics.mjs [--output file.json] [--summary file.md]");
      process.exitCode = 2;
      return;
    }
    paths[flag] = args.shift();
  }
  const report = await collectMetrics();
  const json = JSON.stringify(report, null, 2) + "\n";
  for (const [flag, path] of Object.entries(paths)) {
    await mkdir(dirname(resolve(path)), { recursive: true });
    await writeFile(path, flag === "--summary" ? renderSummary(report) : json);
  }
  process.stdout.write(json);
  if (report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
