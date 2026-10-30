# Keno Telegram Mini App

A deployable Telegram Mini App with:
- 40-number board; player selects 1–10 numbers.
- 10 numbers drawn per round using Node's cryptographic random generator.
- Medium and Paradox Killer modes with separate payout tables.
- Server-side balance, round validation, and SQLite history.
- Fictional USDP play credits only. They have no monetary value and cannot be bought, sold, transferred, redeemed, or withdrawn.

## 1. Create the GitHub repository

Recommended repository settings:
- Public or Private: either works.
- README: On.
- `.gitignore`: Node.
- License: No license (unless you want to add one later).

Upload the contents of this project folder to the repository root. Do not upload the ZIP itself as the only file.

## 2. Deploy on Render

1. Push these files to GitHub.
2. In Render, choose **New → Blueprint** and select the repository.
3. Render reads `render.yaml`, installs dependencies, and starts the app.
4. Wait for the service to become Live. Your URL will look like `https://your-service.onrender.com`.
5. In the Render service's Environment settings, set `BOT_TOKEN` to the token from your Telegram bot (created with @BotFather). Keep this token private.
6. Redeploy after adding the token.

The included Render Blueprint creates a persistent disk at `/var/data` for SQLite. Do not remove it if you want balances and history to survive deploys.

## 3. Connect Telegram

1. Open @BotFather and create a bot with `/newbot`, or use your existing bot.
2. In BotFather, use `/setmenubutton` and select your bot.
3. Set the button URL to your Render HTTPS URL.
4. Set the Mini App URL/domain as requested by BotFather if prompted.
5. Open the bot and tap its menu button.

Telegram sends signed Mini App data to the backend. The backend verifies it using `BOT_TOKEN`; it does not trust a user ID supplied by the browser.

## 4. Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open `http://localhost:3000`. Local browser preview uses a local test account when `BOT_TOKEN` is not set. For production, set `BOT_TOKEN` in Render.

## Game rules

- Numbers: 1–40.
- Choose: 1–10 unique numbers.
- Draw: 10 unique numbers.
- Payout: `bet × multiplier`; otherwise payout is 0.
- Balance: starts at 10,000 fictional USDP credits.

The 10-pick schedules are:
- Medium: 4 hits 3.5×, 5 hits 8×, 6 hits 13×, 7 hits 63×, 8 hits 500×, 9 hits 800×, 10 hits 1000×.
- Paradox Killer: 3 hits 1.6×, 4 hits 2×, 5 hits 4×, 6 hits 7×, 7 hits 26×, 8 hits 100×, 9 hits 500×, 10 hits 1000×.

The 1–9 pick schedules are starter values and can be adjusted in `server.js` under `PAYTABLES`. All multipliers are game-only rules and do not represent financial odds or prizes.

## Important configuration

- `BOT_TOKEN`: required for verified Telegram identity in production.
- `DB_PATH`: database location. Render Blueprint uses `/var/data/keno.sqlite`.
- Initial balance is set in the `users` table default in `server.js` (`10000`).

## Project structure

```text
.
├── server.js
├── package.json
├── render.yaml
├── .env.example
├── .gitignore
└── public
    ├── index.html
    ├── style.css
    └── app.js
```
