# 2025 Loss Scenario Analyzer

This web app accepts a CSV of trades with columns:

- `Date`
- `Ticker`
- `Shares`
- `Price/Share ($)`

It filters to rows where the purchase date is in `2025`, then computes four scenarios:

- Sold on first day price was at least `5%` below purchase price
- Sold on first day price was at least `10%` below purchase price
- Sold on first day price was at least `15%` below purchase price
- Sold on first day price was at least `20%` below purchase price

For each scenario it reports:

- Total losses
- Number of sales triggered

## Run

```bash
node server.js
```

Then open `http://localhost:3000`.

## QA

Run the automated QA suite:

```bash
npm test
```

Manual UI checklist:

- [docs/qa-manual-checklist.md](/Users/daniellevy/Documents/Playground/docs/qa-manual-checklist.md)

## Feedback Log

After each analysis run, you can submit feedback in the UI.

- Feedback is appended to: `feedback.log` in the project root.
- To read it quickly:

```bash
cat feedback.log
```

## Tax Estimate Summary

The summary includes an estimated tax-savings table for the `10%` scenario loss across common U.S. federal marginal tax rates (`10%, 12%, 22%, 24%, 32%, 35%, 37%`).
These values are directional estimates only and not tax advice.

## Notes

- Historical daily prices are fetched from Stooq, with Yahoo Finance as automatic fallback if Stooq fails.
- Yahoo fallback includes automatic retry/backoff on rate-limit responses (`429`).
- Ticker price history is cached in memory (24h TTL, bounded entry count) to reduce repeated provider requests.
- If a ticker cannot be fetched, it will appear in warnings and those rows will not trigger sales.
- Tickers without an exchange suffix are treated as U.S. symbols (e.g., `AAPL` -> `aapl.us`).
