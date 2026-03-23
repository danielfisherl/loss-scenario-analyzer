(function () {
  const form = document.getElementById('quit-calculator-form');
  const results = document.getElementById('results');

  if (!form || !results) {
    return;
  }

  const currency = (n) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(Number.isFinite(n) ? n : 0);

  const formatMonths = (n) => {
    if (!Number.isFinite(n) || n >= 99) {
      return '99+ months';
    }
    return `${n.toFixed(1)} months`;
  };

  const monthToDate = (months) => {
    if (!Number.isFinite(months) || months >= 99) {
      return 'long-term';
    }

    const date = new Date();
    date.setMonth(date.getMonth() + Math.max(0, Math.floor(months)));
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const safeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const event = (name, data) => {
    if (window.console && window.console.log) {
      window.console.log('analytics-event', name, data || {});
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, data || {});
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    event('calculator_start');

    const data = {
      savings: safeNumber(form.savings.value),
      spendNow: safeNumber(form.spendNow.value),
      spendQuit: safeNumber(form.spendQuit.value),
      otherIncome: safeNumber(form.otherIncome.value),
      severance: safeNumber(form.severance.value),
      oneTime: safeNumber(form.oneTime.value),
      healthDelta: safeNumber(form.healthDelta.value),
      breakIncome: safeNumber(form.breakIncome.value),
      reemploymentMonths: safeNumber(form.reemploymentMonths.value),
      unvestedEquity: safeNumber(form.unvestedEquity.value),
      vestMonths: safeNumber(form.vestMonths.value),
      riskTolerance: form.riskTolerance.value
    };

    const effectiveCash = data.savings + data.severance - data.oneTime;
    const leanBurn = data.spendQuit + data.healthDelta - data.otherIncome - data.breakIncome;
    const currentBurn = data.spendNow + data.healthDelta - data.otherIncome - data.breakIncome;

    const runwayLean = leanBurn <= 0 ? 99 : effectiveCash / leanBurn;
    const runwayCurrent = currentBurn <= 0 ? 99 : effectiveCash / currentBurn;
    const targetSpend12 = effectiveCash / 12 + data.otherIncome + data.breakIncome - data.healthDelta;

    const equityCost = data.unvestedEquity;
    const equityShare = effectiveCash > 0 ? equityCost / effectiveCash : 1;

    let risk = 'Low';
    if (runwayLean < 9 || data.healthDelta > data.spendQuit * 0.25) {
      risk = 'High';
    } else if (runwayLean < 18) {
      risk = 'Medium';
    }

    if (data.riskTolerance === 'Conservative' && risk === 'Low' && runwayLean < 24) {
      risk = 'Medium';
    }
    if (data.riskTolerance === 'Aggressive' && risk === 'Medium' && runwayLean >= 14) {
      risk = 'Low';
    }

    let decision = 'Now';
    if (runwayLean < 9) {
      decision = 'Not yet';
    } else if (runwayLean < 18 || (data.vestMonths <= data.reemploymentMonths && equityShare > 0.1)) {
      decision = 'Wait until next vest';
    }

    const riskClass = risk.toLowerCase();

    results.innerHTML = `
      <h2>Your Results</h2>
      <div class="result-grid">
        <div class="stat">
          <div class="label">Runway at post-quit spend</div>
          <div class="value">${formatMonths(runwayLean)}</div>
        </div>
        <div class="stat">
          <div class="label">Runway at current spend</div>
          <div class="value">${formatMonths(runwayCurrent)}</div>
        </div>
        <div class="stat">
          <div class="label">Projected runway end</div>
          <div class="value">${monthToDate(runwayLean)}</div>
        </div>
        <div class="stat">
          <div class="label">12-month spend cap</div>
          <div class="value">${currency(targetSpend12)}</div>
        </div>
        <div class="stat">
          <div class="label">Unvested equity tradeoff</div>
          <div class="value">${currency(equityCost)}</div>
        </div>
        <div class="stat">
          <div class="label">Recommended decision</div>
          <div class="value">${decision}</div>
        </div>
      </div>
      <p class="notice">Risk score: <span class="badge ${riskClass}">${risk}</span></p>
      <p><strong>What to do next:</strong> Run two scenarios: (1) quit now and (2) quit after next vest. Keep the one with acceptable stress and at least 12 months runway.</p>
    `;

    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });

    event('calculator_complete', {
      runwayLean,
      runwayCurrent,
      decision,
      risk
    });
  });
})();
