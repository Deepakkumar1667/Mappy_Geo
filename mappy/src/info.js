// Live country information: REST Countries + Wikipedia + Open-Meteo.
// Everything is optional - if a request fails the HUD still shows Natural Earth data.

const cache = new Map();

async function getJSON(url, ms = 7000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function restCountry(item) {
  const fields = 'name,capital,capitalInfo,population,area,subregion,languages,currencies,flag,timezones';
  try {
    const d = await getJSON(`https://restcountries.com/v3.1/alpha/${item.code}?fields=${fields}`);
    return Array.isArray(d) ? d[0] : d;
  } catch {
    const d = await getJSON(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(item.name)}?fullText=true&fields=${fields}`
    );
    return d[0];
  }
}

async function wikiSummary(name) {
  const get = (t) => getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`);
  let d = await get(name);
  if (d.type === 'disambiguation') d = await get(name + ' (country)');
  return { text: d.extract, url: d.content_urls?.desktop?.page };
}

const WEATHER = [
  [[0], 'Clear sky'],
  [[1, 2, 3], 'Partly cloudy'],
  [[45, 48], 'Fog'],
  [[51, 53, 55, 56, 57], 'Drizzle'],
  [[61, 63, 65, 66, 67], 'Rain'],
  [[71, 73, 75, 77], 'Snow'],
  [[80, 81, 82], 'Rain showers'],
  [[85, 86], 'Snow showers'],
  [[95, 96, 99], 'Thunderstorm']
];

async function weatherAt(lat, lon) {
  const d = await getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
      `&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`
  );
  const c = d.current;
  const label = WEATHER.find(([codes]) => codes.includes(c.weather_code))?.[1] ?? 'Unknown';
  return { temp: c.temperature_2m, wind: c.wind_speed_10m, label, localTime: c.time, tz: d.timezone };
}

export async function fetchCountryInfo(item) {
  const key = item.code || item.name;
  if (cache.has(key)) return cache.get(key);

  const rest = await restCountry(item).catch(() => null);
  const point = rest?.capitalInfo?.latlng ?? [item.center.lat, item.center.lon];
  const [wiki, weather] = await Promise.all([
    wikiSummary(rest?.name?.common ?? item.name).catch(() => null),
    weatherAt(point[0], point[1]).catch(() => null)
  ]);

  const info = { rest, wiki, weather };
  cache.set(key, info);
  return info;
}
