/**
 * milkyway.js — procedural Milky Way model
 *
 * Modelled on `ref milk2.jpg`: a galactic band cutting the frame diagonally,
 * a warm dense core region, dark dust rifts carved through it, and a sparse
 * blue-white field away from the plane.
 *
 * Two populations, because that is what the reference actually contains:
 *
 *   RESOLVED STARS — small, crisp, power-law magnitudes. Most are barely
 *   visible; a handful are bright. These are the points you can pick out.
 *
 *   UNRESOLVED HAZE — large, extremely dim, tightly bound to the plane.
 *   Individually invisible; collectively they are the milky glow that makes
 *   the band a band. Without these you get confetti, not a galaxy.
 *
 * Layout is done in ANGULAR screen coordinates at a reference camera
 * position, then projected out to a distance. That guarantees the band reads
 * correctly at every aspect ratio, and still gives real parallax when the
 * camera flies through it.
 */

export const MW = {
  bandAngle: 1.02,      // band tilt on screen, radians (~58°, matches milk2)
  bandWidth: 0.085,     // bright spine half-thickness, in tan-of-angle units
  bandHalo: 4.2,        // broad wing as a multiple of the spine
  spineRatio: 0.42,     // share of band stars in the tight spine
  bandOffset: 0.11,     // push the ridge off-centre so copy sits on dark sky
  coreAlong: -0.30,     // where the bright core sits along the band
  coreSpread: 0.40,     // how far the core glow reaches along the band
  coreBoost: 2.0,       // density multiplier at the core

  // Populate a bit beyond the widest viewport we expect. Too generous and
  // half the particle budget lands off-screen where it buys nothing.
  halfHeight: 0.70,     // tan of half-FOV to populate vertically
  widthRatio: 2.0,      // horizontal extent as a multiple of halfHeight

  nearDist: 8,
  farDist: 95,
  camZ: 3.8,            // reference camera position the layout is built for

  // Population split. Remainder is the sparse off-plane field.
  bandRatio: 0.32,
  bulgeRatio: 0.06,
  hazeRatio: 0.32,      // must be numerous, or the glow reads as blobs
  // Remainder (~30%) is the all-sky field. The reference is peppered with
  // stars everywhere, not just along the band; too little here and the
  // frame reads as a stripe on black.
  hazeWidth: 1.05,      // haze spreads wider than the spine, tighter than the halo

  dustStrength: 0.97,   // how completely the rifts cut through
  dustHazeBoost: 1.0,   // rifts must cut the glow too, not just the stars

  // Fraction of the frame the band actually covers. Exposure normalisation
  // needs this: the haze is concentrated in the band, so dividing its flux by
  // the whole viewport over-brightens it by roughly this factor.
  bandFrac: 0.22,
};

/* Dark lanes. Each wanders across the band as a sum of two sines, which is
   enough to read as the irregular Great Rift without any noise texture. */
const DUST_LANES = [
  { c: 0.010, w: 0.045, s: 0.95, a1: 0.055, f1: 1.7, p1: 0.0,  a2: 0.022, f2: 4.3, p2: 1.1 },
  { c: 0.075, w: 0.032, s: 0.72, a1: 0.040, f1: 2.4, p1: 2.2,  a2: 0.016, f2: 5.1, p2: 0.4 },
  { c: -0.068, w: 0.030, s: 0.66, a1: 0.036, f1: 2.1, p1: 4.0, a2: 0.014, f2: 6.0, p2: 2.7 },
  { c: 0.145, w: 0.026, s: 0.48, a1: 0.030, f1: 3.0, p1: 1.4,  a2: 0.012, f2: 7.2, p2: 3.3 },
];

function dustOcclusion(along, perp) {
  let occ = 0;
  for (let i = 0; i < DUST_LANES.length; i++) {
    const L = DUST_LANES[i];
    const c = L.c + L.a1 * Math.sin(along * L.f1 + L.p1)
                  + L.a2 * Math.sin(along * L.f2 + L.p2);
    const dd = (perp - c) / L.w;
    const v = L.s * Math.exp(-dd * dd);
    if (v > occ) occ = v;
  }
  return occ;
}

/* Stellar colours. Weighted toward what actually shows up in a long
   exposure: mostly white with a blue cast, a minority of warm giants. */
const STAR_COLORS = [
  { w: 0.40, c: [0.86, 0.90, 1.00] },   // white, faint blue cast
  { w: 0.22, c: [0.66, 0.78, 1.00] },   // blue-white (hot, young)
  { w: 0.16, c: [1.00, 0.97, 0.90] },   // near-white
  { w: 0.13, c: [1.00, 0.88, 0.66] },   // yellow-white
  { w: 0.09, c: [1.00, 0.70, 0.44] },   // orange giants
];

function pickStarColor(warmBias) {
  // warmBias in 0..1 shifts the draw toward the warm end near the core.
  let r = Math.random();
  if (Math.random() < warmBias * 0.55) r = 0.78 + Math.random() * 0.22;
  let acc = 0;
  for (let i = 0; i < STAR_COLORS.length; i++) {
    acc += STAR_COLORS[i].w;
    if (r <= acc) return STAR_COLORS[i].c;
  }
  return STAR_COLORS[0].c;
}

/** Double-exponential draw: sharp ridge, long tails. A gaussian is too soft
 *  here — the reference band has a hard spine and a wide falloff. */
function laplace(scale) {
  const u = Math.random();
  const m = -Math.log(1 - Math.random() * 0.999) * scale;
  return u < 0.5 ? -m : m;
}

/**
 * Fill pos/col/mag/haze arrays with the model.
 * Arrays are written in place so the caller controls allocation.
 */
