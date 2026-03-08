# QA Manual Checklist

## UI End-to-End

1. Start app with `node server.js` and open `http://localhost:3000`.
2. Confirm details section is hidden on initial load.
3. Click Analyze without selecting a file and verify status shows: `Select a CSV file first.`
4. Upload a valid CSV and click Analyze.
5. Verify status transitions from `Analyzing...` to `Analysis complete.`
6. Verify summary table contains exactly `5%`, `10%`, `15%`, and `20%` scenario rows.
7. Verify totals and sale counts match expected values for the fixture used.
8. Verify warnings appear when CSV includes malformed rows or unresolved tickers.
9. Verify details section becomes visible after analysis and only includes triggered scenarios.
10. Force an API error (for example malformed request in devtools) and verify UI status shows the returned error.

## Responsive Sanity

1. Resize viewport to ~390px width (mobile).
2. Confirm upload controls remain usable and button is accessible.
3. Confirm summary and details tables remain readable and no critical text is clipped.

## Release Gate

1. Run automated suite: `node --test`.
2. Confirm all tests pass.
3. Complete this manual checklist with no blockers.
4. Block release if there is any mismatch in year filtering, threshold trigger dates, `saleCount`, or `totalLoss`.
