'use strict';

const KNOTS_PER_MPS = 1.9438444924;
const MPH_PER_MPS = 2.2369362921;
const EARTH_RADIUS_M = 6371000;
const START_SECONDS = 5 * 60;
const STORAGE_KEY = 'regataide-start-v1';
const LANG_KEY = 'regataide-start-lang';

let watchId = null;
let currentPos = null;
let startTimeMs = null;
let lastSignalSecond = null;
let audioCtx = null;
let currentLang = localStorage.getItem(LANG_KEY) || 'fr';
let i18n = {};

const $ = (id) => document.getElementById(id);

const el = {
  html: document.documentElement,
  guideLink: $('guideLink'),
  languageSelect: $('languageSelect'),
  gpsBadge: $('gpsBadge'),
  currentClock: $('currentClock'),
  startClock: $('startClock'),
  officialStartTime: $('officialStartTime'),
  armStartBtn: $('armStartBtn'),
  speedUnit: $('speedUnit'),
  timer: $('timer'),
  targetLine: $('targetLine'),
  startGpsBtn: $('startGpsBtn'),
  syncBtn: $('syncBtn'),
  resetBtn: $('resetBtn'),
  distanceToLine: $('distanceToLine'),
  currentSpeed: $('currentSpeed'),
  idealSpeed: $('idealSpeed'),
  speedStatus: $('speedStatus'),
  statusCard: $('statusCard'),
  lat: $('lat'),
  lon: $('lon'),
  accuracy: $('accuracy'),
  sideText: $('sideText'),
  latA: $('latA'),
  lonA: $('lonA'),
  latB: $('latB'),
  lonB: $('lonB'),
  buoySide: $('buoySide'),
  lineBuffer: $('lineBuffer'),
  setABtn: $('setABtn'),
  setBBtn: $('setBBtn'),
  saveBtn: $('saveBtn'),
};

function t(key) {
  return i18n[key] || key;
}

async function loadLanguage(lang) {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  el.html.lang = lang;
  el.languageSelect.value = lang;
  el.guideLink.href = lang === 'en' ? 'guide-en.html' : 'guide-fr.html';

  try {
    const res = await fetch(`i18n/${lang}.json`, { cache: 'no-store' });
    i18n = await res.json();
  } catch {
    i18n = {};
  }

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (i18n[key]) node.textContent = i18n[key];
  });

  updateGpsBadge();
  updateGpsDisplay();
  updateCalculations();
}

function num(value) {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function fmt(n, decimals = 0) {
  return Number.isFinite(n) ? n.toFixed(decimals) : '--';
}

function fmtTimer(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function fmtClock(ms) {
  if (!Number.isFinite(ms)) return '--:--:--';
  return new Date(ms).toLocaleTimeString(currentLang === 'en' ? 'en-CA' : 'fr-CA', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function speedUnitLabel() {
  return el.speedUnit.value === 'mph' ? 'mph' : (currentLang === 'en' ? 'kt' : 'nds');
}

function speedFromMps(mps) {
  return el.speedUnit.value === 'mph' ? mps * MPH_PER_MPS : mps * KNOTS_PER_MPS;
}

function fmtSpeed(mps) {
  if (!Number.isFinite(mps)) return `-- ${speedUnitLabel()}`;
  return `${fmt(speedFromMps(mps), 1)} ${speedUnitLabel()}`;
}

function getConfig() {
  return {
    latA: num(el.latA.value),
    lonA: num(el.lonA.value),
    latB: num(el.latB.value),
    lonB: num(el.lonB.value),
    buoySide: el.buoySide.value,
    lineBuffer: Math.max(1, num(el.lineBuffer.value) ?? 10),
    speedUnit: el.speedUnit.value,
  };
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    latA: el.latA.value,
    lonA: el.lonA.value,
    latB: el.latB.value,
    lonB: el.lonB.value,
    buoySide: el.buoySide.value,
    lineBuffer: el.lineBuffer.value,
    speedUnit: el.speedUnit.value,
  }));
}

function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const map = {
      validSide: 'buoySide', // compatibilité ancienne V1
      latA: 'latA', lonA: 'lonA', latB: 'latB', lonB: 'lonB', buoySide: 'buoySide', lineBuffer: 'lineBuffer', speedUnit: 'speedUnit',
    };
    Object.entries(map).forEach(([oldKey, elKey]) => {
      if (cfg[oldKey] !== undefined && el[elKey]) el[elKey].value = cfg[oldKey];
    });
  } catch {}
}

