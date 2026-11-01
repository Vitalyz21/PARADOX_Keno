# PARADOX Keno Telegram Mini App

Russian-language responsive Keno Mini App with a dark emerald/gold PARADOX-inspired interface.

## Included
- 40-number board; choose 1–10 unique numbers.
- Server-side draw of 10 unique numbers using Node.js `crypto.randomInt`.
- Medium and Paradox Killer payout tables.
- SQLite balance and round history.
- Fictional DEMO credits only; no deposits, transfers, withdrawals or cash prizes.
- Responsive mobile layout.

## Deploy to Render
1. Push the contents of this folder to the GitHub repository root.
2. In Render create a Blueprint from the repository (`render.yaml`).
3. Set `BOT_TOKEN` in Render Environment to the Telegram bot token. Keep it secret.
4. Deploy and wait for `/health` to return `{"ok":true}`.
5. In @BotFather use `/setmenubutton` and set the Mini App URL to the Render HTTPS URL.

Node.js 20+ is required. Render persistent disk is mounted at `/var/data`.

## Local
`npm install` then `npm start`. Open `http://localhost:3000` with `NODE_ENV` not set to production to use the local test account.

New users start with 100 DEMO credits. Existing database balances are preserved during deploys; changing the default does not reset existing accounts.
