import "./style.css";
import {
  configured, signInWithPassword, signUpWithPassword, signOut, watchSession,
  fetchAll, saveSettings, saveLog, saveReward, subscribe,
} from "./supabase.js";

const KEY = "water-break-v2";
const DEFAULTS = {
  interval: 45, goal: 8, glassMl: 250, start: "07:00", end: "23:00",
  running: false, nextAt: 0, sound: true, log: {}, rewards: {},
};
const S = JSON.parse(JSON.stringify(DEFAULTS));
const $ = (id) => document.getElementById(id);

let audioCtx = null;
let flashTimer = null;
const baseTitle = document.title;

/* ---------- Local storage ---------- */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(S, JSON.parse(raw));
  } catch (e) { /* storage unavailable */ }
  if (!S.log || typeof S.log !== "object") S.log = {};
  if (!S.rewards || typeof S.rewards !== "object") S.rewards = {};
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
}

/* ---------- Dates ---------- */
function dayKey(d = new Date()) {
  const m = d.getMonth() + 1, day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}
const todayCount = () => S.log[dayKey()] || 0;
const mins = (hhmm) => { const p = String(hhmm).split(":"); return (+p[0]) * 60 + (+p[1] || 0); };

// Next time a reminder may fire, kept inside the start/end window.
function computeNext(from) {
  const t = new Date(from + S.interval * 60000);
  const s = mins(S.start), e = mins(S.end), m = t.getHours() * 60 + t.getMinutes();
  if (m >= s && m <= e) return t.getTime();
  const d = new Date(t.getTime());
  if (m > e) d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(s / 60), s % 60, 0, 0);
  return d.getTime();
}
function tomorrowStart() {
  const s = mins(S.start), d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(s / 60), s % 60, 0, 0);
  return d.getTime();
}

/* ---------- Sound, title flash, notifications ---------- */
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) { /* no audio */ }
}
function tones(freqs, step, type, peak, len) {
  if (!S.sound || !audioCtx) return;
  try {
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + i * step;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + len + 0.05);
    });
  } catch (e) { /* ignore */ }
}
const chime = () => tones([660, 880, 1100], 0.18, "sine", 0.25, 0.6);
const victoryChime = () => { ensureAudio(); tones([523, 659, 784, 1047], 0.12, "triangle", 0.22, 0.7); };

function startFlash() {
  stopFlash();
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? "💧 Drink water!" : baseTitle;
  }, 1000);
}
function stopFlash() {
  if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
  document.title = baseTitle;
}
function notify() {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Time to drink water", { body: "Have a glass, then log it." });
    }
  } catch (e) { /* ignore */ }
}
function updateNotifNote() {
  let extra = "";
  try {
    if (!("Notification" in window)) extra = " This browser does not support desktop notifications.";
    else if (Notification.permission === "denied") extra = " Notifications are blocked for this site in your browser settings.";
    else if (Notification.permission === "default") extra = " Press Start reminders to allow desktop notifications.";
    else extra = " Desktop notifications are on.";
  } catch (e) { /* ignore */ }
  $("notif-note").textContent =
    "Keep this tab open so reminders can fire. Reminders pause once you reach your goal and resume tomorrow morning." + extra;
}

/* ---------- Reminder banner ---------- */
function showBanner(sub) {
  $("banner-sub").textContent = sub || "Have a glass, then tap the button.";
  $("banner").hidden = false;
  startFlash();
  chime();
  notify();
}
function hideBanner() { $("banner").hidden = true; stopFlash(); }

function fire() {
  const left = Math.max(S.goal - todayCount(), 0);
  showBanner(`${left} ${left === 1 ? "glass" : "glasses"} to go today.`);
  S.nextAt = computeNext(Date.now());
  save();
}

/* ---------- Logging water ---------- */
function drink(delta) {
  const k = dayKey(), n = Math.max((S.log[k] || 0) + delta, 0);
  S.log[k] = n;
  if (delta > 0) {
    hideBanner();
    if (S.running) S.nextAt = n >= S.goal ? tomorrowStart() : computeNext(Date.now());
  }
  save(); render();
  cloud(() => saveLog(userId(), k, n));
  if (delta > 0 && n >= S.goal && !S.rewards[k]) award(k);
}

