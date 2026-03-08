const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRequestHandler } = require("../server");
const { invokeHandler, makeFetchMock } = require("../testsupport/test-helpers");

function parseJsonBody(body) {
  return JSON.parse(body);
}

test("POST /api/analyze returns 200 for valid payload", async () => {
  const fetchMock = makeFetchMock({
    "aapl.us": {
      rows: [
        { date: "2025-01-02", close: 100 },
        { date: "2025-01-03", close: 95 },
      ],
    },
  });
  const handler = createRequestHandler({ fetchImpl: fetchMock });
  const payload = JSON.stringify({
    csv: "Date,Ticker,Shares,Price/Share ($)\n2025-01-02,AAPL,1,100",
  });

  const { res } = await invokeHandler(handler, {
    method: "POST",
    url: "/api/analyze",
    body: payload,
  });

  assert.equal(res.statusCode, 200);
  const json = parseJsonBody(res.body);
  assert.equal(json.rowsConsidered, 1);
  assert.ok(Array.isArray(json.scenarioSummaries));
});

test("POST /api/analyze returns 400 for invalid JSON", async () => {
  const handler = createRequestHandler({ fetchImpl: makeFetchMock({}) });
  const { res } = await invokeHandler(handler, {
    method: "POST",
    url: "/api/analyze",
    body: "{not-json",
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /error/i);
});

test("POST /api/analyze returns 400 for missing or invalid csv", async () => {
  const handler = createRequestHandler({ fetchImpl: makeFetchMock({}) });

  const missing = await invokeHandler(handler, {
    method: "POST",
    url: "/api/analyze",
    body: JSON.stringify({}),
  });
  assert.equal(missing.res.statusCode, 400);
  assert.match(missing.res.body, /Expected JSON body/);

  const nonString = await invokeHandler(handler, {
    method: "POST",
    url: "/api/analyze",
    body: JSON.stringify({ csv: 42 }),
  });
  assert.equal(nonString.res.statusCode, 400);
  assert.match(nonString.res.body, /Expected JSON body/);
});

test("POST /api/analyze returns 400 for CSV shape errors", async () => {
  const handler = createRequestHandler({ fetchImpl: makeFetchMock({}) });

  const noRows = await invokeHandler(handler, {
    method: "POST",
    url: "/api/analyze",
    body: JSON.stringify({ csv: "Date,Ticker,Shares,Price/Share ($)" }),
  });
  assert.equal(noRows.res.statusCode, 400);
  assert.match(noRows.res.body, /header row and at least one data row/);

  const missingHeaders = await invokeHandler(handler, {
    method: "POST",
    url: "/api/analyze",
    body: JSON.stringify({ csv: "Date,Ticker,Shares\n2025-01-01,AAPL,1" }),
  });
  assert.equal(missingHeaders.res.statusCode, 400);
  assert.match(missingHeaders.res.body, /Missing required columns/);
});

test("POST /api/analyze destroys oversized payload request", async () => {
  const handler = createRequestHandler({
    fetchImpl: makeFetchMock({}),
    maxBodyBytes: 32,
  });
  const hugePayload = JSON.stringify({ csv: "x".repeat(128) });
  const { req, res } = await invokeHandler(handler, {
    method: "POST",
    url: "/api/analyze",
    chunks: [hugePayload.slice(0, 64), hugePayload.slice(64)],
  });

  assert.equal(req.destroyed, true);
  assert.ok([null, 400].includes(res.statusCode));
});

test("GET static routes return expected status and content type", async () => {
  const handler = createRequestHandler({ fetchImpl: makeFetchMock({}) });

  const root = await invokeHandler(handler, { method: "GET", url: "/" });
  assert.equal(root.res.statusCode, 200);
  assert.match(root.res.headers["Content-Type"], /text\/html/i);

  const appJs = await invokeHandler(handler, { method: "GET", url: "/app.js" });
  assert.equal(appJs.res.statusCode, 200);
  assert.match(appJs.res.headers["Content-Type"], /javascript/i);

  const css = await invokeHandler(handler, { method: "GET", url: "/styles.css" });
  assert.equal(css.res.statusCode, 200);
  assert.match(css.res.headers["Content-Type"], /text\/css/i);

  const notFound = await invokeHandler(handler, { method: "GET", url: "/missing.txt" });
  assert.equal(notFound.res.statusCode, 404);
});

test("GET traversal-like path is blocked", async () => {
  const handler = createRequestHandler({ fetchImpl: makeFetchMock({}) });
  const { res } = await invokeHandler(handler, {
    method: "GET",
    url: "/../server.js",
  });

  assert.equal(res.statusCode, 403);
});

test("unsupported method returns 405", async () => {
  const handler = createRequestHandler({ fetchImpl: makeFetchMock({}) });
  const { res } = await invokeHandler(handler, {
    method: "PUT",
    url: "/api/analyze",
  });
  assert.equal(res.statusCode, 405);
});

test("POST /api/feedback appends feedback to text file", async () => {
  const tmpFile = path.join(
    os.tmpdir(),
    `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}.log`
  );
  const handler = createRequestHandler({
    fetchImpl: makeFetchMock({}),
    feedbackFilePath: tmpFile,
  });
  const { res } = await invokeHandler(handler, {
    method: "POST",
    url: "/api/feedback",
    body: JSON.stringify({
      feedback: "Need better ticker warnings",
      rowsConsidered: 2,
      scenarioSummaries: "5%:1/50,10%:1/100",
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"ok":true/);
  const content = await fs.readFile(tmpFile, "utf8");
  assert.match(content, /Need better ticker warnings/);
  assert.match(content, /rowsConsidered=2/);
});

test("POST /api/feedback validates empty or invalid feedback payloads", async () => {
  const handler = createRequestHandler({ fetchImpl: makeFetchMock({}) });

  const invalidType = await invokeHandler(handler, {
    method: "POST",
    url: "/api/feedback",
    body: JSON.stringify({ feedback: 1 }),
  });
  assert.equal(invalidType.res.statusCode, 400);
  assert.match(invalidType.res.body, /feedback: string/);

  const emptyFeedback = await invokeHandler(handler, {
    method: "POST",
    url: "/api/feedback",
    body: JSON.stringify({ feedback: "   " }),
  });
  assert.equal(emptyFeedback.res.statusCode, 400);
  assert.match(emptyFeedback.res.body, /cannot be empty/i);
});