export function buildMilkyWay(count, out) {
  const { pos, col, mag, haze } = out;

  const phi = MW.bandAngle;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const HH = MW.halfHeight;
  const HW = HH * MW.widthRatio;
  const alongMax = Math.hypot(HW, HH);

  const nBand  = Math.round(count * MW.bandRatio);
  const nBulge = Math.round(count * MW.bulgeRatio);
  const nHaze  = Math.round(count * MW.hazeRatio);

  for (let i = 0; i < count; i++) {
    let along, perp, isHaze = 0, warm = 0, culled = false;

    // ---- pick a population ---------------------------------------------
    // `perp` is measured from the ridge line, not from screen centre; the
    // band offset is applied at projection time so the dust lanes below stay
    // defined relative to the ridge.
    if (i < nHaze) {
      isHaze = 1;
      along = (Math.random() * 2 - 1) * alongMax;
      perp = laplace(MW.bandWidth * MW.hazeWidth);
    } else if (i < nHaze + nBulge) {
      // Core bulge: compact, warm, sitting on the band.
      along = MW.coreAlong + laplace(MW.coreSpread * 0.40);
      perp = laplace(MW.bandWidth * 1.10);
      warm = 1;
    } else if (i < nHaze + nBulge + nBand) {
      // Two-component profile: a tight bright spine inside a broad wing.
      // A single scale gives either a hard streak or a shapeless smear.
      along = (Math.random() * 2 - 1) * alongMax;
      perp = laplace(Math.random() < MW.spineRatio
        ? MW.bandWidth
        : MW.bandWidth * MW.bandHalo);
    } else {
      // Sparse off-plane field: uniform across the frame.
      const sx0 = (Math.random() * 2 - 1) * HW;
      const sy0 = (Math.random() * 2 - 1) * HH;
      along = sx0 * cp + sy0 * sp;
      perp = -sx0 * sp + sy0 * cp - MW.bandOffset;
    }

    // Density rises toward the galactic core along the band.
    const dCore = (along - MW.coreAlong) / MW.coreSpread;
    const coreGlow = Math.exp(-dCore * dCore);
    warm = Math.max(warm * 0.85, coreGlow);

    // Pull toward the core rather than resampling: cheap, same gradient.
    // Keep the pull gentle — too strong and the band bunches up near the core
    // instead of running off both edges of the frame.
    if (Math.random() > (1 + coreGlow * (MW.coreBoost - 1)) / MW.coreBoost) {
      along = MW.coreAlong + (along - MW.coreAlong) * 0.78;
    }

    // ---- nebulosity ------------------------------------------------------
    // Two incommensurate sines give the band an uneven, clumpy brightness
    // along its length instead of reading as a uniform airbrushed streak.
    if (isHaze) {
      const neb = 0.68 + 0.32 * Math.sin(along * 2.3 + 0.7)
                              * Math.sin(along * 5.1 + 2.1);
      if (Math.random() > neb) culled = true;
    }

    // ---- dust rifts ------------------------------------------------------
    const occ = dustOcclusion(along, perp);
    let extinction = 0;
    if (occ > 0.02) {
      const cut = occ * MW.dustStrength * (isHaze ? MW.dustHazeBoost : 1);
      if (Math.random() < cut) culled = true;
      else extinction = occ;   // survivors at the lane edges get reddened
    }

    // Culled particles are pushed far out of frame rather than left as holes
    // in the buffer — keeps the attribute arrays dense and the shader
    // branch-free.
    if (culled) {
      along *= 2.4 + Math.random() * 0.8;
      perp = perp * 2.4 + (Math.random() - 0.5) * 2.0;
    }

    // ---- project to world ------------------------------------------------
    const perpScreen = perp + MW.bandOffset;
    const sx = along * cp - perpScreen * sp;
    const sy = along * sp + perpScreen * cp;

    // Bias toward greater distance so the field has depth without a wall of
    // near stars sweeping past when the camera dollies through.
    const r = MW.nearDist + (MW.farDist - MW.nearDist) * Math.pow(Math.random(), 0.62);

    const i3 = i * 3;
    pos[i3]     = sx * r;
    pos[i3 + 1] = sy * r;
    pos[i3 + 2] = MW.camZ - r;

    // ---- colour ----------------------------------------------------------
    if (isHaze) {
      // The glow itself: warm tan on the core side, cool grey-blue away.
      const t = Math.min(1, warm);
      col[i3]     = 0.34 + 0.62 * t;
      col[i3 + 1] = 0.36 + 0.44 * t;
      col[i3 + 2] = 0.50 + 0.14 * t;
    } else {
      const c = pickStarColor(warm);
      col[i3] = c[0]; col[i3 + 1] = c[1]; col[i3 + 2] = c[2];
    }

    // Interstellar reddening near the dust lanes.
    if (extinction > 0) {
      const k = extinction * 0.75;
      col[i3]     *= 1 - k * 0.10;
      col[i3 + 1] *= 1 - k * 0.42;
      col[i3 + 2] *= 1 - k * 0.72;
    }

    // ---- magnitude -------------------------------------------------------
    // Stars follow a power law: the great majority are faint, a few are
    // genuinely bright. This is the single biggest reason the field reads as
    // sky rather than as a particle system. The exponent is a balance — too
    // steep and almost every star falls below the visibility floor, leaving
    // the frame emptier than the reference.
    // For haze the channel means brightness jitter instead, kept at mean 1 so
    // it does not disturb the exposure calibration.
    mag[i] = isHaze ? Math.random() : Math.pow(Math.random(), 2.3);
    haze[i] = isHaze;
  }
}
