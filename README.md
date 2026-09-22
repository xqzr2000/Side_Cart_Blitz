# WiseShelf — Production Revision

WiseShelf is a Manifest V3 browser side-panel that detects shopping intent, maintains a user-controlled monthly budget ledger, and provides optional AI-assisted purchase analysis.

## Architecture

The system has two isolated layers:

- **Browser extension:** product detection, local budget/bill storage, responsive side-panel UI, purchase confirmation, and explicit assessment requests.
- **Node 22 backend:** authentication, rate limiting, validation, deterministic budget calculations, TypeSafe Jev structured judgments, and optional OpenRouter conversational agents.

Provider API keys never belong in the extension.

## Why Jev

The TypeSafe integration uses one System One request containing several small independent questions. Jev classifies spending type, estimates duplicate-item likelihood, and scores whether a cooling-off delay may be useful. Those outputs are supporting signals only. Affordability itself is calculated deterministically in code from the user's own budget, confirmed purchases, and entered bills.

If `TYPESAFE_API_KEY` is absent or the provider is unavailable, WiseShelf continues to return deterministic budget risk.

## Correct purchase lifecycle

Merchant checkout buttons do not prove that a payment succeeded. WiseShelf therefore uses:

`considering → pending checkout → user-confirmed bought`

Only `bought` items count toward confirmed spend.

## Responsive extension UI

The side panel uses CSS container queries and fluid sizing rather than a fixed desktop layout:

- narrow panels collapse metrics and item metadata without horizontal scrolling;
- standard side-panel widths show a dense ledger layout;
- wide/detached panels expand to four metrics and, when useful, two item columns;
- dialogs and bill inputs stack at narrow widths;
- chat remains full-height with a stable composer.

## Local setup

```bash
cp .env.example .env
npm run verify
npm start
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension/` directory.

The default backend is `http://localhost:8787`.

## Provider configuration

For chat:

```text
OPENROUTER_API_KEY=...
```

For TypeSafe Jev structured assessments:

```text
TYPESAFE_API_KEY=...
TYPESAFE_MODEL=jev-latest
```

When exposing the backend beyond localhost, also configure a strong `APP_SHARED_SECRET` and use HTTPS.

## Verification

`npm run verify` performs syntax checks over backend and extension JavaScript and runs the Node test suite. Tests cover budget accounting, malformed-state sanitization, deterministic purchase risk, Jev fallback behavior, and the Jev request/response contract.
