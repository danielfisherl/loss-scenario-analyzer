const { EventEmitter } = require("events");

function historyRowsToCsv(rows) {
  const lines = ["Date,Open,High,Low,Close,Volume"];
  for (const row of rows) {
    lines.push(`${row.date},0,0,0,${row.close},0`);
  }
  return lines.join("\n");
}

function makeFetchMock(configBySymbol) {
  const calls = new Map();

  async function fetchMock(url) {
    const parsed = new URL(url);
    const symbol = parsed.searchParams.get("s");
    calls.set(symbol, (calls.get(symbol) || 0) + 1);

    const config = configBySymbol[symbol];
    if (!config) {
      return {
        ok: false,
        status: 404,
        async text() {
          return "";
        },
      };
    }

    if (config.errorMessage) {
      throw new Error(config.errorMessage);
    }

    if (config.status && config.status !== 200) {
      return {
        ok: false,
        status: config.status,
        async text() {
          return "";
        },
      };
    }

    const body = config.csv || historyRowsToCsv(config.rows || []);
    return {
      ok: true,
      status: 200,
      async text() {
        return body;
      },
    };
  }

  fetchMock.calls = calls;
  return fetchMock;
}

function invokeHandler(handler, { method, url, body = "", chunks }) {
  return new Promise(async (resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
    };

    const response = {
      statusCode: null,
      headers: {},
      body: "",
      writeHead(statusCode, headers = {}) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end: (chunk = "") => {
        if (chunk) {
          response.body += chunk.toString();
        }
        resolve({ req, res: response });
      },
    };

    try {
      await handler(req, response);
      if (method === "POST") {
        const pieces = chunks || [body];
        process.nextTick(() => {
          for (const piece of pieces) {
            req.emit("data", Buffer.from(piece));
          }
          req.emit("end");
        });
      }
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  historyRowsToCsv,
  makeFetchMock,
  invokeHandler,
};
