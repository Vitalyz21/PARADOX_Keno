const START_BALANCE = 50;
const MAX_SELECTION = 10;
const DRAW_COUNT = 10;
const MIN_BET = 0.01;

let balance = START_BALANCE;
let bet = 1;
let round = 0;
let selected = new Set();
let drawn = [];
let difficulty = "easy";
let risk = 1;
let isPlaying = false;
let sfxEnabled = true;
let musicEnabled = false;

const payouts = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
  4: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  5: [0, 0, 0, 0, 0, 2.5, 0, 0, 0, 0, 0],
  6: [0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0],
  7: [0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0],
  8: [0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0],
  9: [0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0],
  10: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100]
};

// Для каждой сложности используется отдельная таблица.
// Здесь значения — коэффициенты выплаты за ставку.
const payoutByDifficulty = {
  easy:   [0, 0, 0, 0.5, 1, 2.5, 5, 10, 20, 40, 100],
  medium: [0, 0, 0, 0.7, 1.4, 3, 6, 12, 25, 50, 120],
  hard:   [0, 0, 0, 1, 2, 4, 8, 16, 32, 65, 150],
  expert: [0, 0, 0, 1.5, 3, 6, 12, 25, 50, 100, 250]
};

const grid = document.getElementById("numberGrid");
const playButton = document.getElementById("playButton");
const betInput = document.getElementById("betAmount");
const toast = document.getElementById("toast");

let audioContext = null;
let masterSfx = null;
let masterMusic = null;
let musicTimer = null;
let musicStep = 0;

function money(value) {
  return Math.max(0, value).toFixed(2);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function renderGrid() {
  grid.innerHTML = "";

  for (let number = 1; number <= 40; number++) {
    const button = document.createElement("button");
    button.className = "number";
    button.textContent = number;
    button.dataset.number = number;

    if (selected.has(number)) button.classList.add("selected");
    if (drawn.includes(number)) button.classList.add("drawn");
    if (drawn.includes(number) && selected.has(number)) {
      button.classList.add("hit");
    }

    button.disabled = isPlaying;

    button.addEventListener("click", () => {
      if (isPlaying) return;

      if (selected.has(number)) {
        selected.delete(number);
      } else {
        if (selected.size >= MAX_SELECTION) {
          showToast("Можно выбрать максимум 10 чисел");
          return;
        }
        selected.add(number);
      }

      updateSelectedCount();
      renderGrid();
    });

    grid.appendChild(button);
  }
}

function updateSelectedCount() {
  document.getElementById("selectedCount").textContent = selected.size;
}

function updateBalance() {
  document.getElementById("balance").textContent = money(balance);
  document.getElementById("betBalance").textContent = money(balance);
}

function updateBet(value) {
  let next = Number(value);

  if (!Number.isFinite(next)) next = MIN_BET;

  next = Math.max(MIN_BET, Math.min(balance, next));
  bet = Math.round(next * 100) / 100;
  betInput.value = bet.toFixed(2);
}

function renderPayouts() {
  const table = document.getElementById("payoutTable");
  const values = payoutByDifficulty[difficulty];

  table.innerHTML = "";

  for (let hits = 3; hits <= 10; hits++) {
    const row = document.createElement("div");
    row.className = "payout-row";

    const label = document.createElement("span");
    label.textContent = `${hits} совпадения`;

    const value = document.createElement("b");
    value.textContent = `${values[hits].toFixed(2)}x`;

    row.append(label, value);
    table.appendChild(row);
  }
}

function initAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    showToast("Браузер не поддерживает Web Audio");
    return;
  }

  audioContext = new AudioContextClass();

  masterSfx = audioContext.createGain();
  masterMusic = audioContext.createGain();

  masterSfx.gain.value = sfxEnabled
    ? Number(document.getElementById("sfxVolume").value) / 100
    : 0;

  masterMusic.gain.value = musicEnabled
    ? Number(document.getElementById("musicVolume").value) / 100
    : 0;

  masterSfx.connect(audioContext.destination);
  masterMusic.connect(audioContext.destination);
}

