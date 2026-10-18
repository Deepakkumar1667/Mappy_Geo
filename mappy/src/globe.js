// The holographic Earth. This replaces the "reactor core" of the original HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const R = 1.5;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const DEG = Math.PI / 180;

export function latLonToVec3(lat, lon, r = R) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

export function vec3ToLatLon(v) {
  const n = v.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) / DEG;
  let lon = Math.atan2(n.z, -n.x) / DEG - 180;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

// Rasterise the country polygons into a land/ocean mask (white = land).
function buildLandMask(items, W = 2048, H = 1024) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  for (const it of items) {
    for (const poly of it.polys) {
      ctx.beginPath();
      for (const ring of poly.rings) {
        ring.forEach(([lon, lat], i) => {
          const x = ((lon + 180) / 360) * W;
          const y = ((90 - lat) / 180) * H;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
  return { data: ctx.getImageData(0, 0, W, H).data, W, H };
}

function buildLandPoints(items, count = 110000) {
  const { data, W, H } = buildLandMask(items);
  const golden = 137.50776405003785; // golden angle, degrees
  const pos = [];
  const seed = [];
  for (let i = 0; i < count; i++) {
    const lat = Math.asin(1 - (2 * (i + 0.5)) / count) / DEG;
    const lon = ((i * golden) % 360) - 180;
    const px = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
    const py = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
    if (data[(py * W + px) * 4] > 128) {
      const v = latLonToVec3(lat, lon, R);
      pos.push(v.x, v.y, v.z);
      seed.push(Math.random());
    }
  }
  return { pos: new Float32Array(pos), seed: new Float32Array(seed) };
}

function buildBorders(items) {
  const pts = [];
  for (const it of items) {
    for (const poly of it.polys) {
      for (const ring of poly.rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = latLonToVec3(ring[i][1], ring[i][0], R * 1.002);
          const b = latLonToVec3(ring[i + 1][1], ring[i + 1][0], R * 1.002);
          pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({
      color: 0x2fb8ff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
}

function buildGraticule() {
  const pts = [];
  const seg = 2;
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += seg) {
      const a = latLonToVec3(lat, lon, R * 1.001);
      const b = latLonToVec3(lat, lon + seg, R * 1.001);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -88; lat < 88; lat += seg) {
      const a = latLonToVec3(lat, lon, R * 1.001);
      const b = latLonToVec3(lat + seg, lon, R * 1.001);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ color: 0x1b7fb5, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })
  );
}

const SHELL_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

export function createGlobe(container, items) {
  const size = () => ({ w: window.innerWidth, h: window.innerHeight });
  let { w, h } = size();

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020b14);
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);

  const defaultZoom = () => (window.innerWidth / window.innerHeight < 1 ? 8 : 4.8);
  let zoomTarget = defaultZoom();
  camera.position.set(0, 0, zoomTarget);

  // ---- Earth group (rotates) ------------------------------------------------
  const earth = new THREE.Group();
  scene.add(earth);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.995, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x03233d, transparent: true, opacity: 0.55, depthWrite: false })
  );
  earth.add(core);

  const land = buildLandPoints(items);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(land.pos, 3));
  dotGeo.setAttribute('aSeed', new THREE.BufferAttribute(land.seed, 1));
  const dotMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uSize: { value: 1.7 },
      uColor: { value: new THREE.Color(0x35c8ff).multiplyScalar(1.25) }
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime; uniform float uPixel; uniform float uSize;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float facing = normalize(normalMatrix * position).z;
        float tw = 0.78 + 0.22 * sin(uTime * 1.4 + aSeed * 60.0);
        float spark = step(0.992, fract(aSeed * 91.7)) * 0.7;
        vA = (0.2 + 0.8 * smoothstep(-0.3, 0.9, facing)) * tw + spark;
        gl_PointSize = uSize * uPixel * (5.0 / -mv.z) * (1.0 + spark);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(uColor, smoothstep(0.5, 0.05, d) * vA);
      }`
  });
  const dots = new THREE.Points(dotGeo, dotMat);
  earth.add(dots);

  const borders = buildBorders(items);
  earth.add(borders);
  earth.add(buildGraticule());

  // ---- Static glow shells ---------------------------------------------------
  const fresnel = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.012, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: SHELL_VERT,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.6);
          gl_FragColor = vec4(vec3(0.12, 0.7, 1.0) * f * 1.1, f * 0.9);
        }`
    })
  );
  scene.add(fresnel);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.22, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: SHELL_VERT,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          float d = abs(dot(normalize(vN), normalize(vV)));
          float f = pow(max(0.0, 0.55 - d) / 0.55, 2.0);
          gl_FragColor = vec4(vec3(0.08, 0.55, 1.0) * f * 0.9, f * 0.7);
        }`
    })
  );
  scene.add(halo);

  // ---- HUD rings ------------------------------------------------------------
  const rings = new THREE.Group();
  const ringMat = (o) => new THREE.MeshBasicMaterial({ color: 0x5fe0ff, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
  [
    { r: 1.95, t: 0.004, o: 0.55, tilt: 1.35, spin: 0.12 },
    { r: 2.2, t: 0.003, o: 0.4, tilt: 1.0, spin: -0.09 },
    { r: 2.5, t: 0.003, o: 0.3, tilt: 1.7, spin: 0.06 }
  ].forEach((cfg) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(cfg.r, cfg.t, 8, 220), ringMat(cfg.o));
    m.rotation.x = cfg.tilt;
    m.userData.spin = cfg.spin;
    rings.add(m);
  });
  [
    { r: 2.05, t: 0.012, arc: 1.2, tilt: 1.25, spin: 0.35 },
    { r: 2.35, t: 0.01, arc: 0.7, tilt: 0.9, spin: -0.5 }
  ].forEach((cfg) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(cfg.r, cfg.t, 8, 120, cfg.arc), ringMat(0.85));
    m.rotation.x = cfg.tilt;
    m.userData.spin = cfg.spin;
    rings.add(m);
  });
  const dashGeo = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 181 }, (_, i) => new THREE.Vector3(Math.cos(i * 2 * DEG) * 2.8, 0, Math.sin(i * 2 * DEG) * 2.8))
  );
  const dashed = new THREE.Line(
    dashGeo,
    new THREE.LineDashedMaterial({ color: 0x6fd8ff, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.45 })
  );
  dashed.computeLineDistances();
  dashed.rotation.x = 0.35;
  dashed.userData.spin = 0.04;
  rings.add(dashed);
  scene.add(rings);

  // ---- Dust + light rays ----------------------------------------------------
  const dustPos = new Float32Array(2600 * 3);
  for (let i = 0; i < 2600; i++) {
    const r = 2.8 + Math.random() * 4.5;
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    dustPos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0x7fdcff, size: 0.018, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const rayPts = [];
  for (let i = 0; i < 160; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
    const r0 = R * 1.9 + Math.random();
    const r1 = r0 + 0.4 + Math.random() * 1.6;
    rayPts.push(dir.clone().multiplyScalar(r0), dir.clone().multiplyScalar(r1));
  }
  const rays = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(rayPts),
    new THREE.LineBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const dustGroup = new THREE.Group();
  dustGroup.add(dust, rays);
  scene.add(dustGroup);

  // ---- Selection (outline + pin) -------------------------------------------
  const selection = new THREE.Group();
  earth.add(selection);
  let pin = null;

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      c.geometry?.dispose();
      c.material?.dispose();
      if (c.children?.length) c.children.forEach((k) => { k.geometry?.dispose(); k.material?.dispose(); });
    }
  }

  function makePin(lat, lon) {
    const g = new THREE.Group();
    const dir = latLonToVec3(lat, lon, 1);
    const base = dir.clone().multiplyScalar(R * 1.01);
    const tip = dir.clone().multiplyScalar(R * 1.28);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };

    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([base, tip]),
      new THREE.LineBasicMaterial({ color: 0xaaf4ff, ...additive })
    );
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd8fbff, ...additive }));
    head.position.copy(tip);
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 48), new THREE.MeshBasicMaterial({ color: 0x7ff3ff, side: THREE.DoubleSide, ...additive }));
    pulse.position.copy(base);
    pulse.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    g.add(stem, head, pulse);
    g.userData.pulse = pulse;
    return g;
  }

  function setSelection(item, lat, lon) {
    clearGroup(selection);
    pin = null;
    if (item) {
      for (const poly of item.polys) {
        const pts = poly.rings[0].map(([lo, la]) => latLonToVec3(la, lo, R * 1.007));
        selection.add(
          new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0xa8f6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
          )
        );
      }
    }
    if (lat !== undefined) {
      pin = makePin(lat, lon);
      selection.add(pin);
    }
  }

  // ---- Post-processing ------------------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 0.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Motion state ---------------------------------------------------------
  const vel = new THREE.Vector2(); // rad/s about screen axes
  let holding = false;
  let autoRotate = true;
  let lastInteract = -1e9;
  let targetQ = null;
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();

  function rotateBy(rx, ry) {
    qA.setFromAxisAngle(Y_AXIS, rx);
    qB.setFromAxisAngle(X_AXIS, ry);
    earth.quaternion.premultiply(qA).premultiply(qB).normalize();
  }

  function flyTo(lat, lon) {
    const v = latLonToVec3(lat, lon, 1);
    const yaw = -Math.atan2(v.x, v.z);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(X_AXIS, lat * DEG);
    targetQ = qPitch.multiply(qYaw);
    vel.set(0, 0);
    lastInteract = performance.now();
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(cx, cy) {
    ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    earth.updateMatrixWorld(true);
    const hit = raycaster.intersectObject(core, false)[0];
    if (!hit) return null;
    return vec3ToLatLon(earth.worldToLocal(hit.point.clone()));
  }

  const layers = { rings, dust: dustGroup, borders };
  function setLayer(name, on) {
    if (name === 'rotate') autoRotate = on;
    else if (name === 'bloom') bloom.enabled = on;
    else if (layers[name]) layers[name].visible = on;
  }

  function resize() {
    ({ w, h } = size());
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const clampZoom = (z) => THREE.MathUtils.clamp(z, 2.6, 9);

  function update(dt, t) {
    dotMat.uniforms.uTime.value = t;

    if (targetQ) {
      earth.quaternion.slerp(targetQ, 1 - Math.pow(0.002, dt));
      if (earth.quaternion.angleTo(targetQ) < 0.002) targetQ = null;
    } else if (!holding) {
      rotateBy(vel.x * dt, vel.y * dt);
      vel.multiplyScalar(Math.pow(0.05, dt));
      if (autoRotate && performance.now() - lastInteract > 2500) rotateBy(0.12 * dt, 0);
    }

    camera.position.z += (zoomTarget - camera.position.z) * (1 - Math.pow(0.003, dt));

    rings.children.forEach((r) => (r.rotation.z += r.userData.spin * dt));
    dustGroup.rotation.y += dt * 0.012;
    rays.rotation.y -= dt * 0.02;

    if (pin) {
      const k = (t * 0.9) % 1;
      const p = pin.userData.pulse;
      p.scale.setScalar(1 + k * 5);
      p.material.opacity = 1 - k;
    }

    composer.render();
  }

  return {
    domElement: renderer.domElement,
    update,
    pick,
    flyTo,
    setSelection,
    setLayer,
    rotateBy,
    // dragging: rotate immediately and remember the velocity for inertia on release
    drag(rx, ry, dt) {
      rotateBy(rx, ry);
      const vx = THREE.MathUtils.clamp(rx / dt, -4, 4);
      const vy = THREE.MathUtils.clamp(ry / dt, -4, 4);
      vel.lerp(new THREE.Vector2(vx, vy), 0.5);
      targetQ = null;
      lastInteract = performance.now();
    },
    hold(on) {
      if (holding && !on) lastInteract = performance.now();
      holding = on;
      if (on) targetQ = null;
    },
    setZoom: (z) => (zoomTarget = clampZoom(z)),
    zoomBy: (dz) => (zoomTarget = clampZoom(zoomTarget + dz)),
    getZoom: () => zoomTarget,
    resetView(lat = 22, lon = 78) {
      zoomTarget = defaultZoom();
      flyTo(lat, lon);
    },
    stats: { dots: land.pos.length / 3 }
  };
}
