// Country data: loading, point-in-polygon lookup, search.
// Uses plain lon/lat ray casting (Natural Earth 110m data is split at the antimeridian).

let items = [];

function bboxOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function ringCentroid(ring) {
  const A = ringArea(ring);
  if (Math.abs(A) < 1e-9) return ring[0];
  let cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonContains(rings, x, y) {
  if (!ringContains(rings[0], x, y)) return false;
  for (let k = 1; k < rings.length; k++) if (ringContains(rings[k], x, y)) return false;
  return true;
}

function buildItem(f) {
  const p = f.properties;
  const raw = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const polys = raw.map((rings) => ({
    rings,
    bbox: bboxOf(rings[0]),
    area: Math.abs(ringArea(rings[0]))
  }));
  const biggest = polys.reduce((a, b) => (b.area > a.area ? b : a));
  const c = ringCentroid(biggest.rings[0]);
  const code =
    p.ISO_A3_EH && p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : p.ADM0_A3 && p.ADM0_A3 !== '-99' ? p.ADM0_A3 : '';
  return {
    name: p.NAME_EN || p.NAME || p.ADMIN,
    code,
    props: p,
    polys,
    center: { lat: c[1], lon: c[0] }
  };
}

export async function loadCountries(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load ' + url + ' (' + res.status + ')');
  const gj = await res.json();
  items = gj.features.filter((f) => f.geometry).map(buildItem);
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export const getItems = () => items;
export const allNames = () => items.map((i) => i.name);

function exact(lat, lon) {
  for (const it of items) {
    for (const poly of it.polys) {
      const b = poly.bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (polygonContains(poly.rings, lon, lat)) return it;
    }
  }
  return null;
}

// Forgiving lookup: if the exact point is in the sea, try a few points around it
// so clicks right next to a coastline still select the country.
export function lookup(lat, lon) {
  const hit = exact(lat, lon);
  if (hit) return hit;
  for (const r of [0.8, 1.6]) {
    for (let a = 0; a < 8; a++) {
      const t = (a * Math.PI) / 4;
      const h = exact(lat + r * Math.sin(t), lon + (r * Math.cos(t)) / Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
      if (h) return h;
    }
  }
  return null;
}

export function findByName(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    items.find((i) => i.name.toLowerCase() === q) ||
    items.find((i) => i.name.toLowerCase().startsWith(q)) ||
    items.find((i) => i.name.toLowerCase().includes(q)) ||
    items.find((i) => (i.props.NAME_LONG || '').toLowerCase().includes(q)) ||
    null
  );
}
