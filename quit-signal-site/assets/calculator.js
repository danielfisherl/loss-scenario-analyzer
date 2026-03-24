document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('timeoff-calculator-form');
  const results = document.getElementById('results');
  if (!form || !results) return;

  const el = (id) => document.getElementById(id);
  const savingsEl = el('savings');
  const oneTimeInflowEl = el('oneTimeInflow');
  const monthlyLivingExpensesEl = el('monthlyLivingExpenses');
  const healthcareCostEl = el('healthcareCost');
  const monthlyIncomeDuringBreakEl = el('monthlyIncomeDuringBreak');
  const useReducedSpendEl = el('useReducedSpend');
  const reducedMonthlyLivingExpensesEl = el('reducedMonthlyLivingExpenses');
  const reducedSpendBlock = el('reducedSpendBlock');
  const breakLengthEl = el('breakLength');
  const customMonthsWrap = el('customMonthsWrap');
  const customBreakMonthsEl = el('customBreakMonths');
  const emergencyBufferEl = el('emergencyBuffer');
  const annualReturnEl = el('annualReturn');
  const presetButtons = Array.from(document.querySelectorAll('.preset-chip'));

  const moneyFmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const pctFmt = new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  });

  function money(value) {
    return moneyFmt.format(Number.isFinite(value) ? value : 0);
  }

  function months(value) {
    if (!Number.isFinite(value)) return '99+ months';
    return `${value.toFixed(1)} months`;
  }

  function track(name, payload = {}) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, payload);
    }
  }

  function getBreakMonths() {
    if (breakLengthEl.value === 'custom') {
      return Math.max(1, Number(customBreakMonthsEl.value) || 1);
    }
    return Math.max(1, Number(breakLengthEl.value) || 12);
  }

  function getMonthlyBurn() {
    const standardSpend = Math.max(0, Number(monthlyLivingExpensesEl.value) || 0);
    const reducedSpend = Math.max(0, Number(reducedMonthlyLivingExpensesEl.value) || 0);
    return useReducedSpendEl.checked ? reducedSpend : standardSpend;
  }

  function updateBreakUI() {
    customMonthsWrap.hidden = breakLengthEl.value !== 'custom';
    presetButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.break === breakLengthEl.value);
    });
  }

  function updateReducedSpendUI() {
    reducedSpendBlock.hidden = !useReducedSpendEl.checked;
  }

  function projectBalance(startBalance, monthlyCost, monthlyIncome, monthlyReturn, breakMonths) {
    let balance = startBalance;
    for (let i = 0; i < breakMonths; i += 1) {
      balance = balance * (1 + monthlyReturn);
      balance += monthlyIncome;
      balance -= monthlyCost;
    }
    return balance;
  }

  function runwayUntilBuffer(startBalance, monthlyCost, monthlyIncome, monthlyReturn, bufferTarget) {
    if (monthlyIncome + startBalance * monthlyReturn >= monthlyCost) {
      return Infinity;
    }

    let balance = startBalance;
    let monthsElapsed = 0;
    const maxMonths = 600;

    while (monthsElapsed < maxMonths && balance > bufferTarget) {
      balance = balance * (1 + monthlyReturn);
      balance += monthlyIncome;
      balance -= monthlyCost;
      monthsElapsed += 1;
    }

    return monthsElapsed;
  }

  function chooseState({ covered, monthlyShortfall, monthsAboveTarget, safeRunway }) {
    if (!covered) {
      return {
        key: 'notyet',
        label: 'Not yet',
        short: 'The target break is longer than the safety margin your current plan supports.',
        long:
          'The break may still be possible, but this version of the plan is too close to the edge to treat as comfortably funded. Lower burn, more income during the break, or more savings would help.',
      };
    }

    if (monthlyShortfall <= 0 || monthsAboveTarget >= 3 || safeRunway === Infinity) {
      return {
        key: 'strong',
        label: 'Strong time-off signal',
        short: 'Your break is likely covered with room to spare.',
        long:
          'The plan survives after preserving the buffer. That usually means the choice is more about timing and comfort with uncertainty than about whether the break is financially possible.',
      };
    }

    return {
      key: 'risky',
      label: 'Possible but tight',
      short: 'The break appears feasible, but the margin is thin.',
      long:
        'You can probably make the break work, but the numbers do not leave much slack. A small change in spending, healthcare, or timing could move the answer.',
    };
  }

  function buildInsights({
    monthlyCost,
    monthlyIncome,
    monthlyShortfall,
    useReducedSpend,
    reducedSpendDelta,
    bufferTarget,
    breakMonths,
    endingBalance,
  }) {
    const bullets = [];

    if (monthlyShortfall > 0) {
      bullets.push(
        `Your net monthly burn is ${money(monthlyShortfall)}. Cutting ${money(1000)} from monthly spending would add about ${(1000 / monthlyShortfall).toFixed(1)} months of runway.`
      );
    } else {
      bullets.push('Your monthly break income covers the planned monthly costs, so the break is not relying on cash alone.');
    }

    if (monthlyIncome > 0) {
      bullets.push(
        `Break income covers about ${pctFmt.format(monthlyIncome / Math.max(monthlyCost, 1))} of your monthly break costs.`
      );
    } else {
      bullets.push('You are not assuming any income during the break, so savings has to do all the work.');
    }

    if (useReducedSpend && reducedSpendDelta > 0) {
      bullets.push(
        `The reduced-spend scenario lowers monthly outflow by ${money(reducedSpendDelta)}, which gives the break more room.`
      );
    } else {
      const bufferMonths = bufferTarget / Math.max(monthlyCost, 1);
      bullets.push(
        `Your emergency buffer reserves about ${bufferMonths.toFixed(1)} months of living costs before the break budget is fully used.`
      );
    }

    if (endingBalance > bufferTarget) {
      bullets.push(
        `After the target break, you still have about ${((endingBalance - bufferTarget) / Math.max(monthlyCost, 1)).toFixed(1)} months of cushion beyond the reserved buffer.`
      );
    }

    return bullets.slice(0, 3);
  }

  function renderResult({
    resultState,
    breakMonths,
    startBalance,
    monthlyCost,
    monthlyIncome,
    monthlyShortfall,
    bufferTarget,
    endingBalance,
    safeRunway,
    annualReturn,
    useReducedSpend,
    reducedSpendDelta,
  }) {
    const covered = endingBalance >= bufferTarget;
    const monthsAboveTarget = (endingBalance - bufferTarget) / Math.max(monthlyCost, 1);
    const insights = buildInsights({
      monthlyCost,
      monthlyIncome,
      monthlyShortfall,
      useReducedSpend,
      reducedSpendDelta,
      bufferTarget,
      breakMonths,
      endingBalance,
    });

    const statusClass = resultState.key;
    const direction = monthlyShortfall > 0 ? 'shortfall' : 'surplus';
    const runwayText = safeRunway === Infinity ? '99+ months' : months(safeRunway);
    const safetyMarginText = months(Math.max(monthsAboveTarget, 0));
    const endingBalanceText = money(Math.max(endingBalance, 0));
    const shortfallText =
      monthlyShortfall > 0
        ? `${money(monthlyShortfall)} monthly shortfall`
        : `${money(Math.abs(monthlyShortfall))} monthly surplus`;

    const interpretation = covered
      ? resultState.key === 'strong'
        ? [
            'The break is financially workable after preserving the buffer.',
            'At this point the decision is mostly about timing, preference, and how much margin you want to keep when you return.',
          ]
        : [
            'The break looks possible, but the plan is still close enough to the edge that you should pay attention to the variables that move the answer.',
            'A small reduction in spending or a small increase in income during the break can matter here.',
          ]
      : [
          'The break is not fully funded once the buffer is preserved.',
          'That usually means the next step is to lower burn, wait for more cash, or shorten the break length.',
        ];

    results.hidden = false;
    results.innerHTML = `
      <section class="signal-panel ${statusClass}">
        <div class="signal-label">Result</div>
        <h2 class="signal-name">${resultState.label}</h2>
        <p class="signal-short">${resultState.short}</p>
        <p class="signal-long">${resultState.long}</p>
        <p class="signal-disclaimer">Directional only. This tool simplifies taxes, inflation, market volatility, and real-life surprises.</p>
      </section>

      <section class="interpretation-box">
        <span class="kicker">What this means</span>
        <h3>What this actually means</h3>
        <p>${interpretation[0]}</p>
        <p>${interpretation[1]}</p>
      </section>

      <ul class="insight-list">
        ${insights.map((item) => `<li>${item}</li>`).join('')}
      </ul>

      <div class="result-grid">
        <div class="stat">
          <div class="label">Estimated runway</div>
          <div class="value">${runwayText}</div>
          <p class="form-hint">Runway is measured against the reserve you chose to keep.</p>
        </div>
        <div class="stat">
          <div class="label">Target break covered?</div>
          <div class="value">${covered ? 'Yes' : 'No'}</div>
          <p class="form-hint">Target break: ${breakMonths} month${breakMonths === 1 ? '' : 's'}.</p>
        </div>
        <div class="stat">
          <div class="label">Ending savings after break</div>
          <div class="value">${endingBalanceText}</div>
          <p class="form-hint">${covered ? 'Above the buffer target.' : 'Below the buffer target.'}</p>
        </div>
        <div class="stat">
          <div class="label">Monthly ${direction}</div>
          <div class="value">${shortfallText}</div>
          <p class="form-hint">Living costs, healthcare, and break income all feed into this number.</p>
        </div>
        <div class="stat">
          <div class="label">Safety margin</div>
          <div class="value">${safetyMarginText}</div>
          <p class="form-hint">${covered ? 'Extra room beyond the target break.' : 'Negative means the break falls short of the buffer.'}</p>
        </div>
        <div class="stat">
          <div class="label">Emergency buffer impact</div>
          <div class="value">${money(bufferTarget)}</div>
          <p class="form-hint">A reserve of ${money(bufferTarget)} is being held back before the break is treated as safe.</p>
        </div>
      </div>

      <details class="why-details">
        <summary>Why this result?</summary>
        <ul class="list">
          <li>Starting balance: ${money(startBalance)}</li>
          <li>Monthly break cost used: ${money(monthlyCost)}</li>
          <li>Income during break: ${money(monthlyIncome)}</li>
          <li>Annual return assumption: ${pctFmt.format(annualReturn / 100)}</li>
          <li>Break length modeled: ${breakMonths} month${breakMonths === 1 ? '' : 's'}</li>
          <li>Buffer reserved: ${money(bufferTarget)}</li>
        </ul>
      </details>

      <div class="results-actions">
        <a class="btn btn-primary" href="calculator.html">Recalculate</a>
        <a class="btn" href="articles/index.html">Read related guides</a>
      </div>
    `;

    track('calculator_complete', {
      result_state: resultState.key,
      break_months: breakMonths,
      safe_runway_months: Number.isFinite(safeRunway) ? safeRunway : 999,
    });
  }

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      breakLengthEl.value = button.dataset.break;
      updateBreakUI();
      if (button.dataset.break === 'custom') {
        customBreakMonthsEl.focus();
      }
    });
  });

  breakLengthEl.addEventListener('change', updateBreakUI);
  useReducedSpendEl.addEventListener('change', updateReducedSpendUI);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    track('calculator_start');

    const savings = Math.max(0, Number(savingsEl.value) || 0);
    const oneTimeInflow = Math.max(0, Number(oneTimeInflowEl.value) || 0);
    const monthlyLivingExpenses = Math.max(0, Number(monthlyLivingExpensesEl.value) || 0);
    const healthcareCost = Math.max(0, Number(healthcareCostEl.value) || 0);
    const monthlyIncomeDuringBreak = Math.max(0, Number(monthlyIncomeDuringBreakEl.value) || 0);
    const annualReturn = Math.max(0, Number(annualReturnEl.value) || 0);
    const monthlyReturn = annualReturn / 100 / 12;
    const breakMonths = getBreakMonths();
    const monthlyBurn = getMonthlyBurn();
    const monthlyCost = monthlyBurn + healthcareCost;
    const monthlyShortfall = monthlyCost - monthlyIncomeDuringBreak;
    const reducedSpend = Math.max(0, Number(reducedMonthlyLivingExpensesEl.value) || 0);
    const reducedSpendDelta = useReducedSpendEl.checked
      ? Math.max(0, monthlyLivingExpenses - reducedSpend)
      : 0;
    const bufferTarget = Math.max(0, Number(emergencyBufferEl.value) || 0) || monthlyCost * 3;
    const startBalance = savings + oneTimeInflow;
    const endingBalance = projectBalance(
      startBalance,
      monthlyCost,
      monthlyIncomeDuringBreak,
      monthlyReturn,
      breakMonths
    );
    const safeRunway = runwayUntilBuffer(
      startBalance,
      monthlyCost,
      monthlyIncomeDuringBreak,
      monthlyReturn,
      bufferTarget
    );
    const covered = endingBalance >= bufferTarget;
    const monthsAboveTarget = (endingBalance - bufferTarget) / Math.max(monthlyCost, 1);
    const resultState = chooseState({
      covered,
      monthlyShortfall,
      monthsAboveTarget,
      safeRunway,
    });

    renderResult({
      resultState,
      breakMonths,
      startBalance,
      monthlyCost,
      monthlyIncome: monthlyIncomeDuringBreak,
      monthlyShortfall,
      bufferTarget,
      endingBalance,
      safeRunway,
      annualReturn,
      useReducedSpend: useReducedSpendEl.checked,
      reducedSpendDelta,
    });
  });

  updateBreakUI();
  updateReducedSpendUI();
});
