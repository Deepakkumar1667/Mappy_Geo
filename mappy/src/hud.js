// All DOM / HUD updates live here so main.js stays focused on logic.
import { HandLandmarker } from '@mediapipe/tasks-vision';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || Number.isNaN(n) ? '--' : Math.round(n).toLocaleString('en-US'));

// ---- Loader / status --------------------------------------------------------
export function setLoader(text) {
  $('loader-text').textContent = text;
}
export function hideLoader() {
  $('loader').classList.add('hide');
  setTimeout(() => $('loader').remove(), 700);
}
export function setLink(text, state) {
  $('link-text').textContent = text;
  $('link-status').dataset.state = state; // ok | warn | off
}
export function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
export function fillCountryList(names) {
  $('country-list').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
}

// ---- Hand panel -------------------------------------------------------------
export function setHandBadge(on) {
  $('hand-badge').textContent = on ? 'LIVE' : 'OFF';
  $('hand-badge').classList.toggle('live', on);
  $('sys-mode').textContent = on ? 'HAND' : 'MOUSE';
  $('cam-box').classList.toggle('show', on);
}

export function setHands(hands) {
  const sides = { LEFT: null, RIGHT: null };
  hands.forEach((h) => (sides[h.side] = h));
  for (const [side, key] of [['LEFT', 'lh'], ['RIGHT', 'rh']]) {
    const h = sides[side];
    $(`${key}-state`).textContent = h ? 'TRACKING' : 'STANDBY';
    $(`${key}-state`).classList.toggle('active', !!h);
    $(`${key}-conf`).textContent = h ? Math.round(h.score * 100) + '%' : '--';
  }
}

export function setGesture(name, count) {
  $('g-name').textContent = name;
  $('g-count').textContent = count;
}

export function drawHands(hands) {
  const c = $('cam-overlay');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(95,224,255,.85)';
  ctx.fillStyle = '#d8fbff';
  for (const { lm } of hands) {
    ctx.beginPath();
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      ctx.moveTo(lm[start].x * c.width, lm[start].y * c.height);
      ctx.lineTo(lm[end].x * c.width, lm[end].y * c.height);
    }
    ctx.stroke();
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * c.width, p.y * c.height, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---- System panel -----------------------------------------------------------
export function setStats({ fps, frame, latency, dots, bloom }) {
  $('s-fps').textContent = Math.round(fps);
  $('s-fps-bar').style.width = Math.min(100, (fps / 60) * 100) + '%';
  $('s-frame').textContent = frame.toFixed(1) + ' ms';
  $('s-lat').textContent = latency == null ? '--' : latency.toFixed(0) + ' ms';
  $('s-dots').textContent = fmt(dots);
  $('s-bloom').textContent = bloom ? 'ON' : 'OFF';
}

// ---- Cursor / hover ---------------------------------------------------------
export function showCursor(x, y, pinch) {
  const c = $('cursor');
  c.style.transform = `translate(${x}px, ${y}px)`;
  c.classList.add('show');
  c.classList.toggle('pinch', pinch);
}
export function hideCursor() {
  $('cursor').classList.remove('show');
}
export function setHover(name, x, y) {
  const l = $('hover-label');
  if (!name) return l.classList.remove('show');
  l.textContent = name;
  l.style.transform = `translate(${x + 16}px, ${y + 14}px)`;
  l.classList.add('show');
}
export function setCoords(lat, lon) {
  $('coords').textContent =
    lat == null ? 'LAT -- · LON --' : `LAT ${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} · LON ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

// ---- Country panel ----------------------------------------------------------
const facts = (rows) =>
  rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<div class="fact"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)
    .join('');

export function showPlaceholder() {
  $('c-badge').textContent = 'IDLE';
  $('country-body').innerHTML =
    '<p class="hint">Click the globe, pinch while pointing, or search above to open a country.</p>';
}

export function showOcean(lat, lon) {
  $('c-badge').textContent = 'NO REGION';
  $('country-body').innerHTML = `<h2 class="c-name">Open water</h2>
    <p class="hint">No country at ${lat.toFixed(2)}°, ${lon.toFixed(2)}°.</p>`;
}

export function showCountry(item) {
  const p = item.props;
  $('c-badge').textContent = item.code || 'REGION';
  const gdp = p.GDP_MD ? '$' + (p.GDP_MD / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' B' : '';
  $('country-body').innerHTML = `
    <div class="c-head"><span class="flag" id="c-flag">🌐</span>
      <div><h2 class="c-name">${esc(item.name)}</h2><p class="c-sub" id="c-official">${esc(p.FORMAL_EN || p.NAME_LONG || '')}</p></div></div>
    <div class="facts" id="c-facts">${facts([
      ['Continent', p.CONTINENT],
      ['Subregion', p.SUBREGION],
      ['Population', fmt(p.POP_EST)],
      ['GDP', gdp],
      ['Income group', (p.INCOME_GRP || '').replace(/^\d\. /, '')],
      ['Economy', (p.ECONOMY || '').replace(/^\d+\. /, '')]
    ])}</div>
    <div id="c-live"><p class="hint loading">Fetching live data</p></div>`;
}

export function updateCountry(info) {
  const live = $('c-live');
  if (!live) return;
  const { rest, wiki, weather } = info;
  if (rest?.flag) $('c-flag').textContent = rest.flag;
  if (rest?.name?.official) $('c-official').textContent = rest.name.official;

  let html = '';
  if (rest) {
    html += `<div class="facts">${facts([
      ['Capital', (rest.capital || []).join(', ')],
      ['Area', rest.area ? fmt(rest.area) + ' km²' : ''],
      ['Languages', Object.values(rest.languages || {}).join(', ')],
      ['Currency', Object.values(rest.currencies || {}).map((c) => `${c.name} (${c.symbol ?? ''})`).join(', ')],
      ['Time zones', (rest.timezones || []).slice(0, 2).join(', ') + ((rest.timezones || []).length > 2 ? ' …' : '')]
    ])}</div>`;
  }
  if (weather) {
    html += `<div class="weather"><span class="temp">${esc(weather.temp)}°C</span>
      <span>${esc(weather.label)}<br/><small>Wind ${esc(weather.wind)} km/h · local ${esc(weather.localTime.slice(11))}</small></span></div>`;
  }
  if (wiki?.text) {
    const short = wiki.text.length > 330 ? wiki.text.slice(0, 330).replace(/\s+\S*$/, '') + '…' : wiki.text;
    html += `<p class="wiki">${esc(short)}${wiki.url ? ` <a href="${esc(wiki.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</p>`;
  }
  live.innerHTML = html || '<p class="hint">Live data unavailable (offline or blocked).</p>';
}
