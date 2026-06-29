'use strict';

const KNOTS_PER_MPS = 1.9438444924;
const MPH_PER_MPS = 2.2369362921;
const EARTH_RADIUS_M = 6371000;
const START_SECONDS = 5 * 60;
const CONFIG_STORAGE_KEY = 'regataide-start2-config';
const LANG_STORAGE_KEY = 'regataide-start2-lang';
const DEFAULT_CONFIG = {
  latA: '45.840722',
  lonA: '-71.112139',
  latB: '45.8404030',
  lonB: '-71.1172860',
  buoySide: 'port',
  lineBuffer: '10',
  speedUnit: 'knots',
  distanceMode: 'perpendicular',
  configFileName: 'regataide-start-config',
};

let watchId = null;
let currentPos = null;
let startTimeMs = null;
let lastSignalSecond = null;
let audioCtx = null;
let i18n = {};
let currentLang = localStorage.getItem(LANG_STORAGE_KEY) || 'fr';
let map = null;
let mapReady = false;
let mapAutoCentered = false;
let boatMarker = null;
let gpsCircle = null;
let lineLayer = null;
let committeeMarker = null;
let buoyMarker = null;
let centerMarker = null;
let gapMarker = null;
let gapLine = null;

const $ = (id) => document.getElementById(id);

const el = {
  gpsBadge: $('gpsBadge'),
  fullScreenBtn: $('fullScreenBtn'),
  fixedTimer: $('fixedTimer'),
  fixedTarget: $('fixedTarget'),
  currentClock: $('currentClock'),
  startClock: $('startClock'),
  timer: $('timer'),
  targetLine: $('targetLine'),
  startGpsBtn: $('startGpsBtn'),
  syncBtn: $('syncBtn'),
  resetBtn: $('resetBtn'),
  armStartBtn: $('armStartBtn'),
  officialStartTime: $('officialStartTime'),
  speedUnit: $('speedUnit'),
  distanceMode: $('distanceMode'),
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
  configFileName: $('configFileName'),
  exportConfigBtn: $('exportConfigBtn'),
  importConfigFile: $('importConfigFile'),
  configStatus: $('configStatus'),
  languageSelect: $('languageSelect'),
  guideLink: $('guideLink'),
  centerMapBtn: $('centerMapBtn'),
  mapStatus: $('mapStatus'),
};

function t(key) {
  return i18n[key] || key;
}

async function loadLanguage(lang) {
  currentLang = lang || 'fr';
  localStorage.setItem(LANG_STORAGE_KEY, currentLang);
  document.documentElement.lang = currentLang;
  if (el.languageSelect) el.languageSelect.value = currentLang;
  if (el.guideLink) el.guideLink.href = currentLang === 'en' ? 'guide-en.html' : 'guide-fr.html';
  try {
    const res = await fetch(`i18n/${currentLang}.json`, { cache: 'no-store' });
    i18n = await res.json();
  } catch {
    i18n = {};
  }
  applyI18n();
  updateDynamicText();
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    const value = t(key);
    if (value !== key) node.textContent = value;
  });
}

async function requestFullscreenOnce() {
  const root = document.documentElement;
  if (document.fullscreenElement) return;
  const request = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  if (!request) return;
  try {
    await request.call(root);
  } catch {
    // Browsers often require a user gesture.
  }
}

function setupFullscreenRequest() {
  el.fullScreenBtn?.addEventListener('click', requestFullscreenOnce);
  requestFullscreenOnce();
  window.addEventListener('pointerdown', () => requestFullscreenOnce(), { once: true, passive: true });
  window.addEventListener('keydown', () => requestFullscreenOnce(), { once: true });
}