function toLocalMeters(lat, lon, refLat, refLon) {
  const latRad = refLat * Math.PI / 180;
  const x = (lon - refLon) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(latRad);
  const y = (lat - refLat) * Math.PI / 180 * EARTH_RADIUS_M;
  return { x, y };
}

function signedDistanceToLine(pos, cfg) {
  const a = { x: 0, y: 0 };
  const b = toLocalMeters(cfg.latB, cfg.lonB, cfg.latA, cfg.lonA);
  const p = toLocalMeters(pos.lat, pos.lon, cfg.latA, cfg.lonA);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len = Math.hypot(vx, vy);
  if (len < 1) return null;
  const cross = vx * wy - vy * wx;
  return cross / len;
}

function targetSecondsRemaining(remaining) {
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  const nextMinute = Math.floor((remaining - 0.001) / 60) * 60;
  return Math.max(0, nextMinute);
}

function beep(freq = 880, durationMs = 160) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000 + 0.02);
  } catch {}
}

function playSignal(remainingCeil) {
  if (lastSignalSecond === remainingCeil) return;
  if ([300, 240, 60, 0].includes(remainingCeil)) {
    lastSignalSecond = remainingCeil;
    const count = remainingCeil === 0 ? 3 : 1;
    for (let i = 0; i < count; i++) setTimeout(() => beep(remainingCeil === 0 ? 1200 : 880, 180), i * 250);
  }
}

function remainingSeconds() {
  if (startTimeMs === null) return null;
  return (startTimeMs - Date.now()) / 1000;
}

function updateGpsBadge() {
  if (!el.gpsBadge) return;
  if (!currentPos) {
    if (!watchId) {
      el.gpsBadge.textContent = t('gpsOff');
      el.gpsBadge.className = 'badge bad';
    }
    return;
  }
  el.gpsBadge.textContent = `GPS ±${fmt(currentPos.accuracy, 0)} m`;
  el.gpsBadge.className = currentPos.accuracy <= 10 ? 'badge good' : 'badge warn';
}

function updateGpsDisplay() {
  if (!currentPos) {
    el.currentSpeed.textContent = fmtSpeed(null);
    return;
  }
  el.lat.textContent = currentPos.lat.toFixed(7);
  el.lon.textContent = currentPos.lon.toFixed(7);
  el.accuracy.textContent = `${fmt(currentPos.accuracy, 0)} m`;
  el.currentSpeed.textContent = fmtSpeed(currentPos.speedMps);
}

function updateCalculations() {
  const now = Date.now();
  const remaining = remainingSeconds();

  el.currentClock.textContent = fmtClock(now);
  el.startClock.textContent = fmtClock(startTimeMs);
  el.timer.textContent = fmtTimer(remaining);

  if (Number.isFinite(remaining)) {
    playSignal(Math.max(0, Math.ceil(remaining)));
  }

  const cfg = getConfig();
  const hasLine = [cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite);

  if (!currentPos || !hasLine) {
    el.distanceToLine.textContent = '-- m';
    el.idealSpeed.textContent = fmtSpeed(null);
    el.speedStatus.textContent = '---';
    el.sideText.textContent = '--';
    el.targetLine.textContent = hasLine ? t('waitingGps') : t('enterLine');
    return;
  }

  const signed = signedDistanceToLine(currentPos, cfg);
  if (signed === null) return;

  // Ligne orientée A(comité) -> B(bouée). Côté port/starboard selon la bouée à laisser au passage.
  // Convention V1 : port = côté gauche de A->B, starboard = côté droit de A->B.
  const side = signed >= 0 ? 'port' : 'starboard';
  const valid = side === cfg.buoySide;
  const absDist = Math.abs(signed);
  const inBuffer = absDist <= cfg.lineBuffer;

  el.distanceToLine.textContent = `${fmt(absDist, 0)} m`;
  el.sideText.textContent = valid ? t('goodSide') : t('wrongSide');

  if (!Number.isFinite(remaining) || remaining <= 0) {
    el.targetLine.textContent = t('notSynced');
    el.idealSpeed.textContent = fmtSpeed(null);
    setStatus('---', '');
    return;
  }

  if (!valid && !inBuffer) {
    el.targetLine.textContent = t('returnSide');
    el.idealSpeed.textContent = fmtSpeed(null);
    setStatus(t('return'), 'bad');
    return;
  }

  const target = targetSecondsRemaining(remaining);
  const secondsToTarget = remaining - target;
  const idealMps = secondsToTarget > 1 ? absDist / secondsToTarget : null;

  el.targetLine.textContent = `${t('target')} : ${fmtTimer(target)} | ${t('availableTime')} : ${fmt(secondsToTarget, 0)} s`;
  el.idealSpeed.textContent = fmtSpeed(idealMps);

  if (!Number.isFinite(idealMps) || currentPos.speedMps === null) {
    setStatus(t('calc'), 'warn');
  } else {
    const delta = speedFromMps(idealMps) - speedFromMps(currentPos.speedMps);
    const tolerance = el.speedUnit.value === 'mph' ? 0.45 : 0.4;
    if (Math.abs(delta) <= tolerance) setStatus(t('ok'), 'ok');
    else if (delta > 0) setStatus(t('accelerate'), 'warn');
    else setStatus(t('slowDown'), 'bad');
  }
}

