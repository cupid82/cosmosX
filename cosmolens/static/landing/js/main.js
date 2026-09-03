/**
 * main.js — page orchestration
 *
 * Lenis handles inertial scrolling, GSAP ScrollTrigger maps scroll position
 * onto the galaxy engine's uniforms, and a small set of reveals animate the
 * copy. Nothing here touches particles directly — it only writes uniforms.
 */

import { createGalaxy } from './galaxy.js';

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────────────────────────────────────────────────────── smooth scroll */

let lenis = null;
if (!REDUCED) {
  lenis = new Lenis({
    duration: 1.05,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    touchMultiplier: 1.6,
  });

  // Single ticker: Lenis and ScrollTrigger share GSAP's rAF instead of
  // each running their own loop.
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const el = document.querySelector(a.getAttribute('href'));
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: 0, duration: 1.6 });
    });
  });
}

/* ──────────────────────────────────────────────────────────────── loader */

const loaderEl = document.getElementById('loader');
const pctEl = document.getElementById('loaderPct');
document.body.classList.add('is-loading');

let shownPct = 0;
const pctTimer = setInterval(() => {
  shownPct = Math.min(92, shownPct + Math.random() * 9);
  pctEl.textContent = String(Math.floor(shownPct)).padStart(2, '0');
}, 110);

function finishLoader() {
  clearInterval(pctTimer);
  pctEl.textContent = '100';
  loaderEl.classList.add('done');
  document.body.classList.remove('is-loading');
  setTimeout(() => loaderEl.remove(), 1000);
}

/* ─────────────────────────────────────────────────────────────────  boot */

boot();

async function boot() {
  let g;
  try {
    g = await createGalaxy(document.getElementById('scene'));
  } catch (err) {
    console.error('[cosmos] engine failed to start:', err);
    clearInterval(pctTimer);
    pctEl.textContent = '!!';
    document.querySelector('.loader-label .dim').textContent = err.message;
    document.body.classList.remove('is-loading');
    return;
  }

  // Dev handle: tune uniforms live from the console, e.g.
  //   __cosmos.uniforms.uBright.value = 0.4
  window.__cosmos = g;

  finishLoader();
  wireScroll(g);
  wireReveals();
  wirePerf(g);
  wireObservatoryTransition(g);

  // Attribute counts reported in the copy should match what actually shipped.
  const countEl = document.querySelector('[data-count="200000"]');
  if (countEl) countEl.dataset.count = String(g.count);

  ScrollTrigger.refresh();
}

/* ─────────────────────────────────────────── observatory warp transition */

function wireObservatoryTransition(g) {
  const links = document.querySelectorAll('a[href="/observatory"]');
  const curtain = document.getElementById('transition-curtain');
  if (!curtain) return;

  links.forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const targetUrl = a.getAttribute('href') || '/observatory';

      // Disable scrolling during transition
      if (lenis) lenis.stop();

      const tl = gsap.timeline({
        onComplete: () => {
          window.location.href = targetUrl;
        },
      });

      // Cinematic acceleration: plunge camera forward into the stars & warp space
      if (g && g.camera && g.uniforms) {
        tl.to(g.camera.position, {
          z: g.camera.position.z - 18,
          duration: 0.85,
          ease: 'power3.in',
        }, 0);

        if (g.uniforms.uWarp) {
          tl.to(g.uniforms.uWarp, {
            value: 2.2,
            duration: 0.75,
            ease: 'power2.in',
          }, 0);
        }
      }

      // Smooth curtain fade
      tl.to(curtain, {
        opacity: 1,
        duration: 0.75,
        ease: 'power2.inOut',
      }, 0.1);
    });
  });
}

/* ────────────────────────────────────────────────────── scroll → uniforms */

