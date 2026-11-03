'use strict';
const $ = id => document.getElementById(id);
const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
let playerId = localStorage.getItem('paradoxKenoPlayer');
if (!playerId || !/^[a-f0-9-]{36}$/i.test(playerId)) { playerId = uuid(); localStorage.setItem('paradoxKenoPlayer', playerId); }
let risk = 'Classic', picks = [], balance = 1000, tables = {}, isPlaying = false, soundOn = false, audioCtx = null, lastDrawn = [];

function toast(message) {
  const node = $('toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data; try { data = await response.json(); } catch { throw new Error('Сервер вернул некорректный ответ'); }
  if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}
function setBalance(value) { balance = value; $('balance').innerHTML = `${money(balance)} <i>USDP</i>`; }
function currentBet() { return Number($('bet').value); }
function validBet() { const bet = currentBet(); return Number.isFinite(bet) && bet >= .1 && bet <= 1000 && Math.round(bet * 100) === bet * 100; }
function multiplierFor(hit, count = picks.length) { return tables[risk]?.[count - 1]?.[hit] ?? 0; }
function playTone(freq = 600, duration = .07, type = 'sine', volume = .035) {
  if (!soundOn) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration);
  } catch { /* Audio is optional; game functionality does not depend on it. */ }
}
function renderGrid(resetDraw = false) {
  const grid = $('grid'); grid.innerHTML = '';
  for (let n = 1; n <= 40; n++) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'num'; button.textContent = n; button.setAttribute('aria-label', `Число ${n}`);
    if (picks.includes(n)) { button.classList.add('selected'); button.setAttribute('aria-pressed', 'true'); } else button.setAttribute('aria-pressed', 'false');
    if (!resetDraw && lastDrawn.includes(n)) button.classList.add(picks.includes(n) ? 'hit' : 'draw-reveal');
    button.disabled = isPlaying;
    button.addEventListener('click', () => togglePick(n));
    grid.appendChild(button);
  }
  $('pickCount').innerHTML = `${picks.length} <i>/ 10</i>`;
  $('pickMeter').style.width = `${picks.length * 10}%`;
  $('selectedPreview').innerHTML = picks.length ? [...picks].sort((a,b) => a-b).map(n => `<span class="preview-chip">${n}</span>`).join('') : '<span>Выбери от 1 до 10 чисел на поле</span>';
  $('gridStatus').textContent = isPlaying ? 'ИДЁТ РОЗЫГРЫШ' : picks.length ? `${picks.length} ЧИСЕЛ ВЫБРАНО` : 'ОЖИДАНИЕ ВЫБОРА';
}
function togglePick(n) {
  if (isPlaying) return;
  if (picks.includes(n)) picks = picks.filter(x => x !== n);
  else if (picks.length < 10) { picks.push(n); playTone(520, .045); }
  else return toast('Максимум — 10 чисел');
  lastDrawn = []; $('roundPanel').classList.remove('round-flash');
  renderGrid(true); renderPotential(); renderPaytable();
}
function renderPotential() {
  const bet = currentBet();
  if (!picks.length || !validBet()) {
    $('potential').textContent = '—'; $('potentialHint').textContent = !picks.length ? 'Выбери числа, чтобы увидеть максимум' : 'Проверь размер ставки'; return;
  }
  const row = tables[risk][picks.length - 1] || [];
  const values = row.map((m, hits) => ({ m: m ?? 0, hits })).filter(x => x.m > 0);
  if (!values.length) { $('potential').textContent = 'Нет выплаты'; $('potentialHint').textContent = 'В этом режиме нет платящих совпадений'; return; }
  const best = values.reduce((a, b) => a.m > b.m ? a : b);
  $('potential').textContent = `${money(bet * best.m)} USDP`;
  $('potentialHint').textContent = `Максимум ×${best.m.toFixed(2)} при ${best.hits} совпадениях`;
}
function renderPaytable() {
  $('tableMode').textContent = risk.toUpperCase();
  if (!picks.length) { $('paytable').innerHTML = '<div class="table-empty">Выбери количество чисел</div>'; return; }
  const row = tables[risk][picks.length - 1] || [];
  const entries = row.map((multiplier, hits) => ({ hits, multiplier: multiplier ?? 0 })).filter(x => x.multiplier > 0);
  if (!entries.length) { $('paytable').innerHTML = '<div class="table-empty">Для этой комбинации нет выплат</div>'; return; }
  const best = Math.max(...entries.map(x => x.multiplier));
  $('paytable').innerHTML = entries.slice().reverse().map(x => `<div class="payout-row ${x.multiplier === best ? 'best' : ''}"><span>${x.hits} ${x.hits === 1 ? 'ПОПАДАНИЕ' : 'ПОПАДАНИЙ'}</span><strong>×${x.multiplier.toFixed(2)}</strong></div>`).join('');
}
function renderHistory(rows) {
  $('historyCount').textContent = `${rows.length} РАУНДОВ`;
  if (!rows.length) { $('history').innerHTML = '<div class="history-empty">История появится после первой игры</div>'; return; }
  $('history').innerHTML = rows.map(r => {
    const ps = JSON.parse(r.picks), ds = JSON.parse(r.drawn), net = Number(r.payout) - Number(r.bet);
    const date = new Date(`${r.created_at.replace(' ', 'T')}Z`);
    const dateText = Number.isNaN(date.getTime()) ? r.created_at : date.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    return `<div class="history-row"><div class="history-main"><b>${r.risk.toUpperCase()} · ${ps.length} ЧИСЕЛ · ${r.hits} ПОПАД.</b><small>${dateText} · Ставка ${money(r.bet)} USDP</small></div><span class="history-numbers">${ds.join(' · ')}</span><strong class="history-value ${net < 0 ? 'loss' : ''}">${net > 0 ? '+' : ''}${money(net)} USDP</strong></div>`;
  }).join('');
}
function setRisk(nextRisk) {
  if (isPlaying || !tables[nextRisk]) return;
  risk = nextRisk;
  document.querySelectorAll('.risk').forEach(button => button.classList.toggle('active', button.dataset.risk === risk));
  renderPaytable(); renderPotential();
}
function setBet(value) {
  const normalized = Math.min(1000, Math.max(.1, Math.round(Number(value) * 100) / 100));
  $('bet').value = normalized.toFixed(2);
  document.querySelectorAll('.bet-presets button').forEach(b => b.classList.toggle('preset-active', Number(b.dataset.bet) === normalized));
  renderPotential();
}
function showRoundResult(result) {
  $('roundTitle').textContent = result.hits ? 'ЕСТЬ ПОПАДАНИЯ!' : 'РАУНД ЗАВЕРШЁН';
  $('roundBadge').textContent = result.payout > 0 ? 'ВЫПЛАТА ЗАЧИСЛЕНА' : 'БЕЗ ВЫПЛАТЫ';
  $('roundBadge').className = `round-badge ${result.payout > 0 ? 'win' : 'loss'}`;
  $('hits').textContent = `${result.hits} / ${result.picks.length}`;
  $('multiplier').textContent = `${result.multiplier.toFixed(2)}×`;
  $('payout').textContent = `${money(result.payout)} USDP`;
  $('net').textContent = `${result.net > 0 ? '+' : ''}${money(result.net)} USDP`;
  $('net').className = result.net > 0 ? 'positive' : result.net < 0 ? 'negative' : '';
  $('roundPanel').classList.remove('round-flash'); void $('roundPanel').offsetWidth; $('roundPanel').classList.add('round-flash');
}
async function revealDraw(result) {
  lastDrawn = [];
  const cells = [...document.querySelectorAll('.num')];
  $('drawn').innerHTML = '';
  for (let i = 0; i < result.drawn.length; i++) {
    const n = result.drawn[i]; lastDrawn.push(n);
    const cell = cells[n - 1]; cell.classList.remove('selected'); cell.classList.add('draw-reveal');
    const ball = document.createElement('span'); ball.className = 'drawn-ball'; ball.textContent = n;
    if (result.picks.includes(n)) { cell.classList.add('hit'); ball.classList.add('match'); }
    $('drawn').appendChild(ball); playTone(350 + i * 38, .08, 'triangle', .025);
    await sleep(115);
  }
  cells.forEach(cell => {
    const n = Number(cell.textContent);
    if (result.picks.includes(n) && result.drawn.includes(n)) { cell.classList.remove('draw-reveal'); cell.classList.add('hit'); }
    else if (result.drawn.includes(n)) cell.classList.add('draw-reveal');
    else cell.classList.add('miss');
  });
}
async function playRound() {
  if (isPlaying) return;
  if (!picks.length) return toast('Сначала выбери от 1 до 10 чисел');
  if (!validBet()) return toast('Ставка должна быть от 0.10 до 1 000.00 USDP');
  if (currentBet() > balance) return toast('Недостаточно виртуальных USDP');
  isPlaying = true; document.body.classList.add('is-drawing');
  $('playBtn').disabled = true; $('playBtn').innerHTML = '<span class="play-icon">◌</span><span>РОЗЫГРЫШ</span><b>…</b>';
  $('gridStatus').textContent = 'ИДЁТ РОЗЫГРЫШ'; renderGrid(true);
  try {
    const result = await api('/api/play', { method: 'POST', body: JSON.stringify({ playerId, picks, bet: currentBet(), risk }) });
    setBalance(result.balance);
    await revealDraw(result);
    showRoundResult(result);
    const history = await api(`/api/history?playerId=${encodeURIComponent(playerId)}`);
    renderHistory(history); renderPaytable();
    if (result.payout > 0) { playTone(760, .22, 'sine', .06); toast(`Выплата ${money(result.payout)} USDP · ${result.hits} совпадений`); }
    else toast(`Раунд завершён · ${result.hits} совпадений`);
  } catch (error) {
    toast(error.message);
    try { const state = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`); setBalance(state.balance); renderHistory(state.history); } catch { /* Keep last known state visible. */ }
  } finally {
    isPlaying = false; document.body.classList.remove('is-drawing');
    $('playBtn').disabled = false; $('playBtn').innerHTML = '<span class="play-icon">▶</span><span>ИГРАТЬ</span><b>→</b>';
    renderGrid(); $('gridStatus').textContent = 'РАУНД ЗАВЕРШЁН';
  }
}

// UI events
$('randomBtn').addEventListener('click', () => {
  if (isPlaying) return;
  picks = []; const pool = Array.from({ length: 40 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  picks = pool.slice(0, 5).sort((a,b) => a-b); lastDrawn = []; renderGrid(true); renderPotential(); renderPaytable(); toast('5 случайных чисел выбраны');
});
$('clearBtn').addEventListener('click', () => { if (isPlaying) return; picks = []; lastDrawn = []; renderGrid(true); renderPotential(); renderPaytable(); });
document.querySelectorAll('.risk').forEach(button => button.addEventListener('click', () => setRisk(button.dataset.risk)));
$('bet').addEventListener('input', () => { document.querySelectorAll('.bet-presets button').forEach(b => b.classList.toggle('preset-active', Number(b.dataset.bet) === currentBet())); renderPotential(); });
$('half').addEventListener('click', () => setBet(currentBet() / 2));
$('double').addEventListener('click', () => setBet(currentBet() * 2));
document.querySelectorAll('.bet-presets button').forEach(button => button.addEventListener('click', () => setBet(button.dataset.bet)));
$('playBtn').addEventListener('click', playRound);
$('historyJump').addEventListener('click', () => $('historySection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('soundBtn').addEventListener('click', () => { soundOn = !soundOn; $('soundIcon').textContent = soundOn ? '♫' : '♪̸'; $('soundBtn').classList.toggle('sound-on', soundOn); if (soundOn) playTone(660, .1); toast(soundOn ? 'Звуковые эффекты включены' : 'Звуковые эффекты выключены'); });

async function init() {
  try {
    [tables] = await Promise.all([api('/api/paytable')]);
    const state = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    setBalance(state.balance); renderGrid(); renderPaytable(); renderPotential(); renderHistory(state.history);
  } catch (error) { toast(error.message || 'Не удалось подключиться к игре'); $('gridStatus').textContent = 'НЕТ СОЕДИНЕНИЯ'; }
}
init();
