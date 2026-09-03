/**
 * galaxy.js — Galaxy -> Milky Way scroll engine
 *
 * The hero image is sampled pixel-by-pixel into a single THREE.Points cloud.
 * Every particle stores BOTH its galaxy position (from the image) and its
 * destination in the procedural Milky Way (see milkyway.js). A single uniform,
 * `uProgress`, drives the morph entirely on the GPU, so scrolling costs one
 * uniform write and one draw call.
 *
 * Exposure is NOT hand-tuned per device. Additive blending accumulates, so
 * brightness has to be derived from particle count, point size and viewport
 * area or it blows out to white on any configuration you did not test on.
 * See calibrate() below.
 */

import * as THREE from '../vendor/three.module.js';
import { buildMilkyWay, MW } from './milkyway.js';

/* ------------------------------------------------------------------ config */

export const CONFIG = {
  // Resolved against this module's own URL rather than the document's, so the
  // page works both standalone and mounted under /static/landing while being
  // served at "/".
  image: new URL('../assets/galaxy.jpg', import.meta.url).href,

  // Faint photo underlay beneath the particles. 0 = pure particles.
  imagePlaneOpacity: 0.0,

  planeHeight: 5.2,     // world height of the galaxy; width follows image aspect
  bulge: 0.55,          // how far the bright core pushes toward camera

  swirl: 2.1,           // differential rotation while unwinding
  turbulence: 1.5,      // mid-flight drift so paths curve
  stagger: 0.62,        // outer-vs-core offset in the dissolve
};

/* Exposure targets. These are the only brightness numbers to tune; every
   per-device value is derived from them, so the look holds across tiers,
   viewport sizes and pixel ratios. */
const EXPOSURE = {
  galaxy: 0.48,     // peak accumulated brightness at the galaxy core
  star:   0.72,     // brightness of a resolved star of median magnitude
  haze:   0.95,     // peak glow at the band ridge
};

// `size` is a WORLD-space diameter (perspective-attenuated at render time).
// `starPx` / `hazePx` are CSS pixels — multiplied by DPR in the shader, so
// they stay the same apparent size on every display.
const QUALITY = {
  high:   { label: 'high',   count: 320000, dpr: 2.0,  size: 0.0126, starPx: 0.95, hazePx: 14 },
  medium: { label: 'medium', count: 155000, dpr: 1.75, size: 0.0188, starPx: 1.05, hazePx: 20 },
  low:    { label: 'low',    count: 60000,  dpr: 1.5,  size: 0.0302, starPx: 1.20, hazePx: 32 },
};

function pickQuality() {
  // ?q=high|medium|low forces a tier — the only reliable way to check how the
  // exposure holds up on a tier your own machine will never select.
  const forced = new URLSearchParams(location.search).get('q');
  if (forced && QUALITY[forced]) return QUALITY[forced];

  // deviceMemory is Chromium-only; treat "unknown" as capable rather than
  // silently demoting every Firefox and Safari visitor to the medium tier.
  const mem = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || coarse;

  if (mobile || cores <= 2 || (mem !== undefined && mem <= 2)) return QUALITY.low;
  if (cores <= 4 || (mem !== undefined && mem <= 4) || window.innerWidth < 1000) return QUALITY.medium;
  return QUALITY.high;
}

/* ------------------------------------------------------------------ shaders */