function wireScroll(g) {
  const u = g.uniforms;

  /* ── 1 · the morph ─────────────────────────────────────────────────
     Runs from the moment the hero starts moving to the end of the
     dissolve runway (~260vh of scroll). scrub adds a touch of lag so the
     particles feel like they have mass.                                */
  gsap.to(u.uProgress, {
    value: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: '#hero',
      start: 'top top',
      endTrigger: '#dissolve',
      end: 'bottom bottom',
      scrub: 0.7,
    },
  });

  /* ── 2 · camera: slow push while it comes apart ── */
  gsap.fromTo(g.camera.position, { z: 6 }, {
    z: 3.8,
    ease: 'none',
    scrollTrigger: {
      trigger: '#hero',
      start: 'top top',
      endTrigger: '#dissolve',
      end: 'bottom bottom',
      scrub: 0.7,
    },
  });

  /* ── 3 · camera: dive through the finished field ── */
  gsap.fromTo(g.camera.position, { z: 3.8 }, {
    z: -22,
    ease: 'none',
    scrollTrigger: {
      trigger: '#field',
      start: 'top bottom',
      endTrigger: '#archive',
      end: 'bottom bottom',
      scrub: 0.9,
    },
  });

  /* ── 4 · slow roll, so flying through reads as motion not zoom ── */
  gsap.to(g.spin, {
    z: 0.30, y: 0.16,
    ease: 'none',
    scrollTrigger: {
      trigger: '#field',
      start: 'top bottom',
      endTrigger: '#archive',
      end: 'bottom bottom',
      scrub: 1,
    },
  });

  /* ── 5 · warp pulse across the quote ── */
  gsap.timeline({
    scrollTrigger: { trigger: '#warp', start: 'top bottom', end: 'bottom top', scrub: 1 },
  })
    .to(u.uWarp, { value: 1.1, ease: 'power2.in' })
    .to(u.uWarp, { value: 0, ease: 'power2.out' });

  /* ── 6 · nav bar solidifies once past the hero ──
     Kept transparent over the hero so nothing sits on top of the galaxy. */
  ScrollTrigger.create({
    trigger: '#hero',
    start: 'bottom 90%',
    onEnter: () => document.querySelector('.nav').classList.add('stuck'),
    onLeaveBack: () => document.querySelector('.nav').classList.remove('stuck'),
  });

  /* ── 7 · progress rail ── */
  const fill = document.getElementById('railFill');
  ScrollTrigger.create({
    trigger: 'main',
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => { fill.style.width = (self.progress * 100).toFixed(2) + '%'; },
  });

  /* ── 8 · whispers in the dissolve runway ────────────────────────────
     One scrubbed timeline per line: in, hold, out. Doing the fade-out in
     an onUpdate handler instead would fight the tween for `opacity`.    */
  gsap.utils.toArray('[data-fade]').forEach((el) => {
    gsap.timeline({
      scrollTrigger: { trigger: el, start: 'top 88%', end: 'bottom 12%', scrub: 0.6 },
    })
      .fromTo(el,
        { opacity: 0, y: 40, filter: 'blur(12px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1, ease: 'power2.out' })
      .to(el, { opacity: 1, duration: 0.9 })
      .to(el, { opacity: 0, y: -40, filter: 'blur(12px)', duration: 1, ease: 'power2.in' });
  });
}

/* ───────────────────────────────────────────────────────────── reveals */

function wireReveals() {
  // Hero copy: straight in on load, no scroll needed.
  gsap.set('.hero .reveal', { y: 34, opacity: 0 });
  gsap.to('.hero .reveal', {
    y: 0, opacity: 1, duration: 1.4, ease: 'power3.out', stagger: 0.13, delay: 0.25,
  });

  // Everything else: on entry.
  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    gsap.fromTo(el,
      { y: 42, opacity: 0 },
      {
        y: 0, opacity: 1, duration: 1.1, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 86%', once: true },
      });
  });

  // Odometer counters.
  gsap.utils.toArray('[data-count]').forEach((el) => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => {
        const target = Number(el.dataset.count);
        const obj = { v: 0 };
        gsap.to(obj, {
          v: target, duration: 1.9, ease: 'power2.out',
          onUpdate: () => { el.textContent = Math.floor(obj.v).toLocaleString('en-US'); },
        });
      },
    });
  });
}

/* ──────────────────────────────────────────────────────── perf readout */

function wirePerf(g) {
  const el = document.getElementById('perfReadout');
  if (!el) return;

  let frames = 0, last = performance.now();
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      const fps = Math.round((frames * 1000) / (now - last));
      el.textContent = `${g.count.toLocaleString('en-US')} pts · ${fps} fps · ${g.quality.label}`;
      frames = 0; last = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