function tone(frequency, duration, type, volume, destination, slideTo) {
  if (!audioContext || !destination) return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = type || "sine";
  oscillator.frequency.setValueAtTime(frequency, now);

  if (slideTo) {
    oscillator.frequency.exponentialRampToValueAtTime(
      slideTo,
      now + duration
    );
  }

  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  oscillator.connect(gain);
  gain.connect(destination);

  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playKenoClick() {
  if (!audioContext || !sfxEnabled) return;

  tone(1250, 0.045, "square", 0.12, masterSfx, 650);
  tone(720, 0.08, "sine", 0.08, masterSfx, 420);
}

function playHitSound() {
  if (!audioContext || !sfxEnabled) return;

  tone(660, 0.12, "triangle", 0.12, masterSfx, 1050);
  setTimeout(() => tone(1100, 0.1, "sine", 0.08, masterSfx), 60);
}

function startMusic() {
  initAudio();

  if (!audioContext || musicTimer) return;

  musicEnabled = true;
  masterMusic.gain.setTargetAtTime(
    Number(document.getElementById("musicVolume").value) / 100,
    audioContext.currentTime,
    0.05
  );

  // Оригинальный синтезированный DnB-ритм, без внешних аудиозаписей.
  const bpm = 174;
  const stepMs = 60000 / bpm / 2;

  musicTimer = setInterval(() => {
    if (!audioContext || !musicEnabled) return;

    const step = musicStep % 16;

    if (step % 4 === 0) {
      tone(95, 0.16, "sine", 0.22, masterMusic, 38);
    }

    if (step === 4 || step === 12) {
      tone(190, 0.09, "triangle", 0.10, masterMusic, 90);
    }

    if (step % 2 === 0) {
      tone(7500, 0.025, "square", 0.018, masterMusic, 4000);
    }

    if ([0, 3, 6, 9, 12, 15].includes(step)) {
      const bassNotes = [55, 55, 65, 49];
      const note = bassNotes[Math.floor(step / 4)] || 55;
      tone(note, 0.13, "sawtooth", 0.055, masterMusic, note * 0.9);
    }

    musicStep++;
  }, stepMs);
}

function stopMusic() {
  musicEnabled = false;

  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }

  if (audioContext && masterMusic) {
    masterMusic.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
  }
}

function updateAudioUI() {
  document.getElementById("sfxState").textContent = sfxEnabled ? "ВКЛ" : "ВЫКЛ";
  document.getElementById("musicState").textContent = musicEnabled ? "ВКЛ" : "ВЫКЛ";
}

