'use strict';
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join('/tmp', 'paradox-keno.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, balance REAL NOT NULL DEFAULT 1000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL,
    bet REAL NOT NULL, picks TEXT NOT NULL, drawn TEXT NOT NULL,
    risk TEXT NOT NULL, hits INTEGER NOT NULL, multiplier REAL NOT NULL,
    payout REAL NOT NULL, balance_after REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(player_id) REFERENCES players(id)
  );
  CREATE INDEX IF NOT EXISTS rounds_player_id_idx ON rounds(player_id, id DESC);
`);

const TABLES = {
  Classic: [
    [null,3.96],[null,1.90,4.50],[null,1.00,3.10,10.40],[null,0.80,1.80,5.00,22.50],
    [null,0.25,1.40,4.10,16.50,36.00],[0,1.00,3.68,7.00,16.50,40.00],
    [0,0.47,3.00,4.50,14.00,31.00,60.00],[0,0,2.20,4.00,13.00,22.00,55.00,70.00],
    [0,0,1.55,3.00,8.00,15.00,44.00,60.00,85.00],[0,0,1.40,2.25,4.50,8.00,17.00,50.00,80.00,100.00]
  ],
  Low: [
    [0.70,1.85],[0,2.00,3.80],[0,1.10,1.38,26.00],[0,0,2.20,7.90,90.00],
    [0,0,1.50,4.20,13.00,300.00],[0,0,1.10,2.00,6.20,100.00,700.00],
    [0,0,1.10,1.60,3.50,15.00,225.00,700.00],[0,0,1.10,1.50,2.00,5.50,39.00,100.00,800.00],
    [0,0,1.10,1.30,1.70,2.50,7.50,50.00,250.00,1000.00],
    [0,0,1.10,1.20,1.30,1.80,3.50,13.00,50.00,250.00,1000.00]
  ],
  Medium: [
    [0.40,2.75],[0,1.80,5.10],[0,0,2.80,50.00],[0,0,1.70,10.00,100.00],
    [0,0,1.40,4.00,14.00,390.00],[0,0,0,3.00,9.00,180.00,710.00],
    [0,0,0,2.00,7.00,30.00,400.00,800.00],[0,0,0,2.00,4.00,11.00,67.00,400.00,900.00],
    [0,0,0,2.00,2.50,5.00,15.00,100.00,500.00,1000.00],
    [0,0,0,1.60,2.00,4.00,7.00,26.00,100.00,500.00,1000.00]
  ],
  High: [
    [null,3.96],[0,0,17.10],[0,0,0,81.50],[0,0,0,10.00,259.00],
    [0,0,0,4.50,48.00,450.00],[0,0,0,0,11.00,350.00,710.00],
    [0,0,0,0,7.00,90.00,400.00,800.00],[0,0,0,0,5.00,20.00,270.00,600.00,900.00],
    [0,0,0,0,4.00,11.00,56.00,500.00,800.00,1000.00],
    [0,0,0,0,3.50,8.00,13.00,63.00,500.00,800.00,1000.00]
  ]
};

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '12kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const getPlayer = db.prepare('SELECT id, balance FROM players WHERE id = ?');
const createPlayer = db.prepare('INSERT OR IGNORE INTO players (id, balance) VALUES (?, 1000)');
const insertRound = db.prepare(`INSERT INTO rounds
  (player_id, bet, picks, drawn, risk, hits, multiplier, payout, balance_after)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const getHistory = db.prepare(`SELECT id, bet, picks, drawn, risk, hits, multiplier, payout, balance_after, created_at
  FROM rounds WHERE player_id = ? ORDER BY id DESC LIMIT 30`);
const updateBalance = db.prepare('UPDATE players SET balance = ? WHERE id = ? AND balance >= ?');
const ensurePlayer = id => { createPlayer.run(id); return getPlayer.get(id); };
const validPlayerId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
function drawNumbers() {
  const pool = Array.from({ length: 40 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 10).sort((a, b) => a - b);
}

// Lightweight per-player play throttle to prevent accidental rapid double taps.
const lastPlay = new Map();
app.get('/api/health', (_req, res) => res.json({ ok: true, game: 'PARADOX KENO' }));
app.get('/api/config', (_req, res) => res.json({ numbers: 40, drawCount: 10, minPicks: 1, maxPicks: 10, minBet: 0.1, maxBet: 1000, startingBalance: 1000 }));
app.get('/api/paytable', (_req, res) => res.json(TABLES));
app.get('/api/state', (req, res) => {
  const id = req.query.playerId;
  if (!validPlayerId(id)) return res.status(400).json({ error: 'Не удалось определить игрока. Обнови страницу.' });
  const player = ensurePlayer(id);
  res.json({ balance: player.balance, currency: 'USDP', history: getHistory.all(id) });
});
app.get('/api/history', (req, res) => {
  const id = req.query.playerId;
  if (!validPlayerId(id)) return res.status(400).json({ error: 'Неверный ID игрока' });
  ensurePlayer(id);
  res.json(getHistory.all(id));
});
app.post('/api/play', (req, res) => {
  const { playerId, picks, bet, risk } = req.body || {};
  if (!validPlayerId(playerId)) return res.status(400).json({ error: 'Не удалось определить игрока' });
  const now = Date.now();
  if (now - (lastPlay.get(playerId) || 0) < 650) return res.status(429).json({ error: 'Подожди мгновение перед следующим раундом' });
  if (!Array.isArray(picks) || picks.length < 1 || picks.length > 10 ||
      picks.some(n => !Number.isInteger(n) || n < 1 || n > 40) || new Set(picks).size !== picks.length)
    return res.status(400).json({ error: 'Выбери от 1 до 10 разных чисел' });
  if (typeof bet !== 'number' || !Number.isFinite(bet) || bet < 0.1 || bet > 1000 || Math.round(bet * 100) !== bet * 100)
    return res.status(400).json({ error: 'Ставка должна быть от 0.10 до 1 000.00 USDP' });
  if (!Object.hasOwn(TABLES, risk)) return res.status(400).json({ error: 'Неизвестный режим риска' });

  const player = ensurePlayer(playerId);
  if (player.balance < bet) return res.status(400).json({ error: 'Недостаточно виртуальных USDP' });
  const drawn = drawNumbers();
  const sortedPicks = [...picks].sort((a, b) => a - b);
  const hits = sortedPicks.filter(n => drawn.includes(n)).length;
  const multiplier = TABLES[risk][sortedPicks.length - 1][hits] ?? 0;
  const payout = round2(bet * multiplier);
  const newBalance = round2(player.balance - bet + payout);
  const saveRound = db.transaction(() => {
    const changed = updateBalance.run(newBalance, playerId, bet);
    if (!changed.changes) throw new Error('BALANCE_CHANGED');
    insertRound.run(playerId, bet, JSON.stringify(sortedPicks), JSON.stringify(drawn), risk, hits, multiplier, payout, newBalance);
  });
  try { saveRound(); } catch (e) {
    if (e.message === 'BALANCE_CHANGED') return res.status(409).json({ error: 'Баланс изменился. Обнови страницу и попробуй снова.' });
    throw e;
  }
  lastPlay.set(playerId, now);
  if (lastPlay.size > 5000) for (const [key, time] of lastPlay) if (now - time > 60000) lastPlay.delete(key);
  res.json({ drawn, hits, multiplier, payout, balance: newBalance, net: round2(payout - bet), picks: sortedPicks, risk });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`PARADOX KENO listening on ${PORT}`));
