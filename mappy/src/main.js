import './style.css';
import { loadCountries, getItems, allNames, lookup, findByName } from './countries.js';
import { createGlobe } from './globe.js';
import { createHandTracker, analyzeHand } from './hands.js';
import { fetchCountryInfo } from './info.js';
import * as hud from './hud.js';

const HOME = { lat: 22, lon: 78 }; // start facing India - change to wherever you like
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function boot() {
  hud.setLoader('LOADING WORLD DATA');
  try {
    await loadCountries(`${import.meta.env.BASE_URL}data/countries.geojson`);
  } catch (err) {
    hud.setLoader('COULD NOT LOAD WORLD DATA - ' + err.message);
    return;
  }
  hud.fillCountryList(allNames());
  hud.setLoader('BUILDING EARTH');
  await new Promise((r) => setTimeout(r, 30)); // let the loader paint

  const globe = createGlobe(document.getElementById('stage'), getItems());
  globe.resetView(HOME.lat, HOME.lon);
  hud.showPlaceholder();
  hud.hideLoader();

  // ---- Selection -------------------------------------------------------------
  let current = null;
  function select(item, lat, lon) {
    current = item;
    globe.setSelection(item, lat, lon);
    if (!item) return hud.showOcean(lat, lon);
    hud.showCountry(item);
    fetchCountryInfo(item)
      .then((info) => current === item && hud.updateCountry(info))
      .catch(() => {});
  }
  function selectAtScreen(x, y) {
    const hit = globe.pick(x, y);
    if (!hit) return;
    select(lookup(hit.lat, hit.lon), hit.lat, hit.lon);
  }

  // ---- Mouse / touch ---------------------------------------------------------
  const canvas = globe.domElement;
  const pointer = { x: 0, y: 0, inside: false };
  let dragging = false;
  let moved = 0;
  let last = null;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
    globe.hold(true);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max((now - last.t) / 1000, 0.008);
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    moved += Math.abs(dx) + Math.abs(dy);
    globe.drag(dx * 0.005, dy * 0.005, dt);
    last = { x: e.clientX, y: e.clientY, t: now };
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    globe.hold(false);
    if (moved < 5) selectAtScreen(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => (pointer.inside = false));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      globe.zoomBy(e.deltaY * 0.003);
    },
    { passive: false }
  );
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'r' || e.key === 'R') globe.resetView(HOME.lat, HOME.lon);
  });

  // ---- Search ----------------------------------------------------------------
  const input = document.getElementById('search-input');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const item = findByName(input.value);
    if (!item) return hud.toast('No country found for "' + input.value + '"');
    globe.flyTo(item.center.lat, item.center.lon);
    select(item, item.center.lat, item.center.lon);
    input.blur();
  });

  // ---- Layer buttons ---------------------------------------------------------
  const tracker = createHandTracker();
  const video = document.getElementById('cam');

  async function startHands() {
    hud.setLink('REQUESTING CAMERA', 'warn');
    try {
      await tracker.start(video);
      hud.setHandBadge(true);
      hud.setLink('HAND LINK ACTIVE', 'ok');
    } catch (err) {
      console.warn(err);
      tracker.stop();
      hud.setHandBadge(false);
      hud.setLink('MOUSE MODE', 'off');
      hud.toast('Camera / hand model unavailable - using mouse. (' + (err.message || err.name) + ')', 5000);
      document.querySelector('[data-layer="camera"]').classList.remove('on');
    }
  }
  function stopHands() {
    tracker.stop();
    endHold();
    hud.setHandBadge(false);
    hud.setHands([]);
    hud.setGesture('STANDBY', 0);
    hud.hideCursor();
    hud.drawHands([]);
    hud.setLink('MOUSE MODE', 'off');
  }

  const state = { bloom: true };
  document.getElementById('controls').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-layer]');
    if (!btn) return;
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    const name = btn.dataset.layer;
    if (name === 'camera') return on ? startHands() : stopHands();
    if (name === 'bloom') state.bloom = on;
    globe.setLayer(name, on);
  });

  // ---- Hand gestures ---------------------------------------------------------
  const hs = {
    pinch: false,
    prevPalm: null,
    prevGesture: '',
    hist: [],
    cursor: null,
    fist: 0,
    zoomBase: null,
    lastSelect: 0,
    lastReset: 0,
    holding: false
  };

  function endHold() {
    if (hs.holding) globe.hold(false);
    hs.holding = false;
  }

  function processHands(result, dt) {
    const hands = result.hands;
    hud.setHands(hands);
    hud.drawHands(hands);

    if (hands.length === 0) {
      endHold();
      Object.assign(hs, { prevPalm: null, prevGesture: '', pinch: false, zoomBase: null, fist: 0, cursor: null, hist: [] });
      hud.setGesture('NO HAND', 0);
      hud.hideCursor();
      return;
    }

    // Two hands: spread apart = zoom in, bring together = zoom out.
    if (hands.length >= 2) {
      endHold();
      const a = hands[0].lm[9];
      const b = hands[1].lm[9];
      const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 0.05);
      if (!hs.zoomBase) hs.zoomBase = { d, z: globe.getZoom() };
      globe.setZoom((hs.zoomBase.z * hs.zoomBase.d) / d);
      Object.assign(hs, { prevPalm: null, prevGesture: 'DUAL', cursor: null });
      hud.setGesture('DUAL · ZOOM', 2);
      hud.hideCursor();
      return;
    }
    hs.zoomBase = null;

    const h = analyzeHand(hands[0].lm);
    const wasPinch = hs.pinch;
    hs.pinch = wasPinch ? h.pinchRatio < 0.45 : h.pinchRatio < 0.3; // hysteresis
    const gesture = hs.pinch ? 'PINCH' : h.gesture;
    hud.setGesture(gesture === 'PINCH' ? 'PINCH · SELECT' : gesture, 1);

    // Index fingertip -> screen position (mirrored, with a little gain so edges are reachable)
    const gain = 1.5;
    const tx = clamp((1 - h.tip.x - 0.5) * gain + 0.5, 0, 1) * window.innerWidth;
    const ty = clamp((h.tip.y - 0.5) * gain + 0.5, 0, 1) * window.innerHeight;
    hs.cursor = hs.cursor ? { x: hs.cursor.x + (tx - hs.cursor.x) * 0.4, y: hs.cursor.y + (ty - hs.cursor.y) * 0.4 } : { x: tx, y: ty };

    if (gesture === 'OPEN PALM') {
      // rotate: the globe follows the hand
      if (!hs.holding) {
        globe.hold(true);
        hs.holding = true;
      }
      if (hs.prevGesture === 'OPEN PALM' && hs.prevPalm) {
        const dx = -(h.palm.x - hs.prevPalm.x); // video is mirrored
        const dy = h.palm.y - hs.prevPalm.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.002) globe.drag(dx * Math.PI * 1.8, dy * Math.PI * 1.2, Math.max(dt, 0.008));
      }
      hud.hideCursor();
    } else {
      endHold();
      if (gesture === 'FIST') {
        hs.fist++;
        const now = performance.now();
        if (hs.fist > 10 && now - hs.lastReset > 1500) {
          hs.lastReset = now;
          globe.resetView(HOME.lat, HOME.lon);
          hud.toast('View reset');
        }
        hud.hideCursor();
      } else {
        hs.fist = 0;
        hud.showCursor(hs.cursor.x, hs.cursor.y, hs.pinch);
        if (!hs.pinch) {
          hs.hist.push({ ...hs.cursor });
          if (hs.hist.length > 6) hs.hist.shift();
        }
        // pinch started -> select where the cursor was a moment ago (before the fingers moved)
        if (hs.pinch && !wasPinch) {
          const now = performance.now();
          const at = hs.hist[0] ?? hs.cursor;
          if (now - hs.lastSelect > 600) {
            hs.lastSelect = now;
            selectAtScreen(at.x, at.y);
          }
        }
      }
    }
    if (gesture !== 'FIST') hs.fist = 0;
    hs.prevPalm = { x: h.palm.x, y: h.palm.y };
    hs.prevGesture = gesture;
  }

  // ---- Main loop -------------------------------------------------------------
  let prev = performance.now();
  let fpsSmooth = 60;
  let frameMs = 0;
  let handMs = null;
  let statsTimer = 0;
  let hoverTimer = 0;
  let lastHoverName = '';

  function frame(nowMs) {
    requestAnimationFrame(frame);
    const dt = Math.min((nowMs - prev) / 1000, 0.1);
    prev = nowMs;

    if (tracker.active) {
      const res = tracker.detect(nowMs);
      if (res.ms != null) handMs = res.ms;
      processHands(res, dt);
    }

    const t0 = performance.now();
    globe.update(dt, nowMs / 1000);
    frameMs = performance.now() - t0;
    fpsSmooth += (1 / Math.max(dt, 0.001) - fpsSmooth) * 0.1;

    // hover label + coordinates (throttled)
    hoverTimer += dt;
    if (hoverTimer > 0.1) {
      hoverTimer = 0;
      const cur = hs.cursor && tracker.active && hs.prevGesture !== 'OPEN PALM' ? hs.cursor : pointer.inside && !dragging ? pointer : null;
      if (cur) {
        const hit = globe.pick(cur.x, cur.y);
        if (hit) {
          hud.setCoords(hit.lat, hit.lon);
          const it = lookup(hit.lat, hit.lon);
          lastHoverName = it ? it.name : '';
        } else {
          hud.setCoords(null);
          lastHoverName = '';
        }
        hud.setHover(lastHoverName, cur.x, cur.y);
      } else {
        hud.setHover('');
      }
    }

    statsTimer += dt;
    if (statsTimer > 0.25) {
      statsTimer = 0;
      hud.setStats({ fps: fpsSmooth, frame: frameMs, latency: tracker.active ? handMs : null, dots: globe.stats.dots, bloom: state.bloom });
    }
  }
  requestAnimationFrame(frame);

  // Camera on by default (like the original HUD); falls back to mouse if denied.
  hud.setLink('MOUSE MODE', 'off');
  startHands();
}

boot();
