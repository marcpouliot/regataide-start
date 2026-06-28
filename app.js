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
let translations = {};
let lang = localStorage.getItem('regataide-start-lang') || 'fr';

let map = null;
let mapHasCentered = false;
const mapLayers = {
  boat: null,
  accuracy: null,
  startLine: null,
  committee: null,
  buoy: null,
  center: null,
  gap: null,
  gapLine: null,
};

const $ = (id) => document.getElementById(id);

const el = {
  gpsBadge: $('gpsBadge'),
  guideLink: $('guideLink'),
  languageSelect: $('languageSelect'),
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
  map: $('map'),
  mapStatus: $('mapStatus'),
  centerMapBtn: $('centerMapBtn'),
};

function t(key) {
  return translations[key] || key;
}

async function loadLanguage(nextLang = lang) {
  lang = nextLang;
  localStorage.setItem('regataide-start-lang', lang);
  document.documentElement.lang = lang;
  el.languageSelect.value = lang;
  el.guideLink.href = lang === 'en' ? 'guide-en.html' : 'guide-fr.html';

  try {
    const res = await fetch(`i18n/${lang}.json`, { cache: 'no-store' });
    translations = await res.json();
  } catch {
    translations = {};
  }

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (translations[key]) node.textContent = translations[key];
  });

  updateGpsBadge();
  updateGpsDisplay();
  initMap();
  updateCalculations();
  updateMap();
}