function setStatus(text, cls) {
  el.speedStatus.textContent = text;
  el.statusCard.className = `card status ${cls}`.trim();
}

function startGps() {
  if (!('geolocation' in navigator)) {
    el.gpsBadge.textContent = t('gpsUnsupported');
    el.gpsBadge.className = 'badge bad';
    return;
  }

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  el.gpsBadge.textContent = t('gpsStarting');
  el.gpsBadge.className = 'badge warn';

  watchId = navigator.geolocation.watchPosition(
    (p) => {
      currentPos = {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy,
        speedMps: Number.isFinite(p.coords.speed) ? p.coords.speed : null,
        heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
      };
      updateGpsBadge();
      updateGpsDisplay();
      updateCalculations();
    },
    (err) => {
      el.gpsBadge.textContent = err.code === 1 ? t('gpsDenied') : t('gpsError');
      el.gpsBadge.className = 'badge bad';
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

function syncFiveMinutes() {
  startTimeMs = Date.now() + START_SECONDS * 1000;
  lastSignalSecond = null;
  beep(880, 180);
  updateCalculations();
}

function armOfficialStart() {
  if (!el.officialStartTime.value) return;
  const [hh, mm, ss = '0'] = el.officialStartTime.value.split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, ss, 0);
  startTimeMs = d.getTime();
  lastSignalSecond = null;
  beep(760, 120);
  updateCalculations();
}

function resetCountdown() {
  startTimeMs = null;
  lastSignalSecond = null;
  el.timer.textContent = '--:--';
  el.targetLine.textContent = t('targetEmpty');
  updateCalculations();
}

function useCurrentAs(point) {
  if (!currentPos) return;
  if (point === 'A') {
    el.latA.value = currentPos.lat.toFixed(7);
    el.lonA.value = currentPos.lon.toFixed(7);
  } else {
    el.latB.value = currentPos.lat.toFixed(7);
    el.lonB.value = currentPos.lon.toFixed(7);
  }
  saveConfig();
  updateCalculations();
}

el.startGpsBtn.addEventListener('click', startGps);
el.syncBtn.addEventListener('click', syncFiveMinutes);
el.resetBtn.addEventListener('click', resetCountdown);
el.armStartBtn.addEventListener('click', armOfficialStart);
el.setABtn.addEventListener('click', () => useCurrentAs('A'));
el.setBBtn.addEventListener('click', () => useCurrentAs('B'));
el.saveBtn.addEventListener('click', () => { saveConfig(); beep(660, 90); updateCalculations(); });
el.languageSelect.addEventListener('change', () => loadLanguage(el.languageSelect.value));

for (const input of [el.latA, el.lonA, el.latB, el.lonB, el.buoySide, el.lineBuffer, el.speedUnit]) {
  input.addEventListener('change', () => { saveConfig(); updateCalculations(); });
}

loadConfig();
loadLanguage(currentLang);
setInterval(updateCalculations, 250);