function randomDraw() {
  const numbers = Array.from({ length: 40 }, (_, index) => index + 1);

  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  return numbers.slice(0, DRAW_COUNT);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function playRound() {
  if (isPlaying) return;

  initAudio();

  if (selected.size < 1 || selected.size > MAX_SELECTION) {
    showToast("Сначала выбери от 1 до 10 чисел");
    return;
  }

  updateBet(betInput.value);

  if (bet > balance || bet < MIN_BET) {
    showToast("Недостаточно виртуального баланса");
    return;
  }

  isPlaying = true;
  drawn = [];
  balance -= bet;
  round++;

  updateBalance();
  renderGrid();
  playButton.disabled = true;
  playButton.textContent = "ИДЁТ РОЗЫГРЫШ...";

  document.getElementById("roundNumber").textContent = round;
  document.getElementById("lastWin").textContent = "0.00";
  document.getElementById("lastHits").textContent = "0 / 10";
  document.getElementById("drawStatus").textContent = "Выпадение чисел...";

  const result = randomDraw();

  for (let i = 0; i < result.length; i++) {
    await wait(430);

    const number = result[i];
    drawn.push(number);

    const isHit = selected.has(number);

    if (isHit) playHitSound();
    else playKenoClick();

    renderGrid();

    document.getElementById("drawStatus").textContent =
      `Выпало ${i + 1} из ${DRAW_COUNT}`;
  }

  const hits = drawn.filter(number => selected.has(number)).length;
  const multiplier = payoutByDifficulty[difficulty][hits] || 0;
  const win = bet * multiplier * risk;

  balance += win;

  updateBalance();

  document.getElementById("lastWin").textContent = money(win);
  document.getElementById("lastHits").textContent = `${hits} / 10`;
  document.getElementById("drawStatus").textContent =
    `Результат: ${hits} совпадений. Выигрыш: ${money(win)}`;

  addHistory(hits, win, bet);

  if (win > 0) {
    showToast(`Поздравляем! Выигрыш ${money(win)} виртуальных очков`);
  } else {
    showToast("Раунд завершён. Попробуй ещё раз!");
  }

  isPlaying = false;
  playButton.disabled = false;
  playButton.innerHTML = "<span>▶</span> ИГРАТЬ";
  renderGrid();

  if (balance < MIN_BET) {
    showToast("Баланс закончился. Нажми сброс для новой тренировки.");
  }
}

function addHistory(hits, win, wager) {
  const list = document.getElementById("historyList");
  const entry = document.createElement("div");

  entry.className = "history-entry";

  const left = document.createElement("span");
  left.textContent = `#${round} · ${hits} совп.`;

  const right = document.createElement("b");
  right.textContent = win > 0 ? `+${money(win)}` : `−${money(wager)}`;
  right.style.color = win > 0 ? "#20d8d1" : "#d89b65";

  entry.append(left, right);
  list.prepend(entry);
}

document.getElementById("difficulty").addEventListener("click", event => {
  const button = event.target.closest("button[data-level]");
  if (!button || isPlaying) return;

  difficulty = button.dataset.level;

  document.querySelectorAll("#difficulty button").forEach(item => {
    item.classList.toggle("active", item === button);
  });

  renderPayouts();
});

document.getElementById("riskOptions").addEventListener("click", event => {
  const button = event.target.closest("button[data-risk]");
  if (!button || isPlaying) return;

  risk = Number(button.dataset.risk);

  document.querySelectorAll("#riskOptions button").forEach(item => {
    item.classList.toggle("active", item === button);
  });
});

playButton.addEventListener("click", playRound);

betInput.addEventListener("change", () => updateBet(betInput.value));

document.getElementById("minusBet").addEventListener("click", () => {
  updateBet(bet - 0.1);
});

document.getElementById("plusBet").addEventListener("click", () => {
  updateBet(bet + 0.1);
});

document.getElementById("halfBet").addEventListener("click", () => {
  updateBet(bet / 2);
});

document.getElementById("doubleBet").addEventListener("click", () => {
  updateBet(bet * 2);
});

document.getElementById("maxBet").addEventListener("click", () => {
  updateBet(balance);
});

document.getElementById("sfxToggle").addEventListener("click", () => {
  initAudio();
  sfxEnabled = !sfxEnabled;

  masterSfx.gain.setTargetAtTime(
    sfxEnabled ? Number(document.getElementById("sfxVolume").value) / 100 : 0,
    audioContext.currentTime,
    0.04
  );

  updateAudioUI();
});

document.getElementById("musicToggle").addEventListener("click", () => {
  if (musicEnabled) {
    stopMusic();
  } else {
    startMusic();
  }

  updateAudioUI();
});

document.getElementById("sfxVolume").addEventListener("input", event => {
  document.getElementById("sfxValue").textContent = event.target.value;

  if (audioContext && masterSfx) {
    masterSfx.gain.setTargetAtTime(
      sfxEnabled ? Number(event.target.value) / 100 : 0,
      audioContext.currentTime,
      0.04
    );
  }
});

document.getElementById("musicVolume").addEventListener("input", event => {
  document.getElementById("musicValue").textContent = event.target.value;

  if (audioContext && masterMusic) {
    masterMusic.gain.setTargetAtTime(
      musicEnabled ? Number(event.target.value) / 100 : 0,
      audioContext.currentTime,
      0.04
    );
  }
});

document.getElementById("historyToggle").addEventListener("click", () => {
  const box = document.getElementById("historyBox");
  box.hidden = !box.hidden;
});

renderGrid();
renderPayouts();
updateBalance();
updateBet(1);
updateSelectedCount();
updateAudioUI();
