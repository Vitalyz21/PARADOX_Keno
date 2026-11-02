"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "shuffle.sqlite");
const ADMIN_IDS = new Set((process.env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(Boolean));
const CLAIM_URL = process.env.CLAIM_URL || "https://shuffle.com/";
const GUIDE_URL = process.env.GUIDE_URL || "https://shuffle.com/";
const CLAIMER_BOT_URL = process.env.CLAIMER_BOT_URL || "https://t.me/";
const POLL_TIMEOUT = 25;

if (!BOT_TOKEN) console.warn("WARNING: BOT_TOKEN is not set; Telegram bot polling is disabled.");
if (!ADMIN_IDS.size) console.warn("WARNING: ADMIN_IDS is empty; no Telegram user can use /admin.");

require("fs").mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS subscribers (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  amount TEXT NOT NULL,
  claims TEXT NOT NULL,
  wager TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deliveries (
  promo_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (promo_id, user_id)
);
`);

app.get("/health", (_req, res) => res.json({ ok: true, service: "shuffle-promo-bot" }));
app.get("/", (_req, res) => res.type("text").send("Shuffle promo bot is running."));
app.listen(PORT, () => console.log(`HTTP health server listening on ${PORT}`));

const api = (method, body = {}) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
}).then(async r => {
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || `Telegram API ${method} failed`);
  return data.result;
});

const send = (chatId, text, extra = {}) =>
  api("sendMessage", { chat_id: chatId, text, ...extra });

const mainKeyboard = {
  inline_keyboard: [
    [{ text: "🎁 Claim", url: CLAIM_URL }],
    [{ text: "📘 Guide", url: GUIDE_URL }],
    [{ text: "🤖 Shuffle Code Claimer Bot", url: CLAIMER_BOT_URL }]
  ]
};

function isAdmin(id) { return ADMIN_IDS.has(String(id)); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function promoText(p) {
  return `🎁 <b>SHUFFLE PROMO CODE</b>\n\n` +
    `🎟 <b>Code:</b> <code>${escapeHtml(p.code)}</code>\n` +
    `💰 <b>Amount:</b> ${escapeHtml(p.amount)}\n` +
    `👥 <b>Claims:</b> ${escapeHtml(p.claims)}\n` +
    `🔄 <b>Wager:</b> ${escapeHtml(p.wager)}\n` +
    `⏳ <b>Expires:</b> ${escapeHtml(p.expires_at)}`;
}
const states = new Map();

async function askNext(chatId, userId, field) {
  const prompts = {
    code: "Отправь промокод (только текст).",
    amount: "Укажи сумму промокода.",
    claims: "Укажи количество Claims.",
    wager: "Укажи Wager.",
    expires_at: "Укажи срок действия (например: 2026-12-31 23:59 UTC)."
  };
  states.set(String(userId), { step: field, promo: states.get(String(userId))?.promo || {} });
  await send(chatId, prompts[field], { reply_markup: { force_reply: true } });
}
async function beginPromo(chatId, userId) {
  states.set(String(userId), { step: "code", promo: {} });
  await askNext(chatId, userId, "code");
}
async function publishPromo(chatId, userId, promoId) {
  const promo = db.prepare("SELECT * FROM promos WHERE id=?").get(promoId);
  if (!promo) return send(chatId, "Промокод не найден.");
  if (promo.published) return send(chatId, "Этот промокод уже опубликован.");
  const users = db.prepare("SELECT user_id FROM subscribers WHERE active=1").all();
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await send(u.user_id, promoText(promo), {
        parse_mode: "HTML",
        reply_markup: mainKeyboard,
        disable_web_page_preview: true
      });
      db.prepare("INSERT OR IGNORE INTO deliveries(promo_id,user_id) VALUES(?,?)").run(promoId, u.user_id);
      sent++;
      await new Promise(resolve => setTimeout(resolve, 45));
    } catch (e) {
      failed++;
      if (/blocked|deactivated|chat not found/i.test(e.message)) {
        db.prepare("UPDATE subscribers SET active=0 WHERE user_id=?").run(u.user_id);
      }
      console.error("Delivery failed:", u.user_id, e.message);
    }
  }
  db.prepare("UPDATE promos SET published=1 WHERE id=?").run(promoId);
  await send(chatId, `✅ Публикация завершена.\nОтправлено: ${sent}\nОшибок: ${failed}\nПолучателей в базе: ${users.length}`);
}
async function handleMessage(m) {
  if (!m || !m.chat || !m.from) return;
  const chatId = m.chat.id, userId = String(m.from.id);
  const text = (m.text || "").trim();

  if (text === "/start" || text.startsWith("/start ")) {
    db.prepare(`INSERT INTO subscribers(user_id,username,first_name,active)
      VALUES(?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,
      first_name=excluded.first_name,active=1`).run(userId, m.from.username || "", m.from.first_name || "");
    await send(chatId, "Добро пожаловать! Здесь публикуются Shuffle-промокоды.\n\nНажми Claim, чтобы перейти к активации. Новые публикации будут приходить сюда.", {
      reply_markup: mainKeyboard, disable_web_page_preview: true
    });
    return;
  }

  if (text === "/admin") {
    if (!isAdmin(userId)) return send(chatId, "⛔ Нет доступа.");
    const count = db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE active=1").get().n;
    await send(chatId, `🛠 <b>Панель администратора</b>\nАктивных подписчиков: ${count}`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "➕ Добавить промокод", callback_data: "promo:add" }],
        [{ text: "📋 Последние промокоды", callback_data: "promo:list" }]
      ]}
    });
    return;
  }

  const state = states.get(userId);
  if (state && isAdmin(userId) && text && !text.startsWith("/")) {
    const fields = ["code", "amount", "claims", "wager", "expires_at"];
    const currentIndex = fields.indexOf(state.step);
    state.promo[state.step] = text.slice(0, 300);
    const next = fields[currentIndex + 1];
    if (next) {
      states.set(userId, state);
      await askNext(chatId, userId, next);
    } else {
      const p = state.promo;
      const result = db.prepare(`INSERT INTO promos(code,amount,claims,wager,expires_at,created_by)
        VALUES(?,?,?,?,?,?)`).run(p.code, p.amount, p.claims, p.wager, p.expires_at, userId);
      states.delete(userId);
      const promo = db.prepare("SELECT * FROM promos WHERE id=?").get(result.lastInsertRowid);
      await send(chatId, `Проверь публикацию:\n\n${promoText(promo)}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [
          [{ text: "🚀 Опубликовать подписчикам", callback_data: `promo:publish:${promo.id}` }],
          [{ text: "❌ Отменить", callback_data: "promo:cancel" }]
        ]}
      });
    }
    return;
  }
}
async function handleCallback(q) {
  const userId = String(q.from.id), chatId = q.message?.chat?.id;
  await api("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  if (!chatId) return;
  const data = q.data || "";
  if (!isAdmin(userId)) return send(chatId, "⛔ Нет доступа.");
  if (data === "promo:add") return beginPromo(chatId, userId);
  if (data === "promo:cancel") {
    states.delete(userId);
    return send(chatId, "Добавление отменено.");
  }
  if (data === "promo:list") {
    const rows = db.prepare("SELECT id,code,published,created_at FROM promos ORDER BY id DESC LIMIT 10").all();
    if (!rows.length) return send(chatId, "Промокодов пока нет.");
    return send(chatId, rows.map(p => `#${p.id} ${p.code} — ${p.published ? "опубликован" : "черновик"} (${p.created_at})`).join("\n"));
  }
  const match = data.match(/^promo:publish:(\d+)$/);
  if (match) return publishPromo(chatId, userId, Number(match[1]));
}
async function poll() {
  let offset = 0;
  while (true) {
    try {
      const updates = await api("getUpdates", { offset, timeout: POLL_TIMEOUT, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          if (u.message) await handleMessage(u.message);
          if (u.callback_query) await handleCallback(u.callback_query);
        } catch (e) { console.error("Update handler error:", e); }
      }
    } catch (e) {
      console.error("Telegram polling error:", e.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}
if (BOT_TOKEN) poll();

process.on("SIGTERM", () => { try { db.close(); } finally { process.exit(0); } });