function num(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
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
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function speedInfo(mps) {
  const unit = el.speedUnit?.value || 'knots';
  if (!Number.isFinite(mps)) return { value: null, label: unit === 'mph' ? 'mph' : 'nds' };
  return unit === 'mph'
    ? { value: mps * MPH_PER_MPS, label: 'mph' }
    : { value: mps * KNOTS_PER_MPS, label: 'nds' };
}

function getConfigRaw() {
  return {
    latA: el.latA.value.trim(),
    lonA: el.lonA.value.trim(),
    latB: el.latB.value.trim(),
    lonB: el.lonB.value.trim(),
    buoySide: el.buoySide.value,
    lineBuffer: el.lineBuffer.value.trim() || '10',
    speedUnit: el.speedUnit.value,
    distanceMode: el.distanceMode.value,
    configFileName: el.configFileName.value.trim() || DEFAULT_CONFIG.configFileName,
  };
}

function getConfig() {
  const raw = getConfigRaw();
  return {
    ...raw,
    latA: num(raw.latA),
    lonA: num(raw.lonA),
    latB: num(raw.latB),
    lonB: num(raw.lonB),
    lineBuffer: Math.max(1, num(raw.lineBuffer) ?? 10),
  };
}

function applyConfig(cfg = {}) {
  const merged = { ...DEFAULT_CONFIG, ...(cfg.settings || cfg) };
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (el[key] && merged[key] !== undefined) el[key].value = merged[key];
  }
  updateDynamicText();
  updateMap();
}

function saveConfigLocal(showStatus = true) {
  const payload = {
    app: 'Regataide Start2',
    version: 1,
    savedAt: new Date().toISOString(),
    settings: getConfigRaw(),
  };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload));
  if (showStatus) setConfigStatus(t('localSaved'));
}

function loadConfigLocal() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) {
      applyConfig(DEFAULT_CONFIG);
      saveConfigLocal(false);
      return;
    }
    applyConfig(JSON.parse(raw));
  } catch {
    applyConfig(DEFAULT_CONFIG);
  }
}

function sanitizeFileName(name) {
  const safe = String(name || DEFAULT_CONFIG.configFileName)
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return (safe || DEFAULT_CONFIG.configFileName) + '.json';
}

function exportConfigFile() {
  saveConfigLocal(false);
  const payload = {
    app: 'Regataide Start2',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getConfigRaw(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFileName(el.configFileName.value);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setConfigStatus(`${t('exportedConfig')} ${a.download}`);
  beep(700, 90);
}

async function importConfigFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const settings = parsed.settings || parsed;
    if (settings && typeof settings === 'object') {
      if (!settings.configFileName) settings.configFileName = file.name.replace(/\.json$/i, '');
      applyConfig(settings);
      saveConfigLocal(false);
      setConfigStatus(`${t('loadedConfig')} ${file.name}`);
      beep(760, 90);
    }
  } catch (error) {
    console.error(error);
    setConfigStatus(t('loadError'));
  } finally {
    el.importConfigFile.value = '';
  }
}

function setConfigStatus(text) {
  if (el.configStatus) el.configStatus.textContent = text;
}

function toLocalMeters(lat, lon, refLat, refLon) {
  const latRad = refLat * Math.PI / 180;
  const x = (lon - refLon) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(latRad);
  const y = (lat - refLat) * Math.PI / 180 * EARTH_RADIUS_M;
  return { x, y };
}

function fromLocalMeters(x, y, refLat, refLon) {
  const lat = refLat + (y / EARTH_RADIUS_M) * 180 / Math.PI;
  const lon = refLon + (x / (EARTH_RADIUS_M * Math.cos(refLat * Math.PI / 180))) * 180 / Math.PI;
  return { lat, lon };
}