const VERT = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform float uSize;
  uniform float uStarPx;
  uniform float uHazePx;
  uniform float uAtten;
  uniform float uDpr;
  uniform float uSwirl;
  uniform float uTurb;
  uniform float uStagger;
  uniform float uWarp;
  uniform float uBright;
  uniform float uStarBright;
  uniform float uHazeBright;
  uniform float uOpacity;
  uniform vec3  uCursor;

  attribute vec3  aStar;
  attribute vec3  aStarCol;
  attribute vec3  aSeed;
  attribute float aLum;
  attribute float aRadius;
  attribute float aMag;
  attribute float aHaze;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vSoft;

  const float PI = 3.14159265359;

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  vec3 drift(vec3 p, float t) {
    return vec3(
      sin(p.y * 1.7 + t)       + cos(p.z * 1.3 - t * 0.7),
      sin(p.z * 1.5 - t * 0.9) + cos(p.x * 1.1 + t * 0.6),
      sin(p.x * 1.9 + t * 0.8) + cos(p.y * 1.4 - t * 0.5)
    );
  }

  void main() {
    // ---- per-particle staggered progress -----------------------------------
    float delay = mix(1.0 - aRadius, aSeed.x, 0.35) * uStagger;
    float p = smoothstep(delay, delay + (1.0 - uStagger), uProgress);

    // Smootherstep: zero velocity at BOTH ends. easeOutCubic launches every
    // particle at full speed the instant it is released, which reads as a
    // snap rather than a dissolve. Here the disc lets go gradually, the
    // particles accelerate, then settle into place without overshoot.
    float e = p * p * p * (p * (p * 6.0 - 15.0) + 10.0);

    // ---- unwind the spiral --------------------------------------------------
    // Angle is 0 at e=0, so at rest the cloud sits exactly on the source pixels.
    vec3 src = position;
    src.xy = rot2(uSwirl * e * (0.30 / (aRadius + 0.22))) * src.xy;

    vec3 pos = mix(src, aStar, e);

    // ---- mid-flight turbulence (zero at both ends) --------------------------
    float mid = sin(e * PI);
    pos += drift(position * 0.6 + aSeed * 8.0, uTime * 0.15)
         * uTurb * mid * (0.4 + aSeed.y);

    pos.xy += uCursor.xy * (0.15 + aSeed.z * 0.5) * mix(0.3, 1.0, e);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    mv.z -= uWarp * (2.0 + aSeed.z * 12.0);

    // ---- staged transition --------------------------------------------------
    // Three separate curves rather than one. Driving size, colour and the haze
    // bloom off a single blend makes every particle spend the middle of the
    // journey as a half-sized, half-coloured smear — and balloons the haze
    // sprites to full width while they are still in flight, which is the
    // muddy look this replaces.
    //
    //   star : particles resolve into crisp points early, while travelling
    //   col  : the palette shift trails slightly behind that
    //   haze : the milky glow only assembles once they have arrived
    float bStar = smoothstep(0.06, 0.52, e);
    float bCol  = smoothstep(0.14, 0.72, e);
    float bHaze = smoothstep(0.55, 0.98, e) * aHaze;

    // ---- size ---------------------------------------------------------------
    // Galaxy: particle DENSITY already tracks image luminance, so per-particle
    // size stays near-constant. Scaling it by luminance too would square the
    // exposure and blow the core to white.
    float galaxyPx = uSize * (0.80 + aLum * 0.45) * uAtten / max(-mv.z, 0.001);

    // Stars are effectively at infinity: a fixed apparent size with only a
    // slight, hard-capped growth as the camera closes in. An uncapped 1/z
    // term here is what turns a starfield into overlapping white blobs.
    float approach = clamp(26.0 / max(-mv.z, 14.0), 0.80, 1.35);
    float twinkle = 0.86 + 0.14 * sin(uTime * 1.9 + aSeed.z * 6.2831);

    float starPx = uStarPx * uDpr * (0.60 + aMag * 2.20) * approach * twinkle;
    float hazePx = uHazePx * uDpr * (0.55 + aSeed.y * 1.20) * approach;
    // Separate ceilings: a star has no business exceeding a few pixels, while
    // the haze is meant to be broad. One shared clamp would either clip the
    // glow or leave the star runaway unguarded.
    // Everything becomes a crisp point first; only then does the haze bloom.
    float px = mix(galaxyPx, min(starPx, 14.0), bStar);
    px = mix(px, min(hazePx, 70.0), bHaze);

    gl_PointSize = clamp(px, 0.6, 70.0);
    gl_Position = projectionMatrix * mv;

    // ---- exposure -----------------------------------------------------------
    // Alpha is computed here, where the per-particle progress lives, so the
    // fragment stage only has to apply the sprite falloff.
    float galaxyA = uBright;
    float starA   = uStarBright * (0.14 + aMag * 1.00) * twinkle;
    float hazeA   = uHazeBright * (0.45 + aMag * 1.10);

    float a = mix(galaxyA, starA, bStar);
    a = mix(a, hazeA, bHaze);

    vAlpha = a * uOpacity;
    vColor = mix(color, aStarCol, bCol);
    vSoft  = bHaze;
  }