function num(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function fmt(n, decimals = 0) {
  return Number.isFinite(n) ? n.toFixed(decimals) : '--';
}

function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '--:--:--';
  return new Date(ms).toLocaleTimeString(lang === 'en' ? 'en-CA' : 'fr-CA', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function fmtTimer(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const sign = seconds < 0 ? '+' : '';
  const s = Math.abs(Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${sign}${m}:${String(r).padStart(2, '0')}`;
}

function speedLabel(mps) {
  if (!Number.isFinite(mps)) return '--';
  if (el.speedUnit.value === 'mph') return `${fmt(mps * MPH_PER_MPS, 1)} mph`;
  return `${fmt(mps * KNOTS_PER_MPS, 1)} nds`;
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
    distanceMode: el.distanceMode.value,
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
    distanceMode: el.distanceMode.value,
    officialStartTime: el.officialStartTime.value,
  }));
}

function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const key of ['latA', 'lonA', 'latB', 'lonB', 'buoySide', 'lineBuffer', 'speedUnit', 'distanceMode', 'officialStartTime']) {
      if (cfg[key] !== undefined && el[key]) el[key].value = cfg[key];
    }
  } catch {}
}

function toLocalMeters(lat, lon, refLat, refLon) {
  const latRad = refLat * Math.PI / 180;
  return {
    x: (lon - refLon) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(latRad),
    y: (lat - refLat) * Math.PI / 180 * EARTH_RADIUS_M,
  };
}

function metersToLatLon(x, y, refLat, refLon) {
  const latRad = refLat * Math.PI / 180;
  return {
    lat: refLat + (y / EARTH_RADIUS_M) * 180 / Math.PI,
    lon: refLon + (x / (EARTH_RADIUS_M * Math.cos(latRad))) * 180 / Math.PI,
  };
}

function lineMetrics(pos, cfg) {
  const b = toLocalMeters(cfg.latB, cfg.lonB, cfg.latA, cfg.lonA);
  const p = toLocalMeters(pos.lat, pos.lon, cfg.latA, cfg.lonA);
  const len = Math.hypot(b.x, b.y);
  if (len < 1) return null;

  const cross = b.x * p.y - b.y * p.x;
  const signed = cross / len;
  const side = signed >= 0 ? 'left' : 'right';

  const center = { x: b.x / 2, y: b.y / 2 };
  const centerLatLon = metersToLatLon(center.x, center.y, cfg.latA, cfg.lonA);
  const centerDistance = Math.hypot(p.x - center.x, p.y - center.y);

  const projectionRatio = (p.x * b.x + p.y * b.y) / (len * len);
  const projected = { x: b.x * projectionRatio, y: b.y * projectionRatio };
  const projectedLatLon = metersToLatLon(projected.x, projected.y, cfg.latA, cfg.lonA);

  return {
    signed,
    side,
    perpendicularDistance: Math.abs(signed),
    centerDistance,
    centerLatLon,
    projectedLatLon,
  };
}


function initMap() {
  if (!el.map || map) return;
  if (!window.L) {
    if (el.mapStatus) el.mapStatus.textContent = t('mapLeafletMissing');
    return;
  }

  map = L.map(el.map, { zoomControl: true, attributionControl: true }).setView([45.4, -71.0], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 100);
}

function removeLayer(key) {
  const layer = mapLayers[key];
  if (map && layer) map.removeLayer(layer);
  mapLayers[key] = null;
}

function setCircleLayer(key, latlng, label, options = {}) {
  if (!map) return;
  const style = Object.assign({
    radius: 7,
    weight: 3,
    opacity: 1,
    fillOpacity: 0.85,
  }, options);

  if (!mapLayers[key]) {
    mapLayers[key] = L.circleMarker(latlng, style).addTo(map);
  } else {
    mapLayers[key].setLatLng(latlng);
    mapLayers[key].setStyle(style);
  }
  mapLayers[key].bindTooltip(label, { permanent: false, direction: 'top' });
}

function fitMapToData() {
  if (!map) return;
  const cfg = getConfig();
  const points = [];
  if (currentPos) points.push([currentPos.lat, currentPos.lon]);
  if ([cfg.latA, cfg.lonA].every(Number.isFinite)) points.push([cfg.latA, cfg.lonA]);
  if ([cfg.latB, cfg.lonB].every(Number.isFinite)) points.push([cfg.latB, cfg.lonB]);

  if (points.length === 1) map.setView(points[0], 16);
  if (points.length > 1) map.fitBounds(points, { padding: [35, 35], maxZoom: 18 });
  mapHasCentered = true;
  setTimeout(() => map.invalidateSize(), 50);
}

function updateMap() {
  if (!map) return;

  const cfg = getConfig();
  const hasLine = [cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite);
  let status = t('mapWaiting');

  if (currentPos) {
    const boatLatLng = [currentPos.lat, currentPos.lon];
    setCircleLayer('boat', boatLatLng, t('boatPosition'), {
      color: '#4db6ff', fillColor: '#4db6ff', radius: 8,
    });

    if (!mapLayers.accuracy) {
      mapLayers.accuracy = L.circle(boatLatLng, {
        radius: Math.max(1, currentPos.accuracy || 1),
        color: '#4db6ff', fillColor: '#4db6ff', fillOpacity: 0.08, weight: 1,
      }).addTo(map);
    } else {
      mapLayers.accuracy.setLatLng(boatLatLng);
      mapLayers.accuracy.setRadius(Math.max(1, currentPos.accuracy || 1));
    }
    status = `GPS ±${fmt(currentPos.accuracy, 0)} m`;
  } else {
    removeLayer('boat');
    removeLayer('accuracy');
  }

  if (hasLine) {
    const a = [cfg.latA, cfg.lonA];
    const b = [cfg.latB, cfg.lonB];
    if (!mapLayers.startLine) {
      mapLayers.startLine = L.polyline([a, b], { color: '#ffffff', weight: 4, opacity: 0.9 }).addTo(map);
    } else {
      mapLayers.startLine.setLatLngs([a, b]);
    }

    setCircleLayer('committee', a, t('committeeBoat'), { color: '#ffce4a', fillColor: '#ffce4a', radius: 7 });
    setCircleLayer('buoy', b, t('startingBuoy'), { color: '#ff5d5d', fillColor: '#ff5d5d', radius: 7 });

    const metricsForCenter = currentPos ? lineMetrics(currentPos, cfg) : null;
    let centerLatLon;
    if (metricsForCenter) {
      centerLatLon = metricsForCenter.centerLatLon;
    } else {
      centerLatLon = {
        lat: (cfg.latA + cfg.latB) / 2,
        lon: (cfg.lonA + cfg.lonB) / 2,
      };
    }
    setCircleLayer('center', [centerLatLon.lat, centerLatLon.lon], t('lineCenter'), {
      color: '#c58cff', fillColor: '#c58cff', radius: 5,
    });

    if (currentPos) {
      const metrics = lineMetrics(currentPos, cfg);
      if (metrics) {
        const target = cfg.distanceMode === 'center' ? metrics.centerLatLon : metrics.projectedLatLon;
        const targetLatLng = [target.lat, target.lon];
        setCircleLayer('gap', targetLatLng, t('gapTarget'), {
          color: '#36d17c', fillColor: '#36d17c', radius: 6,
        });
        const boatLatLng = [currentPos.lat, currentPos.lon];
        if (!mapLayers.gapLine) {
          mapLayers.gapLine = L.polyline([boatLatLng, targetLatLng], {
            color: '#36d17c', weight: 2, opacity: 0.8, dashArray: '6 6',
          }).addTo(map);
        } else {
          mapLayers.gapLine.setLatLngs([boatLatLng, targetLatLng]);
        }
        status = `${status} · ${cfg.distanceMode === 'center' ? t('distanceCenter') : t('distancePerpendicular')}`;
      }
    } else {
      removeLayer('gap');
      removeLayer('gapLine');
    }
  } else {
    for (const key of ['startLine', 'committee', 'buoy', 'center', 'gap', 'gapLine']) removeLayer(key);
  }

  if (el.mapStatus) el.mapStatus.textContent = status;

  if (!mapHasCentered && (currentPos || hasLine)) fitMapToData();
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

function updateGpsBadge() {
  if (!currentPos) {
    el.gpsBadge.textContent = t('gpsOff');
    el.gpsBadge.className = 'badge bad';
    return;
  }
  el.gpsBadge.textContent = `GPS ±${fmt(currentPos.accuracy, 0)} m`;
  el.gpsBadge.className = currentPos.accuracy <= 10 ? 'badge good' : 'badge warn';
}

function updateGpsDisplay() {
  if (!currentPos) return;
  el.lat.textContent = currentPos.lat.toFixed(7);
  el.lon.textContent = currentPos.lon.toFixed(7);
  el.accuracy.textContent = `${fmt(currentPos.accuracy, 0)} m`;
  el.currentSpeed.textContent = currentPos.speedMps === null ? '--' : speedLabel(currentPos.speedMps);
}

function setStatus(text, cls) {
  el.speedStatus.textContent = text;
  el.statusCard.className = `card status ${cls}`.trim();
}

function updateCalculations() {
  const now = Date.now();
  el.currentClock.textContent = fmtTime(now);
  el.startClock.textContent = startTimeMs ? fmtTime(startTimeMs) : '--:--:--';

  const remaining = startTimeMs === null ? null : (startTimeMs - now) / 1000;
  const timerText = fmtTimer(remaining);
  el.timer.textContent = timerText;
  el.fixedTimer.textContent = timerText;

  if (Number.isFinite(remaining) && remaining >= -2) {
    playSignal(Math.max(0, Math.ceil(remaining)));
  }

  const cfg = getConfig();
  const hasLine = [cfg.latA, cfg.lonA, cfg.latB, cfg.lonB].every(Number.isFinite);
  updateMap();

  if (!currentPos || !hasLine) {
    el.distanceToLine.textContent = '-- m';
    el.idealSpeed.textContent = '--';
    el.sideText.textContent = '--';
    setStatus('---', '');
    const msg = hasLine ? t('waitingGps') : t('enterLine');
    el.targetLine.textContent = msg;
    el.fixedTarget.textContent = msg;
    return;
  }

  const metrics = lineMetrics(currentPos, cfg);
  if (!metrics) return;

  const distance = cfg.distanceMode === 'center' ? metrics.centerDistance : metrics.perpendicularDistance;
  const desiredSide = cfg.buoySide === 'port' ? 'right' : 'left';
  const valid = metrics.side === desiredSide;
  const inBuffer = metrics.perpendicularDistance <= cfg.lineBuffer;

  el.distanceToLine.textContent = `${fmt(distance, 0)} m`;
  el.sideText.textContent = valid ? t('goodSide') : t('wrongSide');

  if (!Number.isFinite(remaining) || remaining <= 0) {
    el.targetLine.textContent = t('notSynced');
    el.fixedTarget.textContent = t('notSynced');
    el.idealSpeed.textContent = '--';
    setStatus('---', '');
    return;
  }

  if (!valid && !inBuffer) {
    el.targetLine.textContent = t('returnSide');
    el.fixedTarget.textContent = t('returnSide');
    el.idealSpeed.textContent = '--';
    setStatus(t('return'), 'bad');
    return;
  }

  const target = targetSecondsRemaining(remaining);
  const secondsToTarget = remaining - target;
  const idealMps = secondsToTarget > 1 ? distance / secondsToTarget : null;

  const line = `${t('target')} : ${fmtTimer(target)} | ${t('availableTime')} : ${fmt(secondsToTarget, 0)} s`;
  el.targetLine.textContent = line;
  el.fixedTarget.textContent = line;
  el.idealSpeed.textContent = idealMps === null ? '--' : speedLabel(idealMps);

  const currentMps = currentPos.speedMps;
  if (idealMps === null || currentMps === null) {
    setStatus(t('calc'), 'warn');
  } else {
    const delta = idealMps - currentMps;
    if (Math.abs(delta) <= 0.2) setStatus(t('ok'), 'ok');
    else if (delta > 0) setStatus(t('accelerate'), 'warn');
    else setStatus(t('slowDown'), 'bad');
  }
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
      updateMap();
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

function armOfficialStartTime() {
  const value = el.officialStartTime.value;
  if (!value) return;
  const [hh = '0', mm = '0', ss = '0'] = value.split(':');
  const d = new Date();
  d.setHours(Number(hh), Number(mm), Number(ss), 0);
  startTimeMs = d.getTime();
  lastSignalSecond = null;
  saveConfig();
  beep(880, 120);
  updateCalculations();
}

function resetCountdown() {
  startTimeMs = null;
  lastSignalSecond = null;
  el.timer.textContent = '--:--';
  el.fixedTimer.textContent = '--:--';
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
  saveConfig();
  updateCalculations();
}

function wireEvents() {
  el.startGpsBtn.addEventListener('click', startGps);
  el.syncBtn.addEventListener('click', syncFiveMinutes);
  el.resetBtn.addEventListener('click', resetCountdown);
  el.armStartBtn.addEventListener('click', armOfficialStartTime);
  el.setABtn.addEventListener('click', () => useCurrentAs('A'));
  el.setBBtn.addEventListener('click', () => useCurrentAs('B'));
  el.saveBtn.addEventListener('click', () => { saveConfig(); beep(660, 90); updateCalculations(); });
  el.centerMapBtn?.addEventListener('click', fitMapToData);
  el.languageSelect.addEventListener('change', () => loadLanguage(el.languageSelect.value));

  for (const input of [el.latA, el.lonA, el.latB, el.lonB, el.buoySide, el.lineBuffer, el.speedUnit, el.distanceMode, el.officialStartTime]) {
    input.addEventListener('change', () => { saveConfig(); updateCalculations(); });
  }
}

loadConfig();
wireEvents();
loadLanguage(lang);
setInterval(updateCalculations, 250);