function lineGeometry(pos, cfg) {
  const b = toLocalMeters(cfg.latB, cfg.lonB, cfg.latA, cfg.lonA);
  const p = toLocalMeters(pos.lat, pos.lon, cfg.latA, cfg.lonA);
  const len2 = b.x * b.x + b.y * b.y;
  const len = Math.sqrt(len2);
  if (len < 1) return null;

  const cross = b.x * p.y - b.y * p.x;
  const signed = cross / len;
  const side = signed >= 0 ? 'port' : 'starboard';
  const rawT = (p.x * b.x + p.y * b.y) / len2;
  const clampedT = Math.max(0, Math.min(1, rawT));
  const foot = { x: b.x * clampedT, y: b.y * clampedT };
  const center = { x: b.x / 2, y: b.y / 2 };

  const useCenter = cfg.distanceMode === 'center';
  const target = useCenter ? center : foot;
  const dx = p.x - target.x;
  const dy = p.y - target.y;
  const distance = Math.hypot(dx, dy);

  return {
    signed,
    side,
    distance,
    inBuffer: Math.abs(signed) <= cfg.lineBuffer,
    targetLatLon: fromLocalMeters(target.x, target.y, cfg.latA, cfg.lonA),
    centerLatLon: fromLocalMeters(center.x, center.y, cfg.latA, cfg.lonA),
  };
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
    gain.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + 0.02);
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
    for (let i = 0; i < count; i++) {
      setTimeout(() => beep(remainingCeil === 0 ? 1200 : 880, 180), i * 250);
    }
  }
}