`;

const FRAG = /* glsl */ `
  varying vec3  vColor;
  varying float vAlpha;
  varying float vSoft;

  void main() {
    // Procedural sprite - no texture fetch, no atlas to load.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d >= 1.0) discard;

    // Stars: tight core, quick falloff. Haze: wide and smooth to zero, so
    // thousands of them sum into a continuous glow with no visible edges.
    float k = 1.0 - d;
    float star = k * k * (0.28 + 0.72 * k);
    float soft = 1.0 - d * d;
    soft *= soft;

    float a = mix(star, soft, vSoft) * vAlpha;
    if (a < 0.0015) discard;

    // Additive blending is src.rgb * src.a + dst, so all exposure lives in
    // alpha and the colour channel stays clean.
    gl_FragColor = vec4(vColor, a);
  }
`;

/* -------------------------------------------------------------- image sample */

/**
 * Turn an image into weighted particle seeds.
 * Density is proportional to luminance, so the bright core and spiral arms
 * get packed with points while empty sky stays sparse.
 */
function sampleImage(img, targetCount, opts, buffers) {
  const MAXW = 1100;
  const scale = Math.min(1, MAXW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const n = w * h;
  const weight = new Float32Array(n);
  const lumArr = new Float32Array(n);

  // Soft floor kills faint watermarks / JPEG mud without touching real stars.
  const FLOOR = 0.15;
  let total = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const lum = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    lumArr[i] = lum;
    let wt = (lum - FLOOR) / (1 - FLOOR);
    wt = wt > 0 ? Math.pow(wt, 1.55) : 0;
    weight[i] = wt;
    total += wt;
  }
  if (total <= 0) throw new Error('Source image has no usable luminance.');

  const planeH = opts.planeHeight;
  const planeW = planeH * (w / h);
  const halfDiag = Math.hypot(planeW, planeH) * 0.5;

  const { pos, color, seed, lum: lumAttr, radius } = buffers;

  // One pass, stochastic rounding: emit round(weight * k) points per pixel.
  // O(pixels) instead of a CDF plus a binary search per particle.
  const k = targetCount / total;
  let c = 0;

  for (let py = 0; py < h && c < targetCount; py++) {
    for (let px = 0; px < w && c < targetCount; px++) {
      const i = py * w + px;
      const wt = weight[i];
      if (wt === 0) continue;

      const emit = wt * k;
      let count = Math.floor(emit);
      if (Math.random() < emit - count) count++;
      if (count === 0) continue;

      const o = i * 4;
      const lum = lumArr[i];

      // Stacking coloured points additively pulls dense regions toward white,
      // so push saturation up front to keep the gold core and blue arms.
      const SAT = 1.55;
      const r = Math.min(1, Math.max(0, lum + (data[o] / 255 - lum) * SAT));
      const g = Math.min(1, Math.max(0, lum + (data[o + 1] / 255 - lum) * SAT));
      const b = Math.min(1, Math.max(0, lum + (data[o + 2] / 255 - lum) * SAT));

      for (let j = 0; j < count && c < targetCount; j++, c++) {
        // Sub-pixel jitter so the cloud never reads as a grid.
        const u = (px + Math.random()) / w;
        const v = (py + Math.random()) / h;

        const x = (u - 0.5) * planeW;
        const y = (0.5 - v) * planeH;
        const z = Math.pow(lum, 2.2) * opts.bulge + (Math.random() - 0.5) * 0.05;

        const i3 = c * 3;
        pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
        color[i3] = r; color[i3 + 1] = g; color[i3 + 2] = b;
        seed[i3] = Math.random();
        seed[i3 + 1] = Math.random();
        seed[i3 + 2] = Math.random();
        lumAttr[c] = lum;
        radius[c] = Math.min(1, Math.hypot(x, y) / halfDiag);
      }
    }
  }

  // Top up any shortfall from stochastic rounding by cloning existing points.
  for (; c < targetCount; c++) {
    const s3 = Math.floor(Math.random() * Math.max(1, c)) * 3;
    const i3 = c * 3;
    pos[i3] = pos[s3]; pos[i3 + 1] = pos[s3 + 1]; pos[i3 + 2] = pos[s3 + 2];
    color[i3] = color[s3]; color[i3 + 1] = color[s3 + 1]; color[i3 + 2] = color[s3 + 2];
    seed[i3] = Math.random(); seed[i3 + 1] = Math.random(); seed[i3 + 2] = Math.random();
    lumAttr[c] = lumAttr[Math.max(0, c - 1)];
    radius[c] = radius[Math.max(0, c - 1)];
  }

  return { planeW, planeH };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

/* ------------------------------------------------------------------- engine */

export async function createGalaxy(canvas) {
  const quality = pickQuality();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N = quality.count;

  const img = await loadImage(CONFIG.image);

  const buffers = {
    pos:      new Float32Array(N * 3),
    star:     new Float32Array(N * 3),
    color:    new Float32Array(N * 3),
    starCol:  new Float32Array(N * 3),
    seed:     new Float32Array(N * 3),
    lum:      new Float32Array(N),
    radius:   new Float32Array(N),
    mag:      new Float32Array(N),
    haze:     new Float32Array(N),
  };

  const { planeW, planeH } = sampleImage(img, N, CONFIG, buffers);
  buildMilkyWay(N, {
    pos: buffers.star, col: buffers.starCol,
    mag: buffers.mag, haze: buffers.haze,
  });

  /* --- renderer --- */
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // MSAA does nothing for additive points
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setClearColor(0x000105, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 260);
  camera.position.set(0, 0, 6);

  /* --- points --- */
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(buffers.pos, 3));
  geo.setAttribute('aStar',    new THREE.BufferAttribute(buffers.star, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(buffers.color, 3));
  geo.setAttribute('aStarCol', new THREE.BufferAttribute(buffers.starCol, 3));
  geo.setAttribute('aSeed',    new THREE.BufferAttribute(buffers.seed, 3));
  geo.setAttribute('aLum',     new THREE.BufferAttribute(buffers.lum, 1));
  geo.setAttribute('aRadius',  new THREE.BufferAttribute(buffers.radius, 1));
  geo.setAttribute('aMag',     new THREE.BufferAttribute(buffers.mag, 1));
  geo.setAttribute('aHaze',    new THREE.BufferAttribute(buffers.haze, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

  const uniforms = {
    uProgress:   { value: 0 },
    uTime:       { value: 0 },
    uSize:       { value: quality.size },
    uStarPx:     { value: quality.starPx },
    uHazePx:     { value: quality.hazePx },
    uAtten:      { value: 1 },
    uDpr:        { value: 1 },
    uOpacity:    { value: 1 },
    uBright:     { value: 0.4 },
    uStarBright: { value: 0.6 },
    uHazeBright: { value: 0.02 },
    uSwirl:      { value: reduced ? 0 : CONFIG.swirl },
    uTurb:       { value: reduced ? 0 : CONFIG.turbulence },
    uStagger:    { value: CONFIG.stagger },
    uWarp:       { value: 0 },
    uCursor:     { value: new THREE.Vector3() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  scene.add(points);

  /* --- optional photo underlay --- */
  let plane = null;
  if (CONFIG.imagePlaneOpacity > 0) {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    plane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false,
        opacity: CONFIG.imagePlaneOpacity, blending: THREE.AdditiveBlending,
      })
    );
    plane.renderOrder = -1;
    scene.add(plane);
  }

  /**
   * Derive exposure from what is actually being drawn.
   *
   * Additive flux per screen pixel is (particles x sprite area x alpha) over
   * screen area. Solving that for alpha at a fixed target keeps brightness
   * constant no matter the tier, viewport or DPR — which hand-picked
   * per-device constants demonstrably do not.
   *
   * The galaxy term is resolution-independent: point size and galaxy size both
   * scale with the same attenuation factor, so it cancels out and only
   * count, world point size and plane area remain.
   */
  function calibrate(vw, vh) {
    const SPRITE = 0.196;                       // area x mean falloff, in CSS px^2

    // Sprite area, falloff integral and the core's density concentration are
    // all folded into EXPOSURE.galaxy, which was calibrated against a known
    // good frame. Only the terms that actually vary appear here.
    uniforms.uBright.value =
      EXPOSURE.galaxy * (planeW * planeH) / (N * quality.size * quality.size);

    // Resolved stars are discrete objects, so hold their brightness roughly
    // fixed; damp only gently for how densely they are packed on this screen.
    const REF_DENSITY = 95000 / (1440 * 900);
    const density = N / Math.max(1, vw * vh);
    uniforms.uStarBright.value = THREE.MathUtils.clamp(
      EXPOSURE.star * Math.pow(REF_DENSITY / density, 0.6), 0.10, 1.6);

    // The haze IS an accumulation, so it must be normalised outright — and
    // against the area it actually covers. Dividing its flux by the whole
    // viewport instead of the band over-brightens it by ~1/bandFrac, which is
    // what turns the band into a solid white streak.
    const hazeCount = Math.max(1, N * MW.hazeRatio * 0.55);   // 0.55: dust + nebulosity culling
    const meanHazePx = quality.hazePx * 1.15;
    uniforms.uHazeBright.value = THREE.MathUtils.clamp(
      EXPOSURE.haze * (vw * vh * MW.bandFrac) / (hazeCount * meanHazePx * meanHazePx * SPRITE),
      0.002, 0.4);
  }

  /* --- sizing --- */
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;

    // Widen the FOV on narrow screens so the disc never gets cropped.
    const target = planeW / planeH;
    camera.fov = camera.aspect < target
      ? Math.min(92, 52 * Math.pow(target / camera.aspect, 0.55))
      : 52;
    camera.updateProjectionMatrix();

    // gl_PointSize is in DEVICE pixels, so the attenuation constant is built
    // from the drawing buffer, not the CSS height.
    const pr = renderer.getPixelRatio();
    uniforms.uDpr.value = pr;
    uniforms.uAtten.value = (vh * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

    calibrate(vw, vh);
  }
  resize();

  /* --- cursor parallax --- */
  const cursor = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduced) {
    window.addEventListener('pointermove', (e) => {
      cursor.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      cursor.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  /* --- render loop --- */
  const spin = { y: 0, z: 0 };
  const clock = new THREE.Clock();
  let running = true;
  let raf = 0;

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!running) return;

    uniforms.uTime.value += Math.min(clock.getDelta(), 0.05);

    cursor.x += (cursor.tx - cursor.x) * 0.045;
    cursor.y += (cursor.ty - cursor.y) * 0.045;
    uniforms.uCursor.value.set(cursor.x, cursor.y, 0);

    const idle = reduced ? 0 : 1 - Math.min(1, uniforms.uProgress.value * 3);
    points.rotation.z = spin.z + Math.sin(uniforms.uTime.value * 0.045) * 0.02 * idle;
    points.rotation.y = spin.y;
    if (plane) plane.rotation.z = points.rotation.z;

    renderer.render(scene, camera);
  }
  frame();

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) clock.getDelta();          // drop the elapsed hidden time
  });

  window.addEventListener('resize', resize, { passive: true });

  return {
    uniforms, camera, points, plane, scene, renderer, quality, reduced, spin,
    count: N, planeW, planeH, calibrate,
    setImageOpacity(v) { if (plane) plane.material.opacity = v * CONFIG.imagePlaneOpacity; },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      geo.dispose(); material.dispose(); renderer.dispose();
    },
  };
}
