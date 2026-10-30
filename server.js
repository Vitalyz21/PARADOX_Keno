"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const DB_PATH = process.env.DB_PATH || "./keno.sqlite";
const db = new Database(DB_PATH);

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    balance INTEGER NOT NULL DEFAULT 10000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    bet INTEGER NOT NULL,
    picks TEXT NOT NULL,
    drawn TEXT NOT NULL,
    hits INTEGER NOT NULL,
    multiplier REAL NOT NULL,
    payout INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS rounds_user_idx ON rounds(user_id, id DESC);
`);

// Multipliers are fictional game rules, not cash odds.
// 10-pick values preserve the agreed values. 1–9 pick schedules are starter
// values and can be tuned in this one file before launch.
const PAYTABLES = {
  medium: {
    1: {1: 3.5},
    2: {2: 12},
    3: {2: 2, 3: 45},
    4: {2: 1.2, 3: 8, 4: 100},
    5: {3: 2, 4: 15, 5: 250},
    6: {3: 1.5, 4: 5, 5: 40, 6: 400},
    7: {3: 1, 4: 3, 5: 12, 6: 100, 7: 500},
    8: {3: 1, 4: 2.5, 5: 8, 6: 30, 7: 200, 8: 700},
    9: {4: 2, 5: 5, 6: 20, 7: 100, 8: 400, 9: 900},
    10: {4: 3.5, 5: 8, 6: 13, 7: 63, 8: 500, 9: 800, 10: 1000}
  },
  paradox_killer: {
    1: {1: 2.8},
    2: {2: 8},
    3: {2: 1.8, 3: 30},
    4: {2: 1, 3: 6, 4: 60},
    5: {3: 1.8, 4: 10, 5: 120},
    6: {3: 1.3, 4: 4, 5: 25, 6: 200},
    7: {3: 1, 4: 2.5, 5: 8, 6: 50, 7: 300},
    8: {3: 1, 4: 2, 5: 6, 6: 20, 7: 100, 8: 500},
    9: {4: 1.5, 5: 4, 6: 15, 7: 60, 8: 250, 9: 700},
    10: {3: 1.6, 4: 2, 5: 4, 6: 7, 7: 26, 8: 100, 9: 500, 10: 1000}
  }
};

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) return null;
  if (!initData || typeof initData !== "string") return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const user = JSON.parse(params.get("user") || "{}");
    if (!user.id) return null;
    return {
      id: String(user.id),
      username: user.username || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Player"
    };
  } catch {
    return null;
  }
}

function getIdentity(req) {
  const verified = verifyTelegramInitData(req.get("x-telegram-init-data") || "");
  if (verified) return verified;

  // Browser preview works without a bot token. Production Telegram use should
  // always set BOT_TOKEN in Render so requests are bound to verified Telegram users.
  if (!BOT_TOKEN && process.env.NODE_ENV !== "production") {
    return { id: process.env.DEV_USER_ID || "local-player", username: "Local Player" };
  }
  return null;
}

function requireUser(req, res, next) {
  const identity = getIdentity(req);
  if (!identity) {
    return res.status(401).json({ error: "Open this game from its Telegram bot." });
  }
  db.prepare(`
    INSERT INTO users(user_id, username) VALUES(?, ?)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username
  `).run(identity.id, identity.username);
  req.player = identity;
  next();
}

function getUser(userId) {
  return db.prepare("SELECT user_id, username, balance FROM users WHERE user_id=?").get(userId);
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/me", requireUser, (req, res) => {
  const user = getUser(req.player.id);
  const history = db.prepare(`
    SELECT id, mode, bet, picks, drawn, hits, multiplier, payout, created_at
    FROM rounds WHERE user_id=? ORDER BY id DESC LIMIT 12
  `).all(req.player.id).map(row => ({
    ...row, picks: JSON.parse(row.picks), drawn: JSON.parse(row.drawn)
  }));
  res.json({ user, history, paytables: PAYTABLES });
});

app.post("/api/play", requireUser, (req, res) => {
  const { picks, bet, mode } = req.body || {};
  if (!Array.isArray(picks) || picks.length < 1 || picks.length > 10 ||
      picks.some(n => !Number.isInteger(n) || n < 1 || n > 40) ||
      new Set(picks).size !== picks.length) {
    return res.status(400).json({ error: "Choose 1–10 different numbers from 1 to 40." });
  }
  if (!Number.isInteger(bet) || bet < 1 || bet > 10000) {
    return res.status(400).json({ error: "Bet must be between 1 and 10,000 USDP." });
  }
  if (!Object.hasOwn(PAYTABLES, mode)) {
    return res.status(400).json({ error: "Unknown game mode." });
  }

  const play = db.transaction(() => {
    const user = getUser(req.player.id);
    if (!user || user.balance < bet) throw new Error("Not enough USDP credits.");

    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const drawn = [];
    for (let i = 0; i < 10; i++) {
      const j = crypto.randomInt(pool.length);
      drawn.push(pool.splice(j, 1)[0]);
    }
    drawn.sort((a, b) => a - b);

    const sortedPicks = [...picks].sort((a, b) => a - b);
    const hits = sortedPicks.filter(n => drawn.includes(n)).length;
    const multiplier = PAYTABLES[mode][sortedPicks.length][hits] || 0;
    const payout = Math.floor(bet * multiplier);
    const balance = user.balance - bet + payout;

    db.prepare("UPDATE users SET balance=? WHERE user_id=?").run(balance, req.player.id);
    const result = db.prepare(`
      INSERT INTO rounds(user_id, mode, bet, picks, drawn, hits, multiplier, payout)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.player.id, mode, bet, JSON.stringify(sortedPicks),
      JSON.stringify(drawn), hits, multiplier, payout);

    return {
      id: result.lastInsertRowid, picks: sortedPicks, drawn, hits,
      multiplier, payout, net: payout - bet, balance, bet, mode
    };
  });

  try {
    res.json(play());
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not play this round." });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`Keno Mini App listening on port ${PORT}`);
});
