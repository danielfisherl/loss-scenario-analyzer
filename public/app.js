const fileInput = document.getElementById("csvFile");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusEl = document.getElementById("status");
const warningsEl = document.getElementById("warnings");
const summaryEl = document.getElementById("summary");
const detailsWrapEl = document.getElementById("detailsWrap");
const detailsEl = document.getElementById("details");
const feedbackSectionEl = document.getElementById("feedbackSection");
const feedbackInputEl = document.getElementById("feedbackInput");
const feedbackBtnEl = document.getElementById("feedbackBtn");
const feedbackStatusEl = document.getElementById("feedbackStatus");
let lastResult = null;
const FEDERAL_MARGINAL_BRACKETS = [10, 12, 22, 24, 32, 35, 37];

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function renderWarnings(result) {
  const messages = [];
  if (Array.isArray(result.parseIssues) && result.parseIssues.length) {
    messages.push(...result.parseIssues);
  }
  if (Array.isArray(result.tickerErrors) && result.tickerErrors.length) {
    messages.push(
      "Ticker history fetch issues: " + result.tickerErrors.join(" | ")
    );
  }
  warningsEl.innerHTML = messages.map((m) => `<div>${m}</div>`).join("");
}

function renderSummary(result) {
  const rows = result.scenarioSummaries
    .map(
      (s) => `
        <tr>
          <td>${s.thresholdPct}%</td>
          <td>${s.saleCount}</td>
          <td>${money(s.totalLoss)}</td>
        </tr>
      `
    )
    .join("");
  const tenPercentScenario = result.scenarioSummaries.find(
    (s) => s.thresholdPct === 10
  );
  const tenPercentLoss = tenPercentScenario ? tenPercentScenario.totalLoss : 0;
  const taxRows = FEDERAL_MARGINAL_BRACKETS.map((rate) => {
    const estimatedSavings = tenPercentLoss * (rate / 100);
    return `
      <tr>
        <td>${rate}%</td>
        <td>${money(estimatedSavings)}</td>
      </tr>
    `;
  }).join("");

  summaryEl.innerHTML = `
    <div class="meta">
      Rows parsed: ${result.totalRowsParsed} | Rows considered (2025 only):
      ${result.rowsConsidered} | Rows skipped (not 2025): ${result.rowsSkippedNot2025}
    </div>
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Number of Sales</th>
          <th>Total Loss</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="tax-summary">
      <h3>Estimated Tax Savings (10% Rule)</h3>
      <p class="hint">
        Based on total 10% scenario loss of <strong>${money(tenPercentLoss)}</strong>.
        Estimate only, not tax advice.
      </p>
      <table>
        <thead>
          <tr>
            <th>Marginal Tax Bracket</th>
            <th>Estimated Tax Savings</th>
          </tr>
        </thead>
        <tbody>${taxRows}</tbody>
      </table>
    </section>
  `;
}

function renderDetails(result) {
  const detailRows = [];
  for (const r of result.rowResults) {
    for (const pct of ["5", "10", "15", "20"]) {
      const sc = r.scenarios[pct];
      if (!sc || !sc.triggered) {
        continue;
      }
      const totalBefore = r.purchasePrice * r.shares;
      const totalAfter = sc.sellPrice * r.shares;
      detailRows.push(`
        <tr>
          <td>${r.rowNum}</td>
          <td>${r.date}</td>
          <td>${r.ticker}</td>
          <td>${money(r.purchasePrice)}</td>
          <td>${pct}%</td>
          <td>${sc.sellDate}</td>
          <td>${money(sc.sellPrice)}</td>
          <td>${money(totalBefore)}</td>
          <td>${money(totalAfter)}</td>
          <td>${money(sc.loss)}</td>
        </tr>
      `);
    }
  }

  detailsWrapEl.hidden = false;
  if (!detailRows.length) {
    detailsEl.innerHTML = "<p>No thresholds were triggered for the analyzed rows.</p>";
    return;
  }

  detailsEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>CSV Row</th>
          <th>Buy Date</th>
          <th>Ticker</th>
          <th>Buy Price</th>
          <th>Scenario</th>
          <th>Sell Date</th>
          <th>Sell Price</th>
          <th>Total Before</th>
          <th>Total After</th>
          <th>Loss</th>
        </tr>
      </thead>
      <tbody>${detailRows.join("")}</tbody>
    </table>
  `;
}

analyzeBtn.addEventListener("click", async () => {
  summaryEl.innerHTML = "";
  detailsEl.innerHTML = "";
  warningsEl.innerHTML = "";
  detailsWrapEl.hidden = true;
  feedbackSectionEl.hidden = true;
  feedbackStatusEl.textContent = "";

  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = "Select a CSV file first.";
    return;
  }

  analyzeBtn.disabled = true;
  statusEl.textContent = "Analyzing...";

  try {
    const csv = await readFileText(file);
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Analysis failed");
    }

    statusEl.textContent = "Analysis complete.";
    lastResult = data;
    renderWarnings(data);
    renderSummary(data);
    renderDetails(data);
    feedbackSectionEl.hidden = false;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    analyzeBtn.disabled = false;
  }
});

feedbackBtnEl.addEventListener("click", async () => {
  const feedback = feedbackInputEl.value.trim();
  if (!feedback) {
    feedbackStatusEl.textContent = "Enter feedback before saving.";
    return;
  }
  feedbackBtnEl.disabled = true;
  feedbackStatusEl.textContent = "Saving feedback...";
  try {
    const summaries = (lastResult?.scenarioSummaries || [])
      .map((s) => `${s.thresholdPct}%:${s.saleCount}/${s.totalLoss}`)
      .join(",");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedback,
        rowsConsidered: lastResult?.rowsConsidered,
        scenarioSummaries: summaries,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to save feedback");
    }
    feedbackStatusEl.textContent = "Feedback saved to feedback.log";
    feedbackInputEl.value = "";
  } catch (err) {
    feedbackStatusEl.textContent = `Error: ${err.message}`;
  } finally {
    feedbackBtnEl.disabled = false;
  }
});