/* ---------- Rewards ---------- */
const COLORS = ["#ff8a3d", "#f2c230", "#e0507a", "#7a6ff0", "#2fb59a", "#4aa8ff", "#e8590c"];
const NAMES = ["Bubbles", "Splash", "Marlin", "Pearl", "Ripple", "Coral", "Finn", "Dewdrop", "Tide", "Misty", "Skipper", "Lagoon", "Drizzle", "Brook", "Kelp"];
const SHAPES = ["fish", "puffer", "jelly"];
const SHAPE_LABEL = { fish: "fish", puffer: "pufferfish", jelly: "jellyfish" };
const MILESTONES = { 1: "First Sip", 3: "Three-day flow", 7: "Week Wave", 14: "Fortnight Flow", 30: "Deep Ocean" };
const GOLD = "#ffc933";
let demo = true; // sample fish shown only while no real fish exist; never saved
const SAMPLE_FISH = [
  { shape: "fish", color: "#ff8a3d", name: "Bubbles", title: "" },
  { shape: "puffer", color: "#f2c230", name: "Splash", title: "" },
  { shape: "jelly", color: "#7a6ff0", name: "Pearl", title: "" },
  { shape: "fish", color: "#2fb59a", name: "Finn", title: "" },
  { shape: "fish", color: GOLD, name: "Marlin", title: "Week Wave" },
];

