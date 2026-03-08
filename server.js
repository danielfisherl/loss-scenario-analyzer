const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const FEEDBACK_FILE = path.join(ROOT, "feedback.log");

const SCENARIOS = [0.05, 0.1, 0.15, 0.2];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumber(value) {
  if (typeof value !== "string") {
    return Number.NaN;
  }
  const cleaned = value.replace(/[$,\s]/g, "");
  return Number(cleaned);
}

function toIsoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

function normalizeTickerForStooq(rawTicker) {
  const ticker = String(rawTicker).trim().toLowerCase();
  if (!ticker) {
    return null;
  }
  if (ticker.includes(".")) {
    const [base, suffix] = ticker.split(".");
    const safeBase = base.replace(/\./g, "-");
    return `${safeBase}.${suffix}`;
  }
  return `${ticker.replace(/\./g, "-")}.us`;
}

function normalizeTickerForYahoo(rawTicker) {
  const ticker = String(rawTicker).trim().toUpperCase();
  if (!ticker) {
    return null;
  }
  return ticker.replace(/\./g, "-");
}

function normalizeHistoryRows(rows) {
  const data = [];
  for (const row of rows) {
    const date = toIsoDate(row.date);
    const close = Number(row.close);
    if (!date || Number.isNaN(close)) {
      continue;
    }
    data.push({ date, close });
  }
  data.sort((a, b) => (a.date < b.date ? -1 : 1));
  return data;
}

