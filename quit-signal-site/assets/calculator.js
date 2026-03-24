(function () {
  const form = document.getElementById('quit-calculator-form');
  const results = document.getElementById('results');

  if (!form || !results) {
    return;
  }

  const presetButtons = document.querySelectorAll('[data-preset]');

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

  const presets = {
    baseline: {
      savings: 120000,
      spendNow: 9000,
      spendQuit: 7000,
      otherIncome: 3000,
      severance: 0,
      oneTime: 4000,
      healthDelta: 1200,
      breakIncome: 1500,
      reemploymentMonths: 6,
      unvestedEquity: 50000,
      vestMonths: 2,
      riskTolerance: 'Balanced'
    },
    bonus: {
      savings: 180000,
      spendNow: 12000,
      spendQuit: 8500,
      otherIncome: 2000,
      severance: 40000,
      oneTime: 5000,
      healthDelta: 1500,
      breakIncome: 0,
      reemploymentMonths: 4,
      unvestedEquity: 15000,
      vestMonths: 1,
      riskTolerance: 'Balanced'
    },
    rsu: {
      savings: 250000,
      spendNow: 15000,
      spendQuit: 10000,
      otherIncome: 4000,
      severance: 0,
      oneTime: 5000,
      healthDelta: 1800,
      breakIncome: 0,
      reemploymentMonths: 6,
      unvestedEquity: 90000,
      vestMonths: 2,
      riskTolerance: 'Balanced'
    }
  };

  const applyPreset = (presetName) => {
    const preset = presets[presetName];
    if (!preset) {
      return;
    }

    Object.entries(preset).forEach(([key, value]) => {
      const field = form.elements[key];
      if (field) {
        field.value = value;
      }
    });
  };

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyPreset(button.dataset.preset);
      event('calculator_preset', { preset: button.dataset.preset });
      results.hidden = true;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

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
    const searchPressure = data.reemploymentMonths > 0 && runwayLean < data.reemploymentMonths;
    const toleranceMap = {
      Conservative: {
        strongRunway: 21,
        strongCurrent: 14,
        possibleRunway: 11,
        possibleCurrent: 6,
        equityStrong: 0.1,
        equityPressure: 0.18,
        vestSoonMonths: 3
      },
      Balanced: {
        strongRunway: 18,
        strongCurrent: 12,
        possibleRunway: 9,
        possibleCurrent: 5,
        equityStrong: 0.12,
        equityPressure: 0.2,
        vestSoonMonths: 3
      },
      Aggressive: {
        strongRunway: 15,
        strongCurrent: 10,
        possibleRunway: 8,
        possibleCurrent: 5,
        equityStrong: 0.15,
        equityPressure: 0.22,
        vestSoonMonths: 2
      }
    };
    const thresholds = toleranceMap[data.riskTolerance] || toleranceMap.Balanced;

    // Result-state rules are intentionally simple and editable:
    // - Strong quit signal: comfortable runway, comfortable current-spend runway, and no near-term equity pressure.
    // - Possible but risky: runway exists, but the margin is thin or vesting/bonus timing still matters.
    // - Not yet: runway is too short to absorb the uncertainty.
    const nearTermVestPressure = data.vestMonths > 0 && data.vestMonths <= thresholds.vestSoonMonths && equityShare >= thresholds.equityPressure;
    const strongSignal =
      runwayLean >= thresholds.strongRunway &&
      runwayCurrent >= thresholds.strongCurrent &&
      equityShare < thresholds.equityStrong &&
      !nearTermVestPressure &&
      !searchPressure;

    const possibleSignal =
      !strongSignal &&
      runwayLean >= thresholds.possibleRunway &&
      runwayCurrent >= thresholds.possibleCurrent &&
      !searchPressure;

    const signalKey = strongSignal ? 'strong' : possibleSignal ? 'risky' : 'notyet';

    const signalCopy = {
      strong: {
        label: 'Strong quit signal',
        short: 'Your numbers suggest you have enough room to leave without forcing a rushed decision.',
        long: 'This does not guarantee the exit will feel easy, but it does mean the financial side is not doing the heavy lifting. The main question becomes timing: when you leave, what pace you want to search at, and how much margin you want to preserve.'
      },
      risky: {
        label: 'Possible but risky',
        short: 'You can probably make this work, but the margin is thin enough that timing still matters.',
        long: 'This is the zone where people can afford the move but still feel uneasy about it. A bonus, vest, or a small expense change can move the answer. If you leave here, do it with a plan instead of a guess.'
      },
      notyet: {
        label: 'Not yet',
        short: 'The current numbers leave too little slack to make the decision comfortably.',
        long: 'The output is saying the exit is still too dependent on optimistic assumptions. That usually means the next move is to reduce burn, extend the timeline, or wait for a better timing window rather than trying to force certainty.'
      }
    };

    const monthsSaved = Math.max(0, runwayLean - runwayCurrent);
    const monthlyFlex = leanBurn > 0 ? 1000 / leanBurn : 99;
    const constraint = (() => {
      if (nearTermVestPressure) {
        return 'near-term vesting';
      }
      if (searchPressure) {
        return 'job search timeline';
      }
      if (runwayLean < thresholds.possibleRunway) {
        return 'monthly burn';
      }
      if (data.healthDelta > data.spendQuit * 0.25) {
        return 'healthcare costs';
      }
      if (runwayCurrent < runwayLean && runwayLean >= thresholds.possibleRunway) {
        return 'spend discipline';
      }
      return 'savings buffer';
    })();

    const insightBullets = [
      `Moving to your planned post-quit spend gives you about ${formatMonths(monthsSaved)} of extra runway versus staying at current spend.`,
      `Your main constraint right now is ${constraint}.`,
      leanBurn > 0
        ? `Cutting $1,000 a month would add about ${monthlyFlex.toFixed(1)} months of runway.`
        : 'Your planned break income almost covers the burn, so the decision is less about monthly cash flow.'
    ];

    const changeLine = (() => {
      if (constraint === 'job search timeline') {
        return `Your expected re-employment timeline is ${data.reemploymentMonths || 0} months. That is longer than your current runway, so either your burn needs to come down or your safety buffer needs to go up.`;
      }
      if (constraint === 'near-term vesting') {
        return `Waiting for the next vest is likely to matter here. If you can bridge the gap, compare the runway with and without that payout.`;
      }
      if (constraint === 'healthcare costs') {
        return `Healthcare is materially affecting the answer. Reducing that delta would move the signal faster than small tweaks elsewhere.`;
      }
      if (constraint === 'monthly burn') {
        return `Burn is the main lever. Small changes to housing, travel, or discretionary spend can move the signal faster than you might expect.`;
      }
      return `Additional liquid savings would improve the margin more than marginal changes to the current inputs.`;
    })();

    const interpretationCopy = {
      strong: [
        'You are trading money for time, but the gap is wide enough that the decision is mostly about preference and timing.',
        'This is the point where overthinking can become its own cost. If you leave, do it deliberately instead of waiting for perfect certainty.',
        'A measured exit plan matters more than squeezing the last bit of safety out of the numbers.'
      ],
      risky: [
        'You can likely afford the move, but the safety margin is not large enough to ignore.',
        'This is the common zone where people feel both capable and uneasy at the same time. That tension is real, not a failure.',
        'The right choice may depend on whether a bonus, vest, or small burn reduction meaningfully changes your runway.'
      ],
      notyet: [
        'The decision is still too dependent on the assumption that everything goes right.',
        'That usually means the problem is not conviction. It is margin.',
        'Use the calculator to find the smallest change that moves you from fragile to workable.'
      ]
    };

    const whyDetails = [
      `Strong quit signal if runway at planned spend is at least ${thresholds.strongRunway} months, current-spend runway is at least ${thresholds.strongCurrent} months, and near-term equity pressure is low.`,
      `Possible but risky if runway at planned spend is at least ${thresholds.possibleRunway} months and current-spend runway is at least ${thresholds.possibleCurrent} months.`,
      `Not yet if you fall below those thresholds or if vesting pressure is too close relative to the value at stake.`
    ];

    const signalStateClass = signalKey === 'strong' ? 'strong' : signalKey === 'risky' ? 'risky' : 'notyet';
    const signalRiskBadge = signalKey === 'strong' ? 'low' : signalKey === 'risky' ? 'medium' : 'high';

    results.innerHTML = `
      <h2>Your Result</h2>
      <section class="signal-panel ${signalStateClass}">
        <div class="signal-label">Decision signal</div>
        <h3 class="signal-name">${signalCopy[signalKey].label}</h3>
        <p class="signal-short">${signalCopy[signalKey].short}</p>
        <p class="signal-long">${signalCopy[signalKey].long}</p>
      </section>
      <p class="signal-disclaimer">Directional only. This tool is meant to clarify tradeoffs, not make the decision for you.</p>

      <ul class="insight-list">
        <li>${insightBullets[0]}</li>
        <li>${insightBullets[1]}</li>
        <li>${insightBullets[2]}</li>
      </ul>

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
          <div class="label">Expected re-employment timeline</div>
          <div class="value">${data.reemploymentMonths || 0} months</div>
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
          <div class="label">Constraint flag</div>
          <div class="value">${constraint}</div>
        </div>
      </div>

      <div class="interpretation-box">
        <h3>What this actually means</h3>
        <p>${interpretationCopy[signalKey][0]}</p>
        <p>${interpretationCopy[signalKey][1]}</p>
        <p>${interpretationCopy[signalKey][2]}</p>
        <p><strong>What would move this result:</strong> ${changeLine}</p>
      </div>

      <details class="why-details">
        <summary>Why this result?</summary>
        <p>This is a transparent rule set. Edit the thresholds in <code>assets/calculator.js</code> if you want different sensitivity.</p>
        <ul class="list">
          <li>${whyDetails[0]}</li>
          <li>${whyDetails[1]}</li>
          <li>${whyDetails[2]}</li>
        </ul>
      </details>

      <p class="notice">Result state: <span class="badge ${signalRiskBadge}">${signalCopy[signalKey].label}</span></p>
      <p><strong>Next step:</strong> compare the current-spend and post-quit scenarios, then decide whether the margin is enough for you personally.</p>

      <div class="results-actions">
        <a class="btn btn-primary" href="#quit-calculator-form">Run your numbers again</a>
        <a class="btn" href="articles/index.html">Read the guides</a>
      </div>
    `;

    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });

    event('calculator_complete', {
      runwayLean,
      runwayCurrent,
      signal: signalCopy[signalKey].label,
      constraint
    });
  });
})();
