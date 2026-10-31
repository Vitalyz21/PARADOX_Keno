const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const state = { picks: [], bet: 100, mode: "medium", balance: 0, paytables: null };
const $ = id => document.getElementById(id);
const initData = tg?.initData || "";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
function renderNumbers() {
  const grid = $("number-grid"); grid.innerHTML = "";
  for (let n = 1; n <= 40; n++) {
    const button = document.createElement("button");
    button.className = "number" + (state.picks.includes(n) ? " selected" : "");
    button.textContent = n;
    button.setAttribute("aria-pressed", state.picks.includes(n));
    button.addEventListener("click", () => {
      if (state.picks.includes(n)) state.picks = state.picks.filter(x => x !== n);
      else if (state.picks.length < 10) state.picks.push(n);
      else return toast("You can select up to 10 numbers.");
      renderNumbers();
    });
    grid.appendChild(button);
  }
  $("pick-count").textContent = state.picks.length;
}
function renderBet() {
  $("bet-value").textContent = state.bet.toLocaleString();
  document.querySelectorAll("[data-bet]").forEach(b => b.classList.toggle("chosen", Number(b.dataset.bet) === state.bet));
}
function renderTable() {
  $("table-mode").textContent = state.mode === "medium" ? "MEDIUM" : "PARADOX KILLER";
  const rows = $("paytable").querySelector("tbody"); rows.innerHTML = "";
  const count = Math.max(1, state.picks.length);
  const table = state.paytables?.[state.mode]?.[count] || {};
  const entries = Object.entries(table).sort((a,b) => Number(a[0])-Number(b[0]));
  if (!entries.length) {
    rows.innerHTML = '<tr><td colspan="2">Select numbers to see payouts.</td></tr>'; return;
  }
  entries.forEach(([hits, multiplier]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${hits} ${Number(hits) === 1 ? "hit" : "hits"}</td><td>${multiplier}×</td>`;
    rows.appendChild(tr);
  });
}
function renderBalance() { $("balance").textContent = `${Number(state.balance).toLocaleString()} USDP`; }
function renderHistory(items) {
  const target = $("history");
  if (!items?.length) { target.innerHTML = '<p class="empty-state">No rounds played yet.</p>'; return; }
  target.innerHTML = items.map(item => `
    <div class="history-item">
      <div><b>${item.mode === "medium" ? "Medium" : "Paradox Killer"} · ${item.hits} hits</b>
      <small>Bet ${item.bet} USDP · ${new Date(item.created_at + "Z").toLocaleString()}</small></div>
      <strong>${item.payout > item.bet ? "+" : ""}${item.payout - item.bet} USDP</strong>
    </div>`).join("");
}
function renderDraw(result) {
  $("round-status").textContent = result.payout > result.bet ? "WIN" : "ROUND COMPLETE";
  $("round-status").classList.toggle("win", result.payout > result.bet);
  const picked = new Set(result.picks);
  $("draw-grid").innerHTML = result.drawn.map(n =>
    `<span class="draw-ball ${picked.has(n) ? "hit" : ""}">${n}</span>`).join("");
  const outcome = result.payout > result.bet
    ? `You won ${result.payout.toLocaleString()} USDP · ${result.multiplier}× multiplier`
    : `No payout this round · ${result.hits} matching ${result.hits === 1 ? "number" : "numbers"}`;
  $("result-summary").textContent = `${outcome} · Net: ${result.net >= 0 ? "+" : ""}${result.net.toLocaleString()} USDP`;
}
async function load() {
  try {
    const data = await api("/api/me");
    state.balance = data.user.balance; state.paytables = data.paytables;
    renderBalance(); renderHistory(data.history); renderNumbers(); renderBet(); renderTable();
  } catch (err) {
    toast(err.message);
    $("result-summary").textContent = err.message;
  }
}
document.querySelectorAll(".mode").forEach(button => button.addEventListener("click", () => {
  state.mode = button.dataset.mode;
  document.querySelectorAll(".mode").forEach(b => b.classList.toggle("active", b === button));
  renderTable();
}));
$("clear").addEventListener("click", () => { state.picks = []; renderNumbers(); renderTable(); });
$("random").addEventListener("click", () => {
  const pool = Array.from({length:40}, (_,i) => i+1);
  state.picks = [];
  while (state.picks.length < 10) state.picks.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  renderNumbers(); renderTable();
});
$("bet-minus").addEventListener("click", () => { state.bet = Math.max(1, Math.floor(state.bet/2)); renderBet(); });
$("bet-plus").addEventListener("click", () => { state.bet = Math.min(10000, state.bet*2); renderBet(); });
document.querySelectorAll("[data-bet]").forEach(b => b.addEventListener("click", () => { state.bet = Number(b.dataset.bet); renderBet(); }));
$("play").addEventListener("click", async () => {
  if (!state.picks.length) return toast("Select at least one number first.");
  const button = $("play"); button.disabled = true; button.querySelector("span").textContent = "DRAWING…";
  try {
    const result = await api("/api/play", { method: "POST", body: JSON.stringify({ picks: state.picks, bet: state.bet, mode: state.mode }) });
    state.balance = result.balance; renderBalance(); renderDraw(result);
    const data = await api("/api/me"); renderHistory(data.history);
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred(result.payout > result.bet ? "success" : "warning");
  } catch (err) { toast(err.message); }
  finally { button.disabled = false; button.querySelector("span").textContent = "PLAY KENO"; }
});
load();
