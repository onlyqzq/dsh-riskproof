import { test } from "node:test";
import assert from "node:assert/strict";
import { collectMetrics, downloadWindows, renderSummary, summarizeDownloads } from "../growth-metrics.mjs";

test("completed UTC windows cross year boundaries and do not overlap", () => {
  const windows = downloadWindows(new Date("2026-01-01T00:30:00+08:00"));
  assert.deepEqual(windows[0], {
    days: 7,
    current: { start: "2025-12-24", end: "2025-12-30" },
    previous: { start: "2025-12-17", end: "2025-12-23" },
  });
  assert.equal(windows[1].previous.start, "2025-11-01");
});

const now = new Date("2026-10-27T08:00:00Z");
const entries = Array.from({ length: 60 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 26) - index * 86_400_000).toISOString().slice(0, 10),
  downloads: index < 30 ? 20 : 10,
}));

test("downloads compare equal length windows, retaining true zero and undefined percentage", () => {
  const window = downloadWindows(now)[1];
  const result = summarizeDownloads(entries, window);
  assert.equal(result.current.downloads, 600);
  assert.equal(result.previous.downloads, 300);
  assert.equal(result.change, 300);
  assert.equal(result.changePercent, 100);
  const zeros = summarizeDownloads(entries.map((entry) => ({ ...entry, downloads: 0 })), window);
  assert.equal(zeros.current.downloads, 0);
  assert.equal(zeros.change, 0);
  assert.equal(zeros.changePercent, null);
});

test("missing, duplicate, negative and non-integer days are unknown, never zero", () => {
  const window = downloadWindows(now)[0];
  for (const invalid of [entries.slice(1), [...entries, entries[0]],
    [{ ...entries[0], downloads: -1 }, ...entries.slice(1)],
    [{ ...entries[0], downloads: 1.5 }, ...entries.slice(1)]]) {
    const result = summarizeDownloads(invalid, window);
    assert.equal(result.current.downloads, null);
    assert.equal(result.changePercent, null);
  }
});

test("API outages and wrong repository data produce explicit partial reports", async () => {
  const report = await collectMetrics(now, async () => { throw new Error("private server message"); });
  assert.equal(report.errors.length, 2);
  assert.equal(report.github, null);
  assert.equal(report.downloads[0].current.downloads, null);
  assert.match(renderSummary(report), /unavailable/);
  assert(!JSON.stringify(report).includes("private server message"));
  const mismatch = await collectMetrics(now, async () => ({ full_name: "other/repo", stargazers_count: 5, forks_count: 1 }));
  assert.equal(mismatch.github, null);
});

test("reports carry exact public sources, capture time and measurement limitations", async () => {
  const report = await collectMetrics(now, async (url) => url.includes("npmjs.org")
    ? { package: "dsh-riskproof", downloads: entries }
    : { full_name: "onlyqzq/dsh-riskproof", stargazers_count: 7, forks_count: 1 });
  assert.deepEqual(report.errors, []);
  assert.equal(report.capturedAt, "2026-10-27T08:00:00.000Z");
  assert.match(report.sources.npm, /2026-08-28:2026-10-26/);
  assert.equal(report.github.stars, 7);
  assert.match(renderSummary(report), /not unique users/);
  assert.match(renderSummary(report), /no growth attribution/);
});
