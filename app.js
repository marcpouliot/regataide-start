'use strict';

const KNOTS_PER_MPS = 1.9438444924;
const MPH_PER_MPS = 2.2369362921;
const EARTH_RADIUS_M = 6371000;
const START_SECONDS = 5 * 60;
const STORAGE_KEY = 'regataide-start-v2';

let watchId = null;
let currentPos = null;
let startTimeMs = null;
let lastSignalSecond = null;
let audioCtx = null;
let lang = localStorage.getItem('regataide-start-lang') || 'fr';
let dict = {};

let map = null;
let mapReady = false;
let mapCenteredOnce = false;
let boatMarker = null;
let accuracyCircle = null;
let committeeMarker = null;
let buoyMarker = null;
let centerMarker = null;
let gapMarker = null;
let startLineLayer = null;
let gapLineLayer = null;

const $ = (id) => document.getElementById(id);

const el = {
  gpsBadge: $('gpsBadge'),
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
  languageSelect: $('languageSelect'),
  guideLink: $('guideLink'),
  centerMapBtn: $('centerMapBtn'),
  mapStatus: $('mapStatus'),
};

function t(key, fallback = key) {
  return dict[key] || fallback;
}

async function loadLanguage(nextLang = lang) {
  lang = nextLang;
  localStorage.setItem('regataide-start-lang', lang);
  document.documentElement.lang = lang;
  if (el.languageSelect) el.languageSelect.value = lang;
  if (el.guideLink) el.guideLink.href = lang === 'en' ? 'guide-en.html' : 'guide-fr.html';

  try {
    const res = await fetch(`i18n/${lang}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dict = await res.json();
  } catch {
    dict = {};
  }

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (dict[key]) node.textContent = dict[key];
  });
  refreshStaticLabels();
  updateGpsDisplay();
  updateCalculations();
}

function refreshStaticLabels() {
  if (!currentPos && el.gpsBadge) {
    el.gpsBadge.textContent = t('gpsOff', 'GPS OFF');
  }
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

function getSpeedUnit() {
  return el.speedUnit?.value || 'knots';
}

function unitLabel() {
  return getSpeedUnit() === 'mph' ? 'mph' : (lang === 'en' ? 'kt' : 'nds');
}

function speedFactor() {
  return getSpeedUnit() === 'mph' ? MPH_PER_MPS : KNOTS_PER_MPS;
}

function fmtSpeed(mps, decimals = 1) {
  if (!Number.isFinite(mps)) return `-- ${unitLabel()}`;
  return `${fmt(mps * speedFactor(), decimals)} ${unitLabel()}`;
}

function getConfig() {
  return {
    latA: num(el.latA?.value),
    lonA: num(el.lonA?.value),
    latB: num(el.latB?.value),
    lonB: num(el.lonB?.value),
    buoySide: el.buoySide?.value || 'port',
    lineBuffer: Math.max(1, num(el.lineBuffer?.value) ?? 10),
    speedUnit: getSpeedUnit(),
    distanceMode: el.distanceMode?.value || 'perpendicular',
  };
}

function saveConfig() {
  const cfg = getConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    latA: el.latA?.value || '',
    lonA: el.lonA?.value || '',
    latB: el.latB?.value || '',
    lonB: el.lonB?.value || '',
    buoySide: cfg.buoySide,
    lineBuffer: el.lineBuffer?.value || '10',
    speedUnit: cfg.speedUnit,
    distanceMode: cfg.distanceMode,
    lang,
  }));
}

function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const key of ['latA', 'lonA', 'latB', 'lonB', 'buoySide', 'lineBuffer', 'speedUnit', 'distanceMode']) {
      if (cfg[key] !== undefined && el[key]) el[key].value = cfg[key];
    }
    if (cfg.lang) lang = cfg.lang;
  } catch {}
}

function toLocalMeters(lat, lon, refLat, refLon) {
  const latRad = refLat * Math.PI / 180;
  const x = (lon - refLon) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(latRad);
  const y = (lat - refLat) * Math.PI / 180 * EARTH_RADIUS_M;
  return { x, y };
}

function localToLatLon(x, y, refLat, refLon) {
  const lat = refLat + (y / EARTH_RADIUS_M) * 180 / Math.PI;
  const lon = refLon + (x / (EARTH_RADIUS_M * Math.cos(refLat * Math.PI / 180))) * 180 / Math.PI;
  return { lat, lon };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function signedDistanceToLine(pos, cfg) {
  const b = toLocalMeters(cfg.latB, cfg.lonB, cfg.latA, cfg.lonA);
  const p = toLocalMeters(pos.lat, pos.lon, cfg.latA, cfg.lonA);
  const len = Math.hypot(b.x, b.y);
  if (len < 1) return null;
  const cross = b.x * p.y - b.y * p.x;
  return cross / len;
}

function distanceSolution(pos, cfg) {
  const signed = signedDistanceToLine(pos, cfg);
  if (signed === null) return null;

  const side = signed >= 0 ? 'left' : 'right';
  const validSide = cfg.buoySide === 'port' ? 'left' : 'right';
  const valid = side === validSide;

  const b = toLocalMeters(cfg.latB, cfg.lonB, cfg.latA, cfg.lonA);
  const p = toLocalMeters(pos.lat, pos.lon, cfg.latA, cfg.lonA);
  const len2 = b.x * b.x + b.y * b.y;
  const rawT = len2 > 1 ? ((p.x * b.x + p.y * b.y) / len2) : 0.5;
  const projected = localToLatLon(b.x * rawT, b.y * rawT, cfg.latA, cfg.lonA);
  const center = { lat: (cfg.latA + cfg.latB) / 2, lon: (cfg.lonA + cfg.lonB) / 2 };

  if (cfg.distanceMode === 'center') {
    return {
      distanceM: haversineMeters(pos.lat, pos.lon, center.lat, center.lon),
      signedM: signed,
      side,
      valid,
      target: center,
      center,
    };
  }

  return {
    distanceM: Math.abs(signed),
    signedM: signed,
    side,
    valid,
    target: projected,
    center,
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
    for (let i = 0; i < count; i++) {
      setTimeout(() => beep(remainingCeil === 0 ? 1200 : 880, 180), i * 250);
    }
  }
}

function updateGpsDisplay() {
  if (!currentPos) {
    if (el.currentSpeed) el.currentSpeed.textContent = `-- ${unitLabel()}`;
    return;
  }
  el.lat.textContent = currentPos.lat.toFixed(7);
  el.lon.textContent = currentPos.lon.toFixed(7);
  el.accuracy.textContent = `${fmt(currentPos.accuracy, 0)} m`;
  el.currentSpeed.textContent = fmtSpeed(currentPos.speedMps, 1);
}

function updateClocks() {
  const now = Date.now();
  el.currentClock.textContent = fmtClock(now);
  el.startClock.textContent = startTimeMs === null ? '--:--:--' : fmtClock(startTimeMs);
}

function updateCalculations() {
  updateClocks();

  const now = Date.now();
  const remaining = startTimeMs === null ? null : (startTimeMs - now) / 1000;
  const timerText = fmtTimer(remaining);
  el.timer.textContent = timerText;
  el.fixedTimer.textContent = timerText;

  if (Number.isFinite(remaining)) playSignal(Math.max(0, Math.ceil(remaining)));

  const cfg = getConfig();
  const hasLine = [cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite);

  let targetText = t('targetEmpty', 'Cible : --');

  if (!currentPos || !hasLine) {
    el.distanceToLine.textContent = '-- m';
    el.idealSpeed.textContent = `-- ${unitLabel()}`;
    setStatus('---', '');
    targetText = hasLine ? t('waitingGps', 'En attente GPS') : t('enterLine', 'Entrer la ligne A-B');
    el.targetLine.textContent = targetText;
    el.fixedTarget.textContent = targetText;
    updateMap();
    return;
  }

  const solution = distanceSolution(currentPos, cfg);
  if (!solution) return;

  const inBuffer = solution.distanceM <= cfg.lineBuffer;
  el.distanceToLine.textContent = `${fmt(solution.distanceM, 0)} m`;
  el.sideText.textContent = solution.valid ? t('goodSide', 'Pré-départ OK') : t('wrongSide', 'Côté course / ligne franchie');

  if (!Number.isFinite(remaining) || remaining <= 0) {
    targetText = t('notSynced', 'Départ non synchronisé ou terminé');
    el.targetLine.textContent = targetText;
    el.fixedTarget.textContent = targetText;
    el.idealSpeed.textContent = `-- ${unitLabel()}`;
    setStatus('---', '');
    updateMap(solution);
    return;
  }

  if (!solution.valid && !inBuffer) {
    targetText = t('returnSide', 'Revenir du bon côté de la ligne');
    el.targetLine.textContent = targetText;
    el.fixedTarget.textContent = targetText;
    el.idealSpeed.textContent = `-- ${unitLabel()}`;
    setStatus(t('return', 'REVENIR'), 'bad');
    updateMap(solution);
    return;
  }

  const target = targetSecondsRemaining(remaining);
  const secondsToTarget = remaining - target;
  const idealMps = secondsToTarget > 1 ? solution.distanceM / secondsToTarget : null;

  targetText = `${t('target', 'Cible')} : ${fmtTimer(target)} | ${t('availableTime', 'temps dispo')} : ${fmt(secondsToTarget, 0)} s`;
  el.targetLine.textContent = targetText;
  el.fixedTarget.textContent = targetText;
  el.idealSpeed.textContent = fmtSpeed(idealMps, 1);

  if (!Number.isFinite(idealMps) || !Number.isFinite(currentPos.speedMps)) {
    setStatus(t('calc', 'CALCUL'), 'warn');
  } else {
    const deltaMps = idealMps - currentPos.speedMps;
    const toleranceMps = getSpeedUnit() === 'mph' ? 0.2 : 0.205; // roughly 0.4 kt
    if (Math.abs(deltaMps) <= toleranceMps) setStatus(t('ok', 'OK'), 'ok');
    else if (deltaMps > 0) setStatus(t('accelerate', 'ACCÉLÉRER'), 'warn');
    else setStatus(t('slowDown', 'RALENTIR'), 'bad');
  }

  updateMap(solution);
}

function setStatus(text, cls) {
  el.speedStatus.textContent = text;
  el.statusCard.className = `card status ${cls || ''}`.trim();
}

function initMap() {
  if (!window.L || !$('map')) {
    if (el.mapStatus) el.mapStatus.textContent = t('mapUnavailable', 'Carte non disponible.');
    return;
  }

  map = L.map('map', { zoomControl: true });
  map.setView([45.5, -71.0], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  mapReady = true;
  updateMap();
}

function setCircleMarker(existing, latlng, options, tooltip) {
  if (!mapReady) return null;
  if (!existing) {
    existing = L.circleMarker(latlng, options).addTo(map);
    if (tooltip) existing.bindTooltip(tooltip, { permanent: true, direction: 'top', offset: [0, -8], className: 'map-label' });
  } else {
    existing.setLatLng(latlng);
    if (tooltip && existing.getTooltip()) existing.setTooltipContent(tooltip);
  }
  return existing;
}

function removeLayer(layer) {
  if (layer && mapReady) map.removeLayer(layer);
  return null;
}

function updateMap(solution = null) {
  if (!mapReady) return;

  const cfg = getConfig();
  const hasLine = [cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite);

  if (currentPos) {
    const boatLatLng = [currentPos.lat, currentPos.lon];
    boatMarker = setCircleMarker(boatMarker, boatLatLng, {
      radius: 10,
      weight: 3,
      color: '#ffffff',
      fillColor: '#1e90ff',
      fillOpacity: 1,
    }, t('boat', 'Bateau'));

    if (!accuracyCircle) {
      accuracyCircle = L.circle(boatLatLng, {
        radius: currentPos.accuracy || 0,
        weight: 1,
        color: '#1e90ff',
        fillColor: '#1e90ff',
        fillOpacity: 0.08,
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(boatLatLng);
      accuracyCircle.setRadius(currentPos.accuracy || 0);
    }

    if (!mapCenteredOnce) {
      map.setView(boatLatLng, 17);
      mapCenteredOnce = true;
    }
  }

  if (!hasLine) {
    committeeMarker = removeLayer(committeeMarker);
    buoyMarker = removeLayer(buoyMarker);
    centerMarker = removeLayer(centerMarker);
    gapMarker = removeLayer(gapMarker);
    startLineLayer = removeLayer(startLineLayer);
    gapLineLayer = removeLayer(gapLineLayer);
    if (el.mapStatus) el.mapStatus.textContent = currentPos ? t('mapNeedLine', 'GPS OK. Entre ou capture la ligne A-B.') : t('mapWaiting', 'Carte prête. Active le GPS et entre la ligne A-B.');
    return;
  }

  const a = [cfg.latA, cfg.lonA];
  const b = [cfg.latB, cfg.lonB];
  const center = solution?.center || { lat: (cfg.latA + cfg.latB) / 2, lon: (cfg.lonA + cfg.lonB) / 2 };

  committeeMarker = setCircleMarker(committeeMarker, a, { radius: 8, weight: 2, color: '#ffffff', fillColor: '#ffce4a', fillOpacity: 1 }, t('committeeA', 'Comité A'));
  buoyMarker = setCircleMarker(buoyMarker, b, { radius: 8, weight: 2, color: '#ffffff', fillColor: '#ff5d5d', fillOpacity: 1 }, t('buoyB', 'Bouée B'));
  centerMarker = setCircleMarker(centerMarker, [center.lat, center.lon], { radius: 5, weight: 2, color: '#ffffff', fillColor: '#36d17c', fillOpacity: 0.9 }, t('center', 'Centre'));

  if (!startLineLayer) {
    startLineLayer = L.polyline([a, b], { weight: 4, color: '#ffce4a' }).addTo(map);
  } else {
    startLineLayer.setLatLngs([a, b]);
  }

  if (solution && currentPos) {
    const gap = [solution.target.lat, solution.target.lon];
    gapMarker = setCircleMarker(gapMarker, gap, { radius: 6, weight: 2, color: '#ffffff', fillColor: '#b56cff', fillOpacity: 1 }, t('gapPoint', 'Point GAP'));
    const boat = [currentPos.lat, currentPos.lon];
    if (!gapLineLayer) {
      gapLineLayer = L.polyline([boat, gap], { weight: 3, color: '#b56cff', dashArray: '7 7' }).addTo(map);
    } else {
      gapLineLayer.setLatLngs([boat, gap]);
    }
  }

  if (el.mapStatus) {
    const modeText = cfg.distanceMode === 'center' ? t('distanceCenter', 'Centre de la ligne') : t('distancePerpendicular', 'Perpendiculaire à la ligne');
    const sideText = cfg.buoySide === 'port' ? t('buoyPort', 'Bouée à bâbord') : t('buoyStarboard', 'Bouée à tribord');
    el.mapStatus.textContent = `${modeText} · ${sideText}`;
  }
}

function centerMap() {
  if (!mapReady) return;
  if (currentPos) {
    map.setView([currentPos.lat, currentPos.lon], Math.max(map.getZoom(), 17));
    return;
  }
  const cfg = getConfig();
  if ([cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite)) {
    const bounds = L.latLngBounds([[cfg.latA, cfg.lonA], [cfg.latB, cfg.lonB]]);
    map.fitBounds(bounds.pad(0.4));
  }
}

function startGps() {
  if (!('geolocation' in navigator)) {
    el.gpsBadge.textContent = t('gpsUnsupported', 'GPS NON SUPPORTÉ');
    el.gpsBadge.className = 'badge bad';
    return;
  }

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  el.gpsBadge.textContent = t('gpsStarting', 'GPS...');
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
      updateMap();
    },
    (err) => {
      el.gpsBadge.textContent = err.code === 1 ? t('gpsDenied', 'GPS REFUSÉ') : t('gpsError', 'GPS ERREUR');
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
  const value = el.officialStartTime?.value;
  if (!value) return;
  const [h, m, s = '0'] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, s, 0);
  startTimeMs = d.getTime();
  // If this time has already passed today, assume the user means tomorrow.
  if (startTimeMs < Date.now() - 1000) startTimeMs += 24 * 60 * 60 * 1000;
  lastSignalSecond = null;
  beep(880, 120);
  updateCalculations();
}

function resetCountdown() {
  startTimeMs = null;
  lastSignalSecond = null;
  el.timer.textContent = '--:--';
  el.fixedTimer.textContent = '--:--';
  el.targetLine.textContent = t('targetEmpty', 'Cible : --');
  el.fixedTarget.textContent = t('targetEmpty', 'Cible : --');
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
  updateMap();
}

function wireEvents() {
  el.startGpsBtn?.addEventListener('click', startGps);
  el.syncBtn?.addEventListener('click', syncFiveMinutes);
  el.resetBtn?.addEventListener('click', resetCountdown);
  el.armStartBtn?.addEventListener('click', armOfficialStart);
  el.setABtn?.addEventListener('click', () => useCurrentAs('A'));
  el.setBBtn?.addEventListener('click', () => useCurrentAs('B'));
  el.saveBtn?.addEventListener('click', () => { saveConfig(); beep(660, 90); updateCalculations(); updateMap(); });
  el.centerMapBtn?.addEventListener('click', centerMap);
  el.languageSelect?.addEventListener('change', () => loadLanguage(el.languageSelect.value));

  for (const input of [el.latA, el.lonA, el.latB, el.lonB, el.buoySide, el.lineBuffer, el.speedUnit, el.distanceMode]) {
    input?.addEventListener('change', () => { saveConfig(); updateGpsDisplay(); updateCalculations(); updateMap(); });
  }
}

loadConfig();
wireEvents();
loadLanguage(lang);
initMap();
setInterval(updateCalculations, 250);
updateCalculations();