function fishSvg(shape, color, w) {
  const eye = (x, y) => `<circle cx="${x}" cy="${y}" r="2.4" fill="#fff"/><circle cx="${x}" cy="${y}" r="1.1" fill="#0b1f22"/>`;
  if (shape === "puffer") {
    return `<svg viewBox="0 0 60 40" width="${w}" aria-hidden="true"><path d="M44 20 L57 11 L57 29 Z" fill="${color}"/><circle cx="26" cy="20" r="17" fill="${color}"/><path d="M14 26 Q26 36 38 26 Q26 30 14 26Z" fill="#fff" opacity="0.35"/><path d="M20 4 L22 0 M28 3 L30 -1 M35 6 L38 3" stroke="${color}" stroke-width="2" stroke-linecap="round"/>${eye(15, 16)}</svg>`;
  }
  if (shape === "jelly") {
    return `<svg viewBox="0 0 56 50" width="${w}" aria-hidden="true"><path d="M8 26 A20 20 0 0 1 48 26 Z" fill="${color}"/><path d="M14 22 A14 14 0 0 1 28 12" stroke="#fff" stroke-width="2.4" fill="none" opacity="0.5" stroke-linecap="round"/><path d="M13 27 Q11 38 15 46 M23 27 Q25 40 21 48 M33 27 Q31 38 35 47 M43 27 Q45 38 41 45" stroke="${color}" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 60 36" width="${w}" aria-hidden="true"><path d="M4 18 Q20 2 42 12 L57 4 L52 18 L57 32 L42 24 Q20 34 4 18 Z" fill="${color}"/><path d="M16 12 Q28 8 38 14" stroke="#fff" stroke-width="2" fill="none" opacity="0.4" stroke-linecap="round"/>${eye(14, 15)}</svg>`;
}

function streakCount() {
  const d = new Date();
  let n = 0;
  if (!S.rewards[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (S.rewards[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function award(k) {
  const count = Object.keys(S.rewards).length;
  const r = {
    shape: SHAPES[count % SHAPES.length],
    color: COLORS[(count * 3 + 1) % COLORS.length],
    name: NAMES[count % NAMES.length],
    gold: false, title: "",
  };
  S.rewards[k] = r;
  const st = streakCount();
  if (MILESTONES[st]) { r.gold = true; r.color = GOLD; r.title = MILESTONES[st]; }
  save(); render();
  cloud(() => saveReward(userId(), k, r));
  celebrate(r, st);
}

function celebrate(r, st) {
  hideBanner();
  $("reward-fish").innerHTML = fishSvg(r.shape, r.color, 120);
  $("reward-title").textContent = r.gold ? `Golden ${SHAPE_LABEL[r.shape]}!` : "Goal reached!";
  $("reward-text").textContent = `Meet ${r.name}, your new ${SHAPE_LABEL[r.shape]}. They just joined your aquarium.`;
  $("reward-badge").hidden = !r.title;
  $("reward-badge").textContent = r.title;
  $("reward-streak").textContent = st > 1 ? `${st} days in a row. Keep the streak going tomorrow.` : "Come back tomorrow to start a streak.";
  $("overlay").hidden = false;
  $("reward-close").focus();
  victoryChime();
  confetti();
}
const closeReward = () => { $("overlay").hidden = true; };

let confettiRaf = null;
function confetti() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("confetti"), ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ["#1a8fa0", "#3cc0d3", "#ff8a3d", "#ffc933", "#e0507a", "#7a6ff0", "#2fb59a"];
  const ps = [];
  for (let i = 0; i < 150; i++) {
    const left = i % 2 === 0;
    ps.push({
      x: left ? 0 : W, y: H * 0.7,
      vx: (left ? 1 : -1) * (4 + Math.random() * 9), vy: -(9 + Math.random() * 12),
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
      c: cols[Math.floor(Math.random() * cols.length)],
    });
  }
  const t0 = performance.now();
  if (confettiRaf) cancelAnimationFrame(confettiRaf);
  const frame = (now) => {
    const el = now - t0;
    ctx.clearRect(0, 0, W, H);
    ps.forEach((p) => {
      p.vy += 0.32; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(el - 2200, 0) / 1000);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (el < 3200) confettiRaf = requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); confettiRaf = null; }
  };
  confettiRaf = requestAnimationFrame(frame);
}

function renderAquarium() {
  const keys = Object.keys(S.rewards).sort().reverse(), tank = $("tank");
  const showingDemo = !keys.length && demo;
  const items = keys.length ? keys.map((k) => S.rewards[k]) : (demo ? SAMPLE_FISH : []);
  const toggle = keys.length ? "" : `<button id="demo-toggle" type="button">${demo ? "Hide sample fish" : "Show sample fish"}</button>`;
  const st = streakCount();
  $("streak-chip").textContent = `Streak ${st} ${st === 1 ? "day" : "days"}`;
  $("streak-chip").classList.toggle("hot", st >= 3);
  if (!items.length) {
    tank.innerHTML = '<div class="tank-empty">Reach your daily goal to earn your first fish.</div><div class="sand"></div>';
  } else {
    let html = "";
    items.slice(0, 14).forEach((r, idx) => {
      const w = 46 + (idx * 13) % 22, top = 6 + (idx * 37) % 62, dur = 16 + (idx * 5) % 13, delay = -((idx * 4.3) % dur);
      const label = r.name + (r.title ? ` (${r.title})` : "");
      html += `<div class="swimmer" title="${label}" style="top:${top}%;animation-duration:${dur}s;animation-delay:${delay}s;--rest-left:${(idx * 23) % 75}%"><div class="bobber" style="animation-duration:${3 + idx % 3}s">${fishSvg(r.shape, r.color, w)}</div></div>`;
    });
    tank.innerHTML = html + '<div class="sand"></div>';
  }
  const next = [3, 7, 14, 30].find((m) => m > st);
  $("tank-meta").innerHTML =
    `<span><b>${keys.length}</b> fish collected</span>` +
    `<span>${next ? `Golden fish in <b>${next - st}</b> ${next - st === 1 ? "day" : "days"} (${MILESTONES[next]})` : "Every milestone unlocked"}</span>` +
    (showingDemo ? '<span style="flex-basis:100%">These five are samples. Your own fish replace them when you earn one.</span>' : "") + toggle;
}

/* ---------- Rendering ---------- */
const fmt = (ms) => {
  const s = Math.max(Math.round(ms / 1000), 0), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (x) => (x < 10 ? "0" : "") + x;
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
};
const clockLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function renderWeek() {
  let html = "";
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const n = S.log[dayKey(d)] || 0;
    const pct = Math.min(n / Math.max(S.goal, 1), 1.25) / 1.25 * 100;
    html += `<div class="col"><div class="bar-track" title="${n} glasses"><div class="bar${n >= S.goal ? " met" : ""}" style="height:${pct}%"></div></div>` +
      `<div class="dow${i === 0 ? " today" : ""}">${d.toLocaleDateString([], { weekday: "short" }).slice(0, 3)}</div></div>`;
  }
  $("week").innerHTML = html;
}

function render() {
  const n = todayCount(), frac = Math.min(n / Math.max(S.goal, 1), 1);
  $("count").textContent = n;
  $("goal-show").textContent = S.goal;
  $("litres").textContent = `${(n * S.glassMl / 1000).toFixed(2)} L of ${(S.goal * S.glassMl / 1000).toFixed(2)} L`;
  $("water-level").setAttribute("transform", `translate(0,${244 - frac * 218})`);
  $("toggle").textContent = S.running ? "Pause reminders" : "Start reminders";
  $("status").classList.toggle("on", S.running);
  renderWeek();
  renderAquarium();
  tick(true);
}

function tick(skipFire) {
  const now = Date.now();
  if (S.running) {
    if (!skipFire && now >= S.nextAt) {
      if (todayCount() >= S.goal) { S.nextAt = tomorrowStart(); save(); }
      else fire();
    }
    $("countdown").textContent = fmt(S.nextAt - Date.now());
    $("status-text").textContent = todayCount() >= S.goal
      ? `Goal reached. Back at ${clockLabel(S.nextAt)} tomorrow`
      : `Next reminder at ${clockLabel(S.nextAt)}`;
  } else {
    $("countdown").textContent = "--:--";
    $("status-text").textContent = "Reminders are off";
  }
}

function setRunning(on) {
  S.running = on;
  if (on) {
    ensureAudio();
    try {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then(updateNotifNote, () => {});
      }
    } catch (e) { /* ignore */ }
    S.nextAt = todayCount() >= S.goal ? tomorrowStart() : computeNext(Date.now());
  } else { hideBanner(); }
  save(); render(); updateNotifNote();
}

function syncInputs() {
  $("interval").value = String(S.interval);
  $("goal").value = S.goal;
  $("start").value = S.start;
  $("end").value = S.end;
  $("glassml").value = S.glassMl;
  $("sound").checked = !!S.sound;
}

/* ---------- Supabase sync ---------- */
let session = null;
let unsubscribeRealtime = null;
const userId = () => session && session.user.id;

function setSync(text, ok) {
  const el = $("sync-chip");
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
}

// Runs a cloud write only when signed in. A failure never blocks the app.
function cloud(fn) {
  if (!session) return;
  setSync("Saving…");
  Promise.resolve().then(fn).then(
    () => setSync("Synced", true),
    (e) => { console.error(e); setSync("Sync paused"); },
  );
}

function renderAuth() {
  $("auth-card").hidden = !configured;
  $("auth-out").hidden = !!session;
  $("auth-in").hidden = !session;
  if (session) $("auth-who").textContent = session.user.email || "your account";
}

// First sign-in on a device: combine what is here with what is in the account.
async function mergeFromCloud(remote) {
  const uid = userId();
  const pushes = [];
  if (remote.settings) Object.assign(S, remote.settings);
  else pushes.push(saveSettings(uid, S));
  const days = new Set([...Object.keys(S.log), ...Object.keys(remote.log)]);
  days.forEach((d) => {
    const local = S.log[d] || 0, far = remote.log[d] || 0, best = Math.max(local, far);
    S.log[d] = best;
    if (best !== far) pushes.push(saveLog(uid, d, best));
  });
  Object.keys(remote.rewards).forEach((d) => { if (!S.rewards[d]) S.rewards[d] = remote.rewards[d]; });
  Object.keys(S.rewards).forEach((d) => { if (!remote.rewards[d]) pushes.push(saveReward(uid, d, S.rewards[d])); });
  await Promise.all(pushes);
  save(); syncInputs(); render();
}

async function onSession(next) {
  session = next;
  renderAuth();
  if (unsubscribeRealtime) { unsubscribeRealtime(); unsubscribeRealtime = null; }
  if (!session) { setSync("Local only"); return; }
  setSync("Syncing…");
  try {
    await mergeFromCloud(await fetchAll(userId()));
    unsubscribeRealtime = subscribe(userId(), {
      settings: (s) => { Object.assign(S, s); save(); syncInputs(); render(); },
      log: (day, glasses) => { S.log[day] = glasses; save(); render(); },
      reward: (day, r) => { S.rewards[day] = r; save(); render(); },
    });
    setSync("Synced", true);
  } catch (e) {
    console.error(e);
    setSync("Sync paused");
  }
}

/* ---------- Wiring ---------- */
function bind() {
  syncInputs();
  $("today-label").textContent = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  $("drink").onclick = () => { ensureAudio(); drink(1); };
  $("b-drink").onclick = () => drink(1);
  $("undo").onclick = () => drink(-1);
  $("b-snooze").onclick = () => {
    hideBanner();
    if (S.running) { S.nextAt = Date.now() + 5 * 60000; save(); tick(true); }
  };
  $("toggle").onclick = () => setRunning(!S.running);
  $("test").onclick = () => { ensureAudio(); showBanner("This is a test reminder."); };
  $("preview-reward").onclick = () => {
    ensureAudio();
    celebrate({ shape: "fish", color: GOLD, name: "Sample", gold: true, title: "Preview" }, 7);
  };
  $("tank-meta").addEventListener("click", (e) => {
    if (e.target && e.target.id === "demo-toggle") { demo = !demo; renderAquarium(); }
  });
  $("reward-close").onclick = closeReward;
  $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeReward(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeReward(); });

  const settingsChanged = () => { save(); render(); cloud(() => saveSettings(userId(), S)); };
  const num = (id, key, lo, hi) => {
    $(id).onchange = () => {
      let v = Math.round(+$(id).value);
      if (!(v >= lo && v <= hi)) v = S[key];
      S[key] = v; $(id).value = v; settingsChanged();
    };
  };
  num("goal", "goal", 1, 20);
  num("glassml", "glassMl", 100, 1000);
  $("interval").onchange = () => {
    S.interval = +$("interval").value;
    if (S.running) S.nextAt = computeNext(Date.now());
    settingsChanged();
  };
  ["start", "end"].forEach((id) => {
    $(id).onchange = () => {
      if ($(id).value) S[id] = $(id).value; else $(id).value = S[id];
      if (S.running) S.nextAt = computeNext(Date.now());
      settingsChanged();
    };
  });
  $("sound").onchange = () => { S.sound = $("sound").checked; if (S.sound) ensureAudio(); settingsChanged(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(false); });

  const authBusy = (on) => { $("auth-signin").disabled = on; $("auth-create").disabled = on; };
  const authError = (err) => {
    $("auth-msg").textContent = err && err.message ? err.message : "Something went wrong. Try again.";
  };
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    authBusy(true);
    try {
      await signInWithPassword($("auth-email").value.trim(), $("auth-password").value);
      $("auth-password").value = "";
    } catch (err) { authError(err); }
    authBusy(false);
  });
  $("auth-create").addEventListener("click", async () => {
    if (!$("auth-form").reportValidity()) return;
    authBusy(true);
    try {
      const signedIn = await signUpWithPassword($("auth-email").value.trim(), $("auth-password").value);
      $("auth-password").value = "";
      if (!signedIn) $("auth-msg").textContent = "Account created. Confirm your email, then sign in.";
    } catch (err) { authError(err); }
    authBusy(false);
  });
  $("signout").onclick = () => signOut();
}

load();
if (S.running && S.nextAt < Date.now() - 6 * 3600000) S.nextAt = computeNext(Date.now());
bind();
updateNotifNote();
renderAuth();
render();
setInterval(() => tick(false), 1000);
if (configured) watchSession(onSession);
