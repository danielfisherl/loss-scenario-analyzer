const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { analyze, clearPriceHistoryCache } = require("../server");
const { makeFetchMock } = require("../testsupport/test-helpers");

function baseMarketDataConfig() {
  return {
    "aapl.us": {
      rows: [
        { date: "2025-01-02", close: 100 },
        { date: "2025-01-03", close: 95 },
        { date: "2025-01-06", close: 90 },
        { date: "2025-01-07", close: 84.9 },
        { date: "2025-01-08", close: 80 },
      ],
    },
    "msft.us": {
      rows: [
        { date: "2025-01-02", close: 205 },
        { date: "2025-01-03", close: 204 },
        { date: "2025-01-06", close: 203 },
      ],
    },
    "nvda.us": {
      rows: [
        { date: "2025-02-10", close: 122 },
        { date: "2025-02-11", close: 123 },
        { date: "2025-02-12", close: 124 },
      ],
    },
    "tsla.us": {
      rows: [
        { date: "2025-03-01", close: 201 },
        { date: "2025-03-02", close: 202 },
      ],
    },
    "broken.us": {
      status: 500,
    },
    "round.us": {
      rows: [
        { date: "2025-01-03", close: 9.333 },
        { date: "2025-01-04", close: 8.999 },
        { date: "2025-01-05", close: 8.499 },
        { date: "2025-01-06", close: 8 },
      ],
    },
  };
}

async function loadFixture(name) {
  const p = path.join(__dirname, "fixtures", name);
  return fs.readFile(p, "utf8");
}

async function loadSnapshot(name) {
  const p = path.join(__dirname, "snapshots", name);
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

test.beforeEach(() => {
  clearPriceHistoryCache();
});

test("filters to 2025 and triggers first-hit sale dates per threshold", async () => {
  const csv = await loadFixture("golden_basic.csv");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });

  assert.equal(result.totalRowsParsed, 3);
  assert.equal(result.rowsConsidered, 2);
  assert.equal(result.rowsSkippedNot2025, 1);

  const aapl = result.rowResults.find((r) => r.ticker === "AAPL");
  assert.ok(aapl);
  assert.equal(aapl.scenarios["5"].sellDate, "2025-01-03");
  assert.equal(aapl.scenarios["10"].sellDate, "2025-01-06");
  assert.equal(aapl.scenarios["15"].sellDate, "2025-01-07");
  assert.equal(aapl.scenarios["20"].sellDate, "2025-01-08");
});

test("marks no-trigger scenarios without incrementing sale totals", async () => {
  const csv = await loadFixture("golden_no_triggers.csv");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });

  for (const scenario of result.scenarioSummaries) {
    assert.equal(scenario.saleCount, 0);
    assert.equal(scenario.totalLoss, 0);
  }
});

test("skips malformed rows and reports parse issues", async () => {
  const csv = await loadFixture("golden_invalid_rows.csv");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });

  assert.deepEqual(result.parseIssues, [
    "Row 3 skipped due to invalid date/ticker/shares/price.",
    "Row 4 skipped due to invalid date/ticker/shares/price.",
    "Row 5 skipped due to invalid date/ticker/shares/price.",
    "Row 6 skipped due to invalid date/ticker/shares/price.",
  ]);
});

test("accepts header variants for Price/Share", async () => {
  const csv = [
    "Date,Ticker,Shares,Price / Share ($)",
    "2025-01-02,AAPL,1,100",
  ].join("\n");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });
  assert.equal(result.rowsConsidered, 1);
});

test("deduplicates ticker errors and caches one upstream fetch per ticker", async () => {
  const csv = [
    "Date,Ticker,Shares,Price/Share ($)",
    "2025-01-02,BROKEN,1,100",
    "2025-01-03,BROKEN,2,100",
    "2025-01-04,AAPL,1,100",
    "2025-01-05,AAPL,2,100",
  ].join("\n");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });

  assert.deepEqual(result.tickerErrors, ["BROKEN: Failed price fetch (500)"]);
  assert.equal(fetchMock.calls.get("broken.us"), 1);
  assert.equal(fetchMock.calls.get("aapl.us"), 1);
});

test("rounds per-row losses and summarized totals to 2 decimals", async () => {
  const csv = [
    "Date,Ticker,Shares,Price/Share ($)",
    "2025-01-02,ROUND,3,10",
  ].join("\n");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });

  assert.equal(result.rowResults[0].scenarios["5"].loss, 2);
  assert.equal(result.rowResults[0].scenarios["10"].loss, 3);
  assert.equal(result.rowResults[0].scenarios["15"].loss, 4.5);
  assert.equal(result.rowResults[0].scenarios["20"].loss, 6);
  assert.deepEqual(
    result.scenarioSummaries.map((s) => s.totalLoss),
    [2, 3, 4.5, 6]
  );
});

test("falls back to Yahoo data when Stooq is unavailable", async () => {
  const csv = [
    "Date,Ticker,Shares,Price/Share ($)",
    "2025-01-02,VTI,1,100",
  ].join("\n");
  const fetchMock = makeFetchMock({
    "vti.us": { status: 503 },
    VTI: {
      rows: [
        { date: "2025-01-02", close: 100 },
        { date: "2025-01-03", close: 90 },
      ],
    },
  });
  const result = await analyze(csv, { fetchImpl: fetchMock });

  assert.equal(result.tickerErrors.length, 0);
  assert.equal(result.scenarioSummaries[0].saleCount, 1);
  assert.equal(fetchMock.calls.get("vti.us"), 1);
  assert.equal(fetchMock.calls.get("VTI"), 1);
});

test("returns rate-limit warning when fallback provider responds with 429", async () => {
  const csv = [
    "Date,Ticker,Shares,Price/Share ($)",
    "2025-01-02,VOO,1,100",
  ].join("\n");
  const fetchMock = makeFetchMock({
    "voo.us": { status: 503 },
    VOO: { status: 429 },
  });
  const result = await analyze(csv, { fetchImpl: fetchMock });

  assert.deepEqual(result.tickerErrors, [
    "VOO: Rate limited by price data provider (HTTP 429)",
  ]);
});

test("golden snapshot: basic mixed-year and thresholds", async () => {
  const csv = await loadFixture("golden_basic.csv");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });
  const snapshot = await loadSnapshot("golden_basic.expected.json");
  assert.deepEqual(result, snapshot);
});

test("golden snapshot: invalid rows and ticker fetch failures", async () => {
  const csv = await loadFixture("golden_invalid_rows.csv");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });
  const snapshot = await loadSnapshot("golden_invalid_rows.expected.json");
  assert.deepEqual(result, snapshot);
});

test("golden snapshot: no thresholds triggered", async () => {
  const csv = await loadFixture("golden_no_triggers.csv");
  const fetchMock = makeFetchMock(baseMarketDataConfig());
  const result = await analyze(csv, { fetchImpl: fetchMock });
  const snapshot = await loadSnapshot("golden_no_triggers.expected.json");
  assert.deepEqual(result, snapshot);
});