async function fetchTickerHistoryFromStooq(rawTicker, fetchImpl = fetch) {
  const symbol = normalizeTickerForStooq(rawTicker);
  if (!symbol) {
    throw new Error("Empty ticker");
  }

  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Failed price fetch (${res.status})`);
  }

  const csv = await res.text();
  if (!csv || csv.toLowerCase().includes("no data")) {
    throw new Error("No historical data returned");
  }

  const rows = parseCsv(csv);
  if (rows.length <= 1) {
    throw new Error("Insufficient historical data");
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const closeIdx = header.indexOf("close");
  if (dateIdx < 0 || closeIdx < 0) {
    throw new Error("Invalid historical data format");
  }

  const rowsOut = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    rowsOut.push({ date: r[dateIdx], close: r[closeIdx] });
  }
  const data = normalizeHistoryRows(rowsOut);
  if (!data.length) {
    throw new Error("Insufficient historical data");
  }
  return data;
}

async function fetchTickerHistoryFromYahoo(rawTicker, fetchImpl = fetch) {
  const symbol = normalizeTickerForYahoo(rawTicker);
  if (!symbol) {
    throw new Error("Empty ticker");
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=max`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Failed price fetch (${res.status})`);
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;

  if (!Array.isArray(timestamps) || !Array.isArray(closes) || !timestamps.length) {
    throw new Error("No historical data returned");
  }

  const rows = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = Number(timestamps[i]);
    const close = closes[i];
    if (Number.isNaN(ts)) {
      continue;
    }
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    rows.push({ date, close });
  }

  const data = normalizeHistoryRows(rows);
  if (!data.length) {
    throw new Error("Insufficient historical data");
  }
  return data;
}

async function fetchTickerHistory(rawTicker, fetchImpl = fetch) {
  try {
    const data = await fetchTickerHistoryFromStooq(rawTicker, fetchImpl);
    return { data, source: "stooq" };
  } catch (stooqErr) {
    console.error(
      `[price-fetch] source=stooq ticker=${rawTicker} error=${stooqErr.message}`
    );
    try {
      const data = await fetchTickerHistoryFromYahoo(rawTicker, fetchImpl);
      console.log(`[price-fetch] source=yahoo ticker=${rawTicker} status=fallback-success`);
      return { data, source: "yahoo" };
    } catch (yahooErr) {
      console.error(
        `[price-fetch] source=yahoo ticker=${rawTicker} error=${yahooErr.message}`
      );
      throw stooqErr;
    }
  }
}

function parseTrades(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const headers = rows[0].map(normalizeHeader);
  const colDate = headers.indexOf("date");
  const colTicker = headers.indexOf("ticker");
  const colShares = headers.indexOf("shares");
  const colPrice = headers.findIndex((h) => h === "priceshare" || h === "priceshare$");

  if ([colDate, colTicker, colShares, colPrice].some((idx) => idx < 0)) {
    throw new Error(
      "Missing required columns. Expected: Date, Ticker, Shares, Price/Share ($)."
    );
  }

  const trades = [];
  const issues = [];

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const rowNum = i + 1;
    const dateRaw = r[colDate] ?? "";
    const ticker = (r[colTicker] ?? "").trim().toUpperCase();
    const shares = parseNumber(r[colShares] ?? "");
    const purchasePrice = parseNumber(r[colPrice] ?? "");
    const dateIso = toIsoDate(dateRaw);

    if (!dateIso || !ticker || Number.isNaN(shares) || Number.isNaN(purchasePrice)) {
      issues.push(`Row ${rowNum} skipped due to invalid date/ticker/shares/price.`);
      continue;
    }

    const year = Number(dateIso.slice(0, 4));
    trades.push({
      rowNum,
      date: dateIso,
      year,
      ticker,
      shares,
      purchasePrice,
    });
  }

  return { trades, issues };
}

function computeScenarioForTrade(trade, history, threshold) {
  const triggerPrice = trade.purchasePrice * (1 - threshold);
  const hit = history.find((p) => p.date >= trade.date && p.close <= triggerPrice);
  if (!hit) {
    return { triggered: false, thresholdPct: threshold * 100 };
  }

  const loss = (trade.purchasePrice - hit.close) * trade.shares;
  return {
    triggered: true,
    thresholdPct: threshold * 100,
    sellDate: hit.date,
    sellPrice: hit.close,
    loss: Number(loss.toFixed(2)),
  };
}

async function analyze(csvText, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const { trades, issues } = parseTrades(csvText);
  const trades2025 = trades.filter((t) => t.year === 2025);
  const historyCache = new Map();
  const tickerErrors = [];

  const summaries = SCENARIOS.map((s) => ({
    thresholdPct: s * 100,
    totalLoss: 0,
    saleCount: 0,
  }));

  const rowResults = [];

  for (const trade of trades2025) {
    let history = historyCache.get(trade.ticker);
    if (!history) {
      try {
        const { data, source } = await fetchTickerHistory(trade.ticker, fetchImpl);
        history = data;
        historyCache.set(trade.ticker, history);
        if (source !== "stooq") {
          console.log(`[analysis] ticker=${trade.ticker} source=${source}`);
        }
      } catch (err) {
        console.error(`[analysis] ticker=${trade.ticker} error=${err.message}`);
        tickerErrors.push(`${trade.ticker}: ${err.message}`);
        historyCache.set(trade.ticker, []);
        history = [];
      }
    }

    const scenarioResults = {};

    for (let i = 0; i < SCENARIOS.length; i += 1) {
      const threshold = SCENARIOS[i];
      const result = computeScenarioForTrade(trade, history, threshold);
      scenarioResults[String(result.thresholdPct)] = result;
      if (result.triggered) {
        summaries[i].saleCount += 1;
        summaries[i].totalLoss += result.loss;
      }
    }

    rowResults.push({
      rowNum: trade.rowNum,
      date: trade.date,
      ticker: trade.ticker,
      shares: trade.shares,
      purchasePrice: trade.purchasePrice,
      scenarios: scenarioResults,
    });
  }

  for (const s of summaries) {
    s.totalLoss = Number(s.totalLoss.toFixed(2));
  }

  return {
    totalRowsParsed: trades.length,
    rowsConsidered: trades2025.length,
    rowsSkippedNot2025: trades.length - trades2025.length,
    parseIssues: issues,
    tickerErrors: [...new Set(tickerErrors)],
    scenarioSummaries: summaries,
    rowResults,
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function serveStatic(res, reqPath) {
  const safePath = reqPath === "/" ? "/index.html" : reqPath;
  const fullPath = path.join(ROOT, "public", safePath);
  if (!fullPath.startsWith(path.join(ROOT, "public"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const content = await fs.readFile(fullPath);
    res.writeHead(200, { "Content-Type": getContentType(fullPath) });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function createRequestHandler(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const maxBodyBytes = options.maxBodyBytes || 5 * 1024 * 1024;
  const feedbackFilePath = options.feedbackFilePath || FEEDBACK_FILE;

  return async function requestHandler(req, res) {
    if (req.method === "POST" && req.url === "/api/analyze") {
      console.log("[request] POST /api/analyze");
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
        if (body.length > maxBodyBytes) {
          req.destroy();
        }
      });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          if (!payload || typeof payload.csv !== "string") {
            sendJson(res, 400, { error: "Expected JSON body with { csv: string }" });
            return;
          }
          const result = await analyze(payload.csv, { fetchImpl });
          sendJson(res, 200, result);
          console.log(
            `[request] POST /api/analyze complete rowsConsidered=${result.rowsConsidered}`
          );
        } catch (err) {
          console.error(`[request] POST /api/analyze error=${err.message}`);
          sendJson(res, 400, { error: err.message || "Invalid request" });
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/feedback") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
        if (body.length > maxBodyBytes) {
          req.destroy();
        }
      });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          if (!payload || typeof payload.feedback !== "string") {
            sendJson(res, 400, { error: "Expected JSON body with { feedback: string }" });
            return;
          }

          const feedback = payload.feedback.trim();
          if (!feedback) {
            sendJson(res, 400, { error: "Feedback cannot be empty." });
            return;
          }

          const metadataParts = [];
          if (typeof payload.rowsConsidered === "number") {
            metadataParts.push(`rowsConsidered=${payload.rowsConsidered}`);
          }
          if (typeof payload.scenarioSummaries === "string" && payload.scenarioSummaries) {
            metadataParts.push(`scenarioSummaries=${payload.scenarioSummaries}`);
          }
          const metadata = metadataParts.length ? ` | ${metadataParts.join(" | ")}` : "";
          const line = `[${new Date().toISOString()}] ${feedback}${metadata}\n`;
          await fs.appendFile(feedbackFilePath, line, "utf8");
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err.message || "Invalid request" });
        }
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, req.url || "/");
      return;
    }

    res.writeHead(405);
    res.end("Method not allowed");
  };
}

function createServer(options = {}) {
  return http.createServer(createRequestHandler(options));
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = {
  analyze,
  createRequestHandler,
  createServer,
  parseCsv,
  parseTrades,
  normalizeTickerForStooq,
};