function initMap() {
  if (!window.L || !$('map')) {
    setMapStatus(t('mapUnavailable'));
    return;
  }
  const cfg = getConfig();
  const startCenter = [cfg.latA || 45.840722, cfg.lonA || -71.112139];
  map = L.map('map', { zoomControl: true }).setView(startCenter, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  mapReady = true;
  updateMap();
  setMapStatus(t('mapWaiting'));
}

function iconHtml(className, label) {
  return L.divIcon({
    className: `map-marker ${className}`,
    html: `<span></span><b>${label}</b>`,
    iconSize: [90, 30],
    iconAnchor: [10, 10],
  });
}

function setMapStatus(text) {
  if (el.mapStatus) el.mapStatus.textContent = text;
}

function updateMap() {
  if (!mapReady) return;
  const cfg = getConfig();
  const hasLine = [cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite);

  if (currentPos) {
    const latLng = [currentPos.lat, currentPos.lon];
    if (!boatMarker) {
      boatMarker = L.marker(latLng, { icon: iconHtml('boat', t('boat')) }).addTo(map);
      boatMarker.bindTooltip(t('boat'), { permanent: true, direction: 'right', offset: [8, 0] });
    } else {
      boatMarker.setLatLng(latLng);
    }
    if (!gpsCircle) {
      gpsCircle = L.circle(latLng, { radius: currentPos.accuracy || 0 }).addTo(map);
    } else {
      gpsCircle.setLatLng(latLng).setRadius(currentPos.accuracy || 0);
    }
    if (!mapAutoCentered) {
      map.setView(latLng, Math.max(map.getZoom(), 16));
      mapAutoCentered = true;
    }
  }

  if (hasLine) {
    const a = [cfg.latA, cfg.lonA];
    const b = [cfg.latB, cfg.lonB];
    if (!lineLayer) lineLayer = L.polyline([a, b], { weight: 4 }).addTo(map);
    else lineLayer.setLatLngs([a, b]);

    if (!committeeMarker) committeeMarker = L.marker(a, { icon: iconHtml('committee', 'A') }).addTo(map);
    else committeeMarker.setLatLng(a);
    if (!buoyMarker) buoyMarker = L.marker(b, { icon: iconHtml('buoy', 'B') }).addTo(map);
    else buoyMarker.setLatLng(b);

    const center = fromLocalMeters(
      toLocalMeters(cfg.latB, cfg.lonB, cfg.latA, cfg.lonA).x / 2,
      toLocalMeters(cfg.latB, cfg.lonB, cfg.latA, cfg.lonA).y / 2,
      cfg.latA,
      cfg.lonA
    );
    if (!centerMarker) centerMarker = L.circleMarker([center.lat, center.lon], { radius: 6 }).addTo(map);
    else centerMarker.setLatLng([center.lat, center.lon]);

    if (currentPos) {
      const geo = lineGeometry(currentPos, cfg);
      if (geo) {
        const target = [geo.targetLatLon.lat, geo.targetLatLon.lon];
        if (!gapMarker) gapMarker = L.circleMarker(target, { radius: 8 }).addTo(map);
        else gapMarker.setLatLng(target);
        if (!gapLine) gapLine = L.polyline([[currentPos.lat, currentPos.lon], target], { dashArray: '6 8', weight: 2 }).addTo(map);
        else gapLine.setLatLngs([[currentPos.lat, currentPos.lon], target]);
      }
    }
    setMapStatus(t('mapReady'));
  }
}

function centerMap() {
  if (!mapReady) return;
  if (currentPos) {
    map.setView([currentPos.lat, currentPos.lon], Math.max(map.getZoom(), 16));
    return;
  }
  const cfg = getConfig();
  if ([cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite)) {
    map.fitBounds([[cfg.latA, cfg.lonA], [cfg.latB, cfg.lonB]], { padding: [30, 30] });
  }
}

function updateGpsDisplay() {
  if (!currentPos) return;
  el.lat.textContent = currentPos.lat.toFixed(7);
  el.lon.textContent = currentPos.lon.toFixed(7);
  el.accuracy.textContent = `${fmt(currentPos.accuracy, 0)} m`;
  const speed = speedInfo(currentPos.speedMps);
  el.currentSpeed.textContent = speed.value === null ? `-- ${speed.label}` : `${fmt(speed.value, 1)} ${speed.label}`;
}

function updateDynamicText() {
  updateGpsDisplay();
  updateCalculations();
}

function updateClocks(remaining) {
  const now = Date.now();
  el.currentClock.textContent = fmtClock(now);
  el.startClock.textContent = startTimeMs ? fmtClock(startTimeMs) : '--:--:--';
  const timerText = fmtTimer(remaining);
  el.timer.textContent = timerText;
  el.fixedTimer.textContent = timerText;
}

function updateCalculations() {
  const now = Date.now();
  const remaining = startTimeMs === null ? null : (startTimeMs - now) / 1000;
  updateClocks(remaining);

  if (Number.isFinite(remaining)) playSignal(Math.max(0, Math.ceil(remaining)));

  const cfg = getConfig();
  const hasLine = [cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite);

  if (!currentPos || !hasLine) {
    el.distanceToLine.textContent = '-- m';
    const speed = speedInfo(null);
    el.idealSpeed.textContent = `-- ${speed.label}`;
    el.speedStatus.textContent = '---';
    const msg = hasLine ? t('waitingGps') : t('enterLine');
    el.targetLine.textContent = msg;
    el.fixedTarget.textContent = msg;
    updateMap();
    return;
  }

  const geo = lineGeometry(currentPos, cfg);
  if (!geo) return;

  const goodSide = geo.side === cfg.buoySide;
  el.distanceToLine.textContent = `${fmt(geo.distance, 0)} m`;
  el.sideText.textContent = goodSide ? t('goodSide') : t('wrongSide');

  if (!Number.isFinite(remaining) || remaining <= 0) {
    el.targetLine.textContent = t('notSynced');
    el.fixedTarget.textContent = t('notSynced');
    const speed = speedInfo(null);
    el.idealSpeed.textContent = `-- ${speed.label}`;
    setStatus('---', '');
    updateMap();
    return;
  }

  if (!goodSide && !geo.inBuffer) {
    el.targetLine.textContent = t('returnSide');
    el.fixedTarget.textContent = t('returnSide');
    const speed = speedInfo(null);
    el.idealSpeed.textContent = `-- ${speed.label}`;
    setStatus(t('return'), 'bad');
    updateMap();
    return;
  }

  const target = targetSecondsRemaining(remaining);
  const secondsToTarget = remaining - target;
  const idealMps = secondsToTarget > 1 ? geo.distance / secondsToTarget : null;
  const ideal = speedInfo(idealMps);
  const current = speedInfo(currentPos.speedMps);

  const targetText = `${t('target')}: ${fmtTimer(target)} | ${t('availableTime')}: ${fmt(secondsToTarget, 0)} s`;
  el.targetLine.textContent = targetText;
  el.fixedTarget.textContent = targetText;
  el.idealSpeed.textContent = ideal.value === null ? `-- ${ideal.label}` : `${fmt(ideal.value, 1)} ${ideal.label}`;

  if (ideal.value === null || current.value === null) {
    setStatus(t('calc'), 'warn');
  } else {
    const delta = ideal.value - current.value;
    const tolerance = el.speedUnit.value === 'mph' ? 0.45 : 0.4;
    if (Math.abs(delta) <= tolerance) setStatus(t('ok'), 'ok');
    else if (delta > 0) setStatus(t('accelerate'), 'warn');
    else setStatus(t('slowDown'), 'bad');
  }

  updateMap();
}

function setStatus(text, cls) {
  el.speedStatus.textContent = text;
  el.statusCard.className = `card status ${cls}`.trim();
}

function startGps() {
  requestFullscreenOnce();
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
      el.gpsBadge.textContent = `GPS ±${fmt(currentPos.accuracy, 0)} m`;
      el.gpsBadge.className = currentPos.accuracy <= 10 ? 'badge good' : 'badge warn';
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
  requestFullscreenOnce();
  startTimeMs = Date.now() + START_SECONDS * 1000;
  lastSignalSecond = null;
  beep(880, 180);
  updateCalculations();
}

function armOfficialStart() {
  requestFullscreenOnce();
  const value = el.officialStartTime.value;
  if (!value) return;
  const [hh = '0', mm = '0', ss = '0'] = value.split(':');
  const d = new Date();
  d.setHours(Number(hh), Number(mm), Number(ss), 0);
  startTimeMs = d.getTime();
  lastSignalSecond = null;
  beep(880, 120);
  updateCalculations();
}

function resetCountdown() {
  startTimeMs = null;
  lastSignalSecond = null;
  el.timer.textContent = '--:--';
  el.fixedTimer.textContent = '--:--';
  el.startClock.textContent = '--:--:--';
  el.targetLine.textContent = t('targetEmpty');
  el.fixedTarget.textContent = t('targetEmpty');
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
  saveConfigLocal(false);
  updateCalculations();
}

function bindEvents() {
  el.startGpsBtn.addEventListener('click', startGps);
  el.syncBtn.addEventListener('click', syncFiveMinutes);
  el.resetBtn.addEventListener('click', resetCountdown);
  el.armStartBtn.addEventListener('click', armOfficialStart);
  el.setABtn.addEventListener('click', () => useCurrentAs('A'));
  el.setBBtn.addEventListener('click', () => useCurrentAs('B'));
  el.saveBtn.addEventListener('click', () => { saveConfigLocal(true); beep(660, 90); updateCalculations(); });
  el.exportConfigBtn.addEventListener('click', exportConfigFile);
  el.importConfigFile.addEventListener('change', () => importConfigFile(el.importConfigFile.files[0]));
  el.centerMapBtn.addEventListener('click', centerMap);
  el.languageSelect.addEventListener('change', () => loadLanguage(el.languageSelect.value));

  for (const input of [el.latA, el.lonA, el.latB, el.lonB, el.buoySide, el.lineBuffer, el.speedUnit, el.distanceMode, el.configFileName]) {
    input.addEventListener('change', () => { saveConfigLocal(false); updateCalculations(); });
  }
}

async function init() {
  bindEvents();
  setupFullscreenRequest();
  loadConfigLocal();
  await loadLanguage(currentLang);
  initMap();
  setInterval(updateCalculations, 250);
  updateCalculations();
}

init();
