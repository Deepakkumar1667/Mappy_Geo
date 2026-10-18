# Mappy - Geo Intelligence Core

A holographic Earth you control with your hands. Built with Vite, Three.js and MediaPipe.
The glowing Earth sits where the "reactor core" would be in a Jarvis-style HUD.

## Run it

You need Node.js 18 or newer and an internet connection (fonts, hand model and country info load online).

```bash
npm install
npm run dev
```

The browser opens at http://127.0.0.1:5173. Allow the camera when asked.
Open it through `127.0.0.1` or `localhost`: browsers block the camera on other addresses.

## Controls

| Input | Action |
|---|---|
| Open palm, move | Rotate the Earth |
| Point with index finger | Moves the on-screen cursor |
| Pinch (thumb + index) | Select the country under the cursor |
| Two hands, apart / together | Zoom in / out |
| Fist (hold ~0.5 s) | Reset view |
| Mouse drag / wheel / click | Rotate / zoom / select |
| `R` key | Reset view |
| Search box + Enter | Fly to a country |

If the camera is blocked, the app falls back to mouse mode automatically.

## Project structure

```
mappy/
├─ index.html                 HUD layout (panels, buttons, camera box)
├─ package.json
├─ vite.config.js
├─ public/
│  └─ data/countries.geojson  Natural Earth 110m country borders
└─ src/
   ├─ main.js                 Wires everything: mouse, gestures, search, main loop
   ├─ globe.js                The Earth: land dots, borders, glow, rings, dust, bloom, pin
   ├─ hands.js                MediaPipe hand tracking + gesture detection
   ├─ countries.js            Loads GeoJSON, finds the country at a lat/lon, search
   ├─ info.js                 Live data: REST Countries, Wikipedia, Open-Meteo weather
   ├─ hud.js                  All HUD / DOM updates
   └─ style.css               Cyan HUD styling
```

## Easy things to change

- Starting view: `HOME` at the top of `src/main.js` (default is India, `lat 22, lon 78`).
- Dot density: `count` in `buildLandPoints()` in `src/globe.js` (lower it if your PC is slow).
- Colors: `uColor` in `globe.js` for the dots, CSS variables at the top of `style.css` for the HUD.
- Glow strength: the `UnrealBloomPass(…, 0.85, 0.55, 0.2)` line in `globe.js`.
- Gesture sensitivity: the `Math.PI * 1.8` and `Math.PI * 1.2` multipliers in `processHands()` in `main.js`.

## Troubleshooting

- Camera does not start: allow it in the browser address bar, and close other apps using the webcam.
- Choppy: turn Bloom off with the button at the bottom, or reduce `count` in `globe.js`.
- No country details: the REST Countries, Wikipedia or Open-Meteo request failed. The Natural Earth facts still show.
- Pinch selects the wrong place: point first, hold still for a moment, then pinch.

## Data credits

Country borders: Natural Earth (public domain). Live info: REST Countries, Wikipedia, Open-Meteo.
