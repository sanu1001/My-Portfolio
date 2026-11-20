/*
  main.js: one requestAnimationFrame loop drives everything that moves
  (smooth scroll, cursor, magnifier, card tilt, the GPU background), so
  nothing fights for the frame.

  Motion follows Apple's model: springs described by a damping ratio
  (1 = no overshoot) and a response time in seconds. Springs always start
  from where the thing currently is, so every motion can be interrupted.

  Easter eggs live near the bottom of this file. No peeking. (Fine, peek.)
*/
(function () {
  'use strict';
  window.__booted = true;

  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqFine = matchMedia('(hover: hover) and (pointer: fine)');
  let reduce = mqReduce.matches;
  const fine = mqFine.matches;

  /* ── Spring ─────────────────────────────────────────────── */
  class Spring {
    constructor(value = 0, damping = 1, response = 0.4) {
      this.v = value; this.t = value; this.vel = 0;
      this.tune(damping, response);
    }
    tune(damping, response) {
      const w = (2 * Math.PI) / response;
      this.k = w * w;
      this.c = 2 * damping * w;
    }
    /* returns true while still moving */
    step(dt) {
      if (this.v === this.t && this.vel === 0) return false;
      let n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      while (n--) {
        const a = -this.k * (this.v - this.t) - this.c * this.vel;
        this.vel += a * h;
        this.v += this.vel * h;
      }
      if (Math.abs(this.v - this.t) < 0.001 && Math.abs(this.vel) < 0.01) {
        this.v = this.t; this.vel = 0; return false;
      }
      return true;
    }
    snap(v) { this.v = this.t = v; this.vel = 0; }
  }

  /* ── Elements ───────────────────────────────────────────── */
  let canvas = $('#glass');
  const scroller = $('#scroller');
  const inner = $('.scroll-inner');
  const cursor = $('.cursor');
  const loupeEl = $('.loupe');
  const meter = $('.scroll-meter');
  const meterThumb = $('.scroll-meter i');
  const menu = $('.menu');
  const menuLinks = $$('.menu a');
  const menuInd = $('.menu-ind');
  const menuHover = $('.menu-hover');
  const tabLinks = $$('.tabbar a');
  const tabInd = $('.tab-ind');
  const sections = $$('.sec');
  const glassEls = $$('[data-glass]');

  /* ── Viewport + layout cache (only read on resize) ─────── */
  let vw = innerWidth, vh = innerHeight;
  let viewH = scroller.clientHeight, maxScroll = 1, secTops = [];

  function measure() {
    vw = innerWidth; vh = innerHeight;
    viewH = scroller.clientHeight;
    maxScroll = Math.max(1, scroller.scrollHeight - viewH);
    const base = inner.getBoundingClientRect().top;
    secTops = sections.map((s) => s.getBoundingClientRect().top - base);
    measureLoupe();
    rectsDirty = true;
    activeIdx = -1; // force indicator refresh
  }

  /* ── Smooth scrolling (Lenis, inside the right panel) ──── */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({
      wrapper: scroller,
      content: inner,
      lerp: 0.085,
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1,
      autoRaf: false,
    });
  }

  function scrollToEl(target) {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    const top = el.getBoundingClientRect().top - inner.getBoundingClientRect().top;
    const y = el.id === 'home' ? 0 : top - 8;
    if (lenis) {
      lenis.scrollTo(y, { duration: 1.25, easing: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)) });
    } else {
      scroller.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"], [data-goto]');
    if (!a) return;
    const sel = a.dataset.goto || a.getAttribute('href');
    if (!sel || sel === '#') return;
    e.preventDefault();
    scrollToEl(sel);
  });

  /* ── Active section → menu + tab bar indicators ─────────── */
  let activeIdx = -1;
  function setActive(i) {
    if (i === activeIdx) return;
    activeIdx = i;
    const id = sections[i] && sections[i].id;
    menuLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
    tabLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
    const m = menuLinks.find((a) => a.classList.contains('active'));
    if (m && menuInd) menuInd.style.transform = `translateY(${m.offsetTop + m.offsetHeight / 2 - 10}px)`;
    const t = tabLinks.find((a) => a.classList.contains('active'));
    if (t && tabInd) tabInd.style.transform = `translateX(${t.offsetLeft - 6}px)`;
  }

  /* A glass pill glides behind whichever menu item you point at. */
  if (menu && menuHover) {
    menuLinks.forEach((a) => a.addEventListener('pointerenter', () => {
      menuHover.style.height = a.offsetHeight - 6 + 'px';
      menuHover.style.transform = `translateY(${a.offsetTop + 3}px)`;
    }));
  }

  /* ── Reveal on scroll ───────────────────────────────────── */
  const countEls = $$('[data-count]');
  const fmt = (n, dec) => n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  function countUp(el) {
    const end = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.dec || '0', 10);
    const suf = el.dataset.suffix || '';
    if (reduce) { el.textContent = fmt(end, dec) + suf; return; }
    const t0 = performance.now(), dur = 1600;
    const node = el.firstChild || el.appendChild(document.createTextNode(''));
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
      const txt = fmt(end * e, dec) + suf;
      if (node.data !== txt) node.data = txt;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  countEls.forEach((el) => {
    el.textContent = fmt(0, parseInt(el.dataset.dec || '0', 10)) + (el.dataset.suffix || '');
  });

  const revealIO = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      el.classList.add('in');
      $$('[data-count]', el).forEach(countUp);
      if (el.matches('[data-count]')) countUp(el);
      revealIO.unobserve(el);
    }
  }, { root: scroller, rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

  /* Pause the marquee when it's off screen. */
  const pauseIO = new IntersectionObserver((entries) => {
    for (const en of entries) en.target.classList.toggle('paused', !en.isIntersecting);
  }, { root: scroller });
  $$('.marquee, [data-pause]').forEach((m) => pauseIO.observe(m));

  /* ── Know More toggle ───────────────────────────────────── */
  const aboutBox = $('.about-box');
  const km = $('.know-more');
  if (km && aboutBox) {
    km.setAttribute('aria-label', 'Know more about me');
    km.addEventListener('click', () => {
      const on = aboutBox.classList.toggle('story');
      km.setAttribute('aria-expanded', String(on));
      km.setAttribute('aria-label', on ? 'Back to the overview' : 'Know more about me');
    });
  }

  /* ── Custom cursor (mouse only) ─────────────────────────── */
  const curX = new Spring(vw / 2, 1, 0.09);
  const curY = new Spring(vh / 2, 1, 0.09);
  const lightX = new Spring(vw * 0.6, 1, 0.6); // shader light + parallax
  const lightY = new Spring(vh * 0.4, 1, 0.6);
  let cursorOn = false, ptrX = -1e5, ptrY = -1e5, hoverState = '';
  const useCursor = fine && cursor;
  if (useCursor) root.classList.add('has-cursor');

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    lightX.t = e.clientX; lightY.t = e.clientY;
    if (!useCursor) return;
    ptrX = e.clientX; ptrY = e.clientY;
    curX.t = e.clientX; curY.t = e.clientY;
    if (!cursorOn) {
      curX.snap(e.clientX); curY.snap(e.clientY);
      cursor.classList.add('on'); cursorOn = true;
    }
  }, { passive: true });
  document.addEventListener('mouseleave', () => {
    if (!useCursor) return;
    cursor.classList.remove('on'); cursorOn = false; ptrX = ptrY = -1e5;
  });
  addEventListener('pointerdown', () => useCursor && cursor.classList.add('down'));
  addEventListener('pointerup', () => useCursor && cursor.classList.remove('down'));
  document.addEventListener('pointerover', (e) => {
    if (!useCursor || !e.target.closest) return;
    const t = e.target.closest('[data-cursor], a, button');
    hoverState = t ? (t.dataset.cursor || 'link') : '';
    if (!lensHit) cursor.dataset.state = hoverState;
  });

  /* ── Liquid glass lens over the big headings ────────────────
     Rendering: each heading is captured once into a texture with
     html-to-image, then a WebGL2 glass dome shader (adapted from
     StarKnightt/liquid-glass, MIT) draws the lens on a small canvas that
     follows the cursor, with real bilinear sampling (smooth edges).
     On/off: decided once per frame from the real text boxes, the pointer
     and the scroll position, so it can't get stuck or miss an entry. */
  const LENS = { R: 62, mag: 1.12, refract: 0.5, frost: 0.1 };
  const LOUPE_BOX = Math.round(LENS.R * 2.9);        // room for wobble and the soft shadow
  const loupeR = new Spring(0, 0.62, 0.32);   // bouncier pop when the lens appears
  const lensTargets = [];
  let lensHit = null, lensShown = null;
  let originX = 0, originY = 0, panelW = 0;
  let gl = null, glU = null, lensDpr = 1, fontCSS = null;
  let wob = 0, wobVel = 0, stretch = 0, dirX = 1, dirY = 0;

  const LENS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;   // the heading, premultiplied
uniform vec2 uRes;        // canvas size, device px
uniform float uDpr;
uniform vec4 uLens;       // radius (css px), time, unused, unused
uniform vec4 uMotion;     // direction (y down), stretch, wobble
uniform vec4 uMap;        // lens centre in heading space, heading texture size (css px)
uniform vec3 uParams;     // magnification, refraction, frost
out vec4 outColor;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec4 textAt(vec2 p) {
  vec2 uv = p / uMap.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uTex, uv);
}

void main() {
  // css px from the lens centre, y down
  vec2 v = vec2(gl_FragCoord.x - uRes.x * 0.5, uRes.y * 0.5 - gl_FragCoord.y) / uDpr;
  vec2 q = v;
  vec2 dir = uMotion.xy;
  float stretch = uMotion.z;
  if (stretch > 0.001) {           // droplet elongates when moved fast
    vec2 tg = vec2(dir.y, -dir.x);
    q = dir * (dot(q, dir) / (1.0 + stretch)) + tg * (dot(q, tg) * (1.0 + stretch * 0.5));
  }
  float t = uLens.y;
  float ang = atan(q.y, q.x);
  float wob = uMotion.w * (0.046 * sin(ang * 3.0 + t * 2.1) + 0.032 * sin(ang * 5.0 - t * 3.3)
            + 0.020 * sin(ang * 7.0 + t * 4.7)) + 0.008 * sin(ang * 2.0 + t * 0.8);
  float R = uLens.x;
  float r = length(q);
  float Rw = R * (1.0 + wob);
  float d = r - Rw;
  float aa = 1.2 / uDpr;
  float inside = smoothstep(aa, -aa, d);

  // soft shadow under the lens
  float shadow = smoothstep(R * 1.35, R * 0.55, length(q - vec2(0.0, R * 0.22))) * 0.16 * (1.0 - inside);
  vec4 col = vec4(0.0, 0.0, 0.0, shadow);

  if (inside > 0.0) {
    // treat the lens as a glass dome; its 3D normal drives everything
    float r01 = clamp(r / Rw, 0.0, 1.0);
    float h = sqrt(max(1.0 - r01 * r01, 0.0));
    vec3 N = normalize(vec3(q / Rw, h * 1.15));
    vec2 base = uMap.xy + v / uParams.x;               // magnify toward the centre
    float bend = 1.0 - h;
    vec2 refr = -N.xy * bend * uParams.y * R * 0.9;     // bend rays near the rim
    float ca = 0.16 * uParams.y;                        // colour split
    float fr = uParams.z * (0.25 + 0.75 * bend) * 10.0 / uDpr;
    vec2 taps[5] = vec2[5](vec2(0.0), vec2(1.0, 0.3), vec2(-0.6, 0.9), vec2(-0.9, -0.5), vec2(0.5, -0.9));
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 5; i++) {
      vec2 o = taps[i] * fr;
      vec4 sr = textAt(base + refr * (1.0 + ca) + o);
      vec4 sg = textAt(base + refr + o);
      vec4 sb = textAt(base + refr * (1.0 - ca) + o);
      acc += vec4(sr.r, sg.g, sb.b, max(sr.a, max(sg.a, sb.a)));
    }
    vec4 glass = acc / 5.0;

    // key light from the top left
    vec3 L = normalize(vec3(-0.35, -0.55, 0.75));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float ndh = max(dot(N, H), 0.0);
    float spec = pow(ndh, 90.0) * 0.7 + pow(ndh, 18.0) * 0.14;
    float fres = pow(1.0 - max(N.z, 0.0), 2.5);
    float rim = smoothstep(aa * 2.5, 0.0, abs(d)) * 0.3;
    float light = clamp(spec + fres * 0.16 + rim, 0.0, 1.0);

    vec4 body = vec4(0.0, 0.0, 0.0, 0.02 + fres * 0.08);  // a whisper of glass so it reads over empty space
    vec4 g = glass + body * (1.0 - glass.a);
    g += vec4(vec3(light), light);
    g += (hash21(gl_FragCoord.xy + t) - 0.5) * uParams.z * 0.04 * g.a;
    col = mix(col, clamp(g, 0.0, 1.0), inside);
  }
  outColor = col;
}`;

  function initLensGL(canvas) {
    const g = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!g) return null;
    const sh = (type, src) => {
      const x = g.createShader(type);
      g.shaderSource(x, src); g.compileShader(x);
      if (!g.getShaderParameter(x, g.COMPILE_STATUS)) { console.warn('[lens]', g.getShaderInfoLog(x)); return null; }
      return x;
    };
    const vs = sh(g.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}');
    const fs = sh(g.FRAGMENT_SHADER, LENS_FRAG);
    if (!vs || !fs) return null;
    const p = g.createProgram();
    g.attachShader(p, vs); g.attachShader(p, fs); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) return null;
    g.useProgram(p);
    g.bindVertexArray(g.createVertexArray());
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    glU = {};
    for (const n of ['uTex', 'uRes', 'uDpr', 'uLens', 'uMotion', 'uMap', 'uParams']) glU[n] = g.getUniformLocation(p, n);
    g.uniform1i(glU.uTex, 0);
    g.uniform3f(glU.uParams, LENS.mag, LENS.refract, LENS.frost);
    return g;
  }
  function sizeLens() {
    if (!gl) return;
    lensDpr = Math.min(devicePixelRatio || 1, 2);
    const px = Math.round(LOUPE_BOX * lensDpr);
    loupeEl.style.width = loupeEl.style.height = LOUPE_BOX + 'px';
    if (loupeEl.width !== px) { loupeEl.width = loupeEl.height = px; }
    gl.viewport(0, 0, px, px);
    gl.uniform2f(glU.uRes, px, px);
    gl.uniform1f(glU.uDpr, lensDpr);
  }

  // Capture a heading into a texture, once (and again after a resize).
  const captureOpts = (t, extra) => {
    const fs = parseFloat(getComputedStyle(t.src).fontSize) || 60;
    return Object.assign({
      width: t.src.offsetWidth + 12,
      height: Math.ceil(t.src.offsetHeight + fs * 0.35),             // room for descenders
      pixelRatio: Math.min(2.5, (devicePixelRatio || 1) * 1.2),      // just above the 1.12x zoom
      fontEmbedCSS: fontCSS,
      style: { opacity: '1', translate: 'none', transform: 'none', margin: '0', maskImage: 'none', webkitMaskImage: 'none' },
    }, extra);
  };
  // How much text actually landed in a capture (checked on a 64px thumbnail).
  const inkOf = (cv) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
    return n;
  };
  async function captureLens(t) {
    if (!window.htmlToImage || t.busy) return;
    t.busy = true;
    try {
      const o = captureOpts(t);
      // html-to-image can render a heading before its embedded fonts are ready,
      // leaving lines blank. Take two passes and keep whichever has more text.
      let cv = await window.htmlToImage.toCanvas(t.src, o);
      let ink = inkOf(cv);
      for (let i = 0; i < 2; i++) {
        await sleep(120);
        const again = await window.htmlToImage.toCanvas(t.src, o);
        const ink2 = inkOf(again);
        if (ink2 <= ink) break;
        cv = again; ink = ink2;
      }
      if (!ink) return;                                                // nothing captured: leave the lens off
      if (!t.tex) t.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      t.tw = o.width; t.th = o.height; t.ready = true;
      if (lensShown) gl.bindTexture(gl.TEXTURE_2D, lensShown.tex);
    } catch (err) {
      console.warn('[lens] capture failed', err);
    } finally {
      t.busy = false;
    }
  }
  // One heading per idle slot, so a capture never lands in the middle of a scroll.
  const idleSlot = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 120)));
  let warmed = false;
  async function captureAll() {
    if (!lensTargets.length || !window.htmlToImage) return;
    try {
      if (!fontCSS) fontCSS = await window.htmlToImage.getFontEmbedCSS(lensTargets[0].src);
      if (!warmed) {                                                   // throwaway render so fonts are decoded
        warmed = true;
        await window.htmlToImage.toCanvas(lensTargets[0].src, captureOpts(lensTargets[0], { pixelRatio: 0.25 }));
      }
    } catch (err) {
      console.warn('[lens] font embed failed', err);
    }
    for (const t of lensTargets) { await idleSlot(); await captureLens(t); }
  }
  function loadCapturer() {
    if (window.htmlToImage) return Promise.resolve();
    return new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/html-to-image.js';
      s.onload = res; s.onerror = res;
      document.head.appendChild(s);
    });
  }

  function contentPos(el) {
    let x = el.offsetLeft, y = el.offsetTop, p = el.offsetParent;
    while (p && p !== scroller) { x += p.offsetLeft + p.clientLeft; y += p.offsetTop + p.clientTop; p = p.offsetParent; }
    return p === scroller ? [x, y] : null;
  }
  function measureLoupe() {
    if (!lensTargets.length) return;
    const r = scroller.getBoundingClientRect();
    originX = r.left + scroller.clientLeft;
    originY = r.top + scroller.clientTop;
    panelW = scroller.clientWidth;
    for (const t of lensTargets) {
      const pos = contentPos(t.src);
      t.ok = !!pos;
      if (!pos) continue;
      t.x = pos[0]; t.y = pos[1];
      t.boxes = [];
      for (const h of t.hits) {
        const q = contentPos(h);
        if (q && h.offsetWidth) t.boxes.push([q[0], q[1], h.offsetWidth, h.offsetHeight]);
      }
    }
  }
  function overText(t, x, y, pad) {
    for (const b of t.boxes) {
      if (x >= b[0] - pad && x <= b[0] + b[2] + pad && y >= b[1] - pad && y <= b[1] + b[3] + pad) return true;
    }
    return false;
  }
  function hideLoupe() {
    if (!lensShown) return;
    lensShown.src.classList.remove('mag-on');
    loupeEl.classList.remove('on');
    lensShown = null;
    loupeR.snap(0);
  }
  function showLoupe(t) {
    if (lensShown === t) return;
    if (lensShown) lensShown.src.classList.remove('mag-on');
    lensShown = t;
    t.src.classList.add('mag-on');
    loupeEl.classList.add('on');
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
  }
  function updateLoupe(dt, now) {
    // 1. decide: is the real pointer over a heading's text right now?
    let hit = null;
    const sheetOpen = sheet && !sheet.hidden;
    if (cursorOn && !sheetOpen && pull.t === 0 &&
        ptrX >= originX && ptrX <= originX + panelW && ptrY >= originY && ptrY <= originY + viewH) {
      const x = ptrX - originX, y = ptrY - originY + scrollY;
      if (lensHit && overText(lensHit, x, y, 14)) hit = lensHit;   // a little grace to stay on
      else for (const t of lensTargets) if (t.ok && t.ready && overText(t, x, y, 2)) { hit = t; break; }
    }
    if (hit !== lensHit) {
      lensHit = hit;
      cursor.dataset.state = hit ? 'mag' : hoverState;
      loupeR.t = hit ? LENS.R : 0;
      if (hit) showLoupe(hit);
    }
    if (!lensShown) return;

    // 2. animate: radius spring, plus a liquid stretch and wobble from the cursor's speed
    if (reduce) loupeR.snap(loupeR.t); else loupeR.step(dt);
    const r = Math.max(0, loupeR.v);
    if (!lensHit && r <= 0.5) { hideLoupe(); return; }
    const speed = reduce ? 0 : Math.hypot(curX.vel, curY.vel);
    if (speed > 1) { dirX = curX.vel / speed; dirY = curY.vel / speed; }
    stretch += (Math.min(speed / 3200, 0.3) - stretch) * (1 - Math.exp(-12 * dt));
    wobVel += (Math.min(speed / 1500, 1.2) - wob) * 46 * dt;
    wobVel *= Math.exp(-3.0 * dt);              // lower damping: the jelly rings longer
    wob = clamp(wob + wobVel * dt, 0, 1.5);

    // 3. place and draw
    const t = lensShown;
    const cx = curX.v, cy = curY.v;
    const sx = originX + t.x, sy = originY + t.y - scrollY;
    loupeEl.style.transform = `translate3d(${(cx - LOUPE_BOX / 2).toFixed(2)}px, ${(cy - LOUPE_BOX / 2).toFixed(2)}px, 0)`;
    const ss = t.src.style;
    ss.setProperty('--mx', (cx - sx).toFixed(1) + 'px');
    ss.setProperty('--my', (cy - sy).toFixed(1) + 'px');
    ss.setProperty('--lr', (r * (1.01 + stretch + 0.1 * wob)).toFixed(1) + 'px');
    gl.uniform4f(glU.uLens, r, now / 1000, 0, 0);
    gl.uniform4f(glU.uMotion, dirX, dirY, stretch, wob);
    gl.uniform4f(glU.uMap, cx - sx, cy - sy, t.tw, t.th);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function initLoupe() {
    if (!useCursor || !loupeEl) return;
    gl = initLensGL(loupeEl);
    if (!gl) return;
    sizeLens();
    for (const src of $$('.intro, .heading')) {
      src.classList.add('mag-src');
      const hits = src.matches('.intro') ? $$('.line > span', src) : [src];
      lensTargets.push({ src, hits, x: 0, y: 0, boxes: [], ok: false, ready: false, tex: null, tw: 1, th: 1, busy: false });
    }
  }

  /* ── Pointer light: glass edges and sheen follow the mouse ─ */
  if (fine) {
    document.addEventListener('pointermove', (e) => {
      const s = e.target.closest && e.target.closest('.spot');
      if (!s) return;
      const r = s.getBoundingClientRect();
      s.style.setProperty('--sx', (e.clientX - r.left).toFixed(1) + 'px');
      s.style.setProperty('--sy', (e.clientY - r.top).toFixed(1) + 'px');
    }, { passive: true });
  }

  /* ── Tilt (cards, tiles) and magnetic pull (buttons) ───── */
  const motions = new Set();
  function attachMotion(el, o) {
    const st = {
      el, o,
      rx: new Spring(0, 0.8, 0.45), ry: new Spring(0, 0.8, 0.45),
      tx: new Spring(0, 0.62, 0.45), ty: new Spring(0, 0.62, 0.45),
      lift: new Spring(0, 1, 0.35),
      rect: null, sy: 0,
    };
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      st.rect = el.getBoundingClientRect();
      st.sy = scrollY;
      st.lift.t = 1; motions.add(st);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !st.rect) return;
      const x = (e.clientX - st.rect.left) / st.rect.width;
      const y = (e.clientY - st.rect.top + (scrollY - st.sy)) / st.rect.height;
      st.ry.t = (x - 0.5) * o.tilt;
      st.rx.t = -(y - 0.5) * o.tilt * 0.75;
      st.tx.t = (x - 0.5) * st.rect.width * o.magnet;
      st.ty.t = (y - 0.5) * st.rect.height * o.magnet;
      motions.add(st);
    });
    el.addEventListener('pointerleave', () => {
      st.rx.t = st.ry.t = st.tx.t = st.ty.t = st.lift.t = 0;
      st.rect = null; motions.add(st);
    });
  }
  if (fine && !reduce) {
    $$('[data-tilt]').forEach((el) => attachMotion(el, { tilt: 6, magnet: 0, lift: 5, scale: 0 }));
    $$('.tile').forEach((el) => attachMotion(el, { tilt: 16, magnet: 0.22, lift: 4, scale: 0.05 }));
    $$('[data-magnet]:not(.tile)').forEach((el) => attachMotion(el, { tilt: 0, magnet: 0.14, lift: 0, scale: 0 }));
  }

  /* ── GPU background ─────────────────────────────────────── */
  let renderer = null;
  let renderScale = 1, quality = 1;
  const U = new Float32Array(92);
  const intro = new Spring(0, 0.85, 1.1);
  const scrollProg = new Spring(0, 1, 0.9);
  const squash = new Spring(0, 0.6, 0.55);
  const pull = new Spring(0, 0.5, 0.75);      // gravity well (hold the mouse down)
  const liquid = new Spring(0, 0.9, 1.2);     // Konami "liquid mode"
  let phase = 0;
  let rects = [], rectsDirty = true, rectsLiveUntil = 0;

  const COLORS = [
    [157 / 255, 68 / 255, 192 / 255, 0.8], // #9D44C0
    [77 / 255, 45 / 255, 183 / 255, 0.8],  // #4D2DB7
    [236 / 255, 83 / 255, 176 / 255, 0.8], // #EC53B0
  ];
  // where each circle settles around the pointer when pulled
  const PULL_AT = [[-0.42, -0.2, 1], [0.38, 0.1, 0.85], [-0.02, 0.46, 1.1]];
  const CIRCLE_BUF = new Float64Array(9);

  function sizeCanvas() {
    if (!canvas) return;
    let s = Math.min(devicePixelRatio || 1, 1.25) * quality;
    const maxPx = 2.2e6;
    if (vw * vh * s * s > maxPx) s = Math.sqrt(maxPx / (vw * vh));
    const w = Math.max(1, Math.round(vw * s));
    const h = Math.max(1, Math.round(vh * s));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    renderScale = w / vw;
  }

  function readRects() {
    rects = [];
    for (const el of glassEls) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (!el._radius) el._radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      rects.push([r.left, r.top, r.width, r.height, el._radius]);
    }
  }

  function writeUniforms() {
    const W = vw, H = vh;
    const unit = clamp(Math.min(W, H) / 864, 0.5, 1.6);
    const p = scrollProg.v;
    const s = Math.max(0, intro.v);
    const t = reduce && liquid.v < 0.01 ? 0 : phase;
    const mx = lightX.v / W - 0.5, my = lightY.v / H - 0.5;
    const sq = 1 + Math.min(0.16, Math.abs(squash.v));
    const PI = Math.PI;
    const ease = p * p * (3 - 2 * p);
    const px = useCursor ? curX.v : lightX.v, py = useCursor ? curY.v : lightY.v;
    const pullAmt = pull.v + liquid.v * 0.2;
    const wob = 1 + liquid.v * 2.6 + Math.max(0, pull.v) * 1.4;

    U[0] = W; U[1] = H; U[2] = t; U[3] = renderScale;
    U[4] = lightX.v; U[5] = lightY.v; U[6] = rects.length; U[7] = 0;

    // centre x, centre y, radius for the three circles (no allocations per frame)
    const C = CIRCLE_BUF;
    // purple: top left, slides down the left edge as you read
    C[0] = W * (0.03 + 0.05 * Math.sin(p * PI)) + Math.sin(t * 0.11) * 0.012 * W - mx * 40;
    C[1] = H * (0.05 + 0.8 * ease) + Math.cos(t * 0.09) * 0.02 * H - my * 30;
    C[2] = 205 * unit;
    // indigo: right side, rises and settles
    C[3] = W * (1.0 - 0.06 * Math.sin(p * PI * 1.3)) + Math.sin(t * 0.08 + 2) * 0.012 * W + mx * 28;
    C[4] = H * (0.43 - 0.34 * Math.sin(p * PI)) + Math.cos(t * 0.1 + 1) * 0.02 * H + my * 24;
    C[5] = 285 * unit;
    // pink: bottom, glides to the right
    C[6] = W * (0.24 + 0.5 * p) + Math.sin(t * 0.13 + 4) * 0.015 * W - mx * 60;
    C[7] = H * (0.93 - 0.07 * Math.sin(p * PI * 2)) + Math.cos(t * 0.12 + 3) * 0.015 * H - my * 50;
    C[8] = 92 * unit;
    for (let i = 0; i < 3; i++) {
      let cx = C[i * 3], cy = C[i * 3 + 1];
      if (pullAmt !== 0) {
        const at = PULL_AT[i], amt = pullAmt * at[2];
        cx = lerp(cx, px + at[0] * 300 * unit, amt);
        cy = lerp(cy, py + at[1] * 300 * unit, amt);
      }
      const o = 8 + i * 4;
      U[o] = cx; U[o + 1] = cy; U[o + 2] = C[i * 3 + 2] * s; U[o + 3] = sq;
      const k = 20 + i * 4;
      U[k] = COLORS[i][0]; U[k + 1] = COLORS[i][1]; U[k + 2] = COLORS[i][2]; U[k + 3] = COLORS[i][3];
      // slow "breathing" of each circle's edge (a few percent of its radius)
      const w = 32 + i * 4;
      U[w] = 0.022 * wob * Math.cos(t * 0.21 + i * 2.4);
      U[w + 1] = 0.022 * wob * Math.sin(t * 0.17 + i * 1.3);
      U[w + 2] = 0.012 * wob * Math.cos(t * 0.13 + i);
      U[w + 3] = 0.012 * wob * Math.sin(t * 0.19 + i * 0.7);
    }
    const a = clamp(intro.v, 0, 1);
    for (let i = 0; i < 6; i++) {
      const r = rects[i];
      const o = 44 + i * 4, q = 68 + i * 4;
      if (r) {
        U[o] = r[0]; U[o + 1] = r[1]; U[o + 2] = r[2]; U[o + 3] = r[3];
        U[q] = r[4]; U[q + 1] = a; U[q + 2] = fine ? 1 : 0; U[q + 3] = 0;
      } else {
        U[o] = U[o + 1] = U[o + 2] = U[o + 3] = 0; U[q] = U[q + 1] = U[q + 2] = U[q + 3] = 0;
      }
    }
  }

  function fallbackToCSS() {
    renderer = null;
    root.classList.add('no-gpu');
  }

  /* ── The frame loop ─────────────────────────────────────── */
  let last = performance.now();
  let scrollY = 0, lastScrollY = 0, idleTimer = 0;
  let slow = 0, frames = 0, lastRender = 0, lastThumbH = -1;

  function frame(now) {
    const dtMs = now - last;
    const dt = Math.min(0.05, dtMs / 1000);
    last = now;

    if (lenis) lenis.raf(now);
    scrollY = lenis ? lenis.animatedScroll : scroller.scrollTop;
    const vel = lenis ? lenis.velocity : (scrollY - lastScrollY);
    const moved = scrollY !== lastScrollY;
    lastScrollY = scrollY;

    // active section
    let idx = 0;
    const probe = scrollY + viewH * 0.4;
    for (let i = 0; i < secTops.length; i++) if (probe >= secTops[i]) idx = i;
    if (scrollY >= maxScroll - 4) idx = sections.length - 1;
    setActive(idx);
    if (moved && scrollY >= maxScroll - 2) reachedEnd();

    // overlay scroll indicator
    if (moved && meter) {
      const trackH = viewH - 36;
      const thumbH = Math.max(40, trackH * (viewH / (maxScroll + viewH)));
      const y = (trackH - thumbH) * clamp(scrollY / maxScroll, 0, 1);
      if (thumbH !== lastThumbH) { lastThumbH = thumbH; meterThumb.style.height = thumbH + 'px'; }
      meterThumb.style.transform = `translateY(${y}px)`;
      meter.classList.add('on');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => meter.classList.remove('on'), 900);
    }

    // cursor
    if (useCursor && cursorOn) {
      curX.step(dt); curY.step(dt);
      cursor.style.transform = `translate3d(${curX.v.toFixed(2)}px, ${curY.v.toFixed(2)}px, 0)`;
    }

    // liquid glass loupe
    if (lensTargets.length) updateLoupe(dt, now);

    // tilt + magnet
    for (const st of motions) {
      const m1 = st.rx.step(dt), m2 = st.ry.step(dt), m3 = st.tx.step(dt), m4 = st.ty.step(dt), m5 = st.lift.step(dt);
      const moving = m1 || m2 || m3 || m4 || m5;
      const rest = st.lift.v === 0 && st.tx.v === 0 && st.ty.v === 0 && st.rx.v === 0 && st.ry.v === 0;
      if (rest) {
        st.el.style.transform = '';
      } else {
        const sc = 1 + st.o.scale * st.lift.v;
        st.el.style.transform =
          `perspective(900px) translate3d(${st.tx.v.toFixed(2)}px, ${(st.ty.v - st.o.lift * st.lift.v).toFixed(2)}px, 0) ` +
          `rotateX(${st.rx.v.toFixed(3)}deg) rotateY(${st.ry.v.toFixed(3)}deg) scale(${sc.toFixed(4)})`;
      }
      if (!moving) motions.delete(st);
    }

    // GPU background
    if (renderer) {
      scrollProg.t = clamp(scrollY / maxScroll, 0, 1);
      squash.t = reduce ? 0 : clamp(vel * 0.004, -0.16, 0.16);
      const m1 = lightX.step(dt), m2 = lightY.step(dt);
      const m3 = scrollProg.step(dt), m4 = squash.step(dt), m5 = intro.step(dt);
      const m6 = pull.step(dt), m7 = liquid.step(dt);
      phase += dt * (1 + liquid.v * 2.2);
      const live = now < rectsLiveUntil;
      const busy = moved || m1 || m2 || m3 || m4 || m5 || m6 || m7 || live || rectsDirty ||
        liquid.v > 0.01 || pull.t !== 0;
      // While nothing is moving, the slow ambient drift only needs ~20fps.
      if (busy || (!reduce && now - lastRender > 50)) {
        if (rectsDirty || live) { readRects(); rectsDirty = false; }
        writeUniforms();
        renderer.render(U);
        lastRender = now;

        // Adaptive quality: if busy frames keep running long, render fewer pixels.
        if (busy && root.classList.contains('is-ready') && !document.hidden) {
          frames++;
          if (dtMs > 24) slow++;
          if (frames >= 150) {
            if (slow > 60 && quality > 0.55) { quality *= 0.8; sizeCanvas(); }
            frames = 0; slow = 0;
          }
        }
      }
    }

    requestAnimationFrame(frame);
  }

  /* ── Resize ─────────────────────────────────────────────── */
  let resizeRaf = 0, lastCaptureW = innerWidth, recaptureTimer = 0;
  function onResize() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const w = innerWidth;
      measure();
      sizeCanvas();
      if (lenis) lenis.resize();
      // headings change size with the window: re-capture them for the lens
      if (gl && w !== lastCaptureW && lensTargets.some((t) => t.ready)) {
        lastCaptureW = w;
        clearTimeout(recaptureTimer);
        recaptureTimer = setTimeout(captureAll, 400);
      }
    });
  }
  addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(inner);
  mqReduce.addEventListener && mqReduce.addEventListener('change', (e) => { reduce = e.matches; });

  /* ════════════════════════════════════════════════════════════
     Easter eggs
     ════════════════════════════════════════════════════════════ */

  /* Toast: a small glass message at the bottom */
  const toastEl = $('.toast');
  const toastText = $('.toast-text');
  const toastBtn = $('.toast-btn');
  let toastTimer = 0;
  function toast(text, opts = {}) {
    if (!toastEl) return;
    toastText.textContent = text;
    if (opts.action) {
      toastBtn.hidden = false;
      toastBtn.textContent = opts.action.label;
      toastBtn.onclick = opts.action.run;
    } else {
      toastBtn.hidden = true;
      toastBtn.onclick = null;
    }
    // restart the spring without forcing a layout: hide, then show next frame
    toastEl.classList.remove('show');
    requestAnimationFrame(() => requestAnimationFrame(() => toastEl.classList.add('show')));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), opts.ms || 3400);
  }

  const EMAIL = 'sanumukhopadhyay123@gmail.com';
  const copyEmail = () => {
    const done = () => toast('Copied. Talk soon 👋', { ms: 2200 });
    if (navigator.clipboard) navigator.clipboard.writeText(EMAIL).then(done, () => toast(EMAIL));
    else toast(EMAIL);
  };

  /* 1. Konami code → liquid mode */
  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let konamiAt = 0;
  function toggleLiquid() {
    if (!renderer) { toast('Liquid mode needs a GPU, and this browser is running without one.'); return; }
    const on = liquid.t === 0;
    liquid.t = on ? 1 : 0;
    root.classList.toggle('liquid', on);
    toast(on ? 'Liquid mode on 🫧 The circles follow you now. Enter the code again to calm them.'
             : 'Liquid mode off. Back to business.', { ms: 4200 });
  }

  /* 2. Hold the mouse down on empty glass → gravity pulls the circles in */
  let holdTimer = 0, holdStart = null, pulledOnce = false;
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !renderer) return;
    if (e.target.closest('a, button, input, textarea, select, [data-tilt], .tile, .toast, .sheet')) return;
    holdStart = { x: e.clientX, y: e.clientY };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdStart = null;
      pull.t = 0.72;
      root.classList.add('pulling');
      const sel = getSelection && getSelection();
      if (sel) sel.removeAllRanges();
      const rip = document.createElement('div');
      rip.className = 'ripple';
      rip.style.transform = 'scale(.15)';
      rip.style.left = (useCursor ? curX.v : e.clientX) + 'px';
      rip.style.top = (useCursor ? curY.v : e.clientY) + 'px';
      document.body.appendChild(rip);
      setTimeout(() => rip.remove(), 950);
      if (!pulledOnce) { pulledOnce = true; toast('You found gravity 🌌 Let go to release it.'); }
    }, 380);
  });
  addEventListener('pointermove', (e) => {
    if (holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 6) {
      clearTimeout(holdTimer); holdStart = null; // they're selecting text, not holding
    }
  }, { passive: true });
  const release = () => {
    clearTimeout(holdTimer); holdStart = null;
    if (pull.t !== 0) { pull.t = 0; root.classList.remove('pulling'); }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  addEventListener('blur', release);

  /* 3. Keyboard: 1 to 5 jump to sections, ? opens the shortcuts sheet */
  const sheet = $('.sheet');
  let sheetReturn = null;
  function openSheet(open) {
    if (!sheet) return;
    if (open) {
      sheetReturn = document.activeElement;
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('open'));
      $('.sheet-close', sheet).focus();
    } else {
      sheet.classList.remove('open');
      setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 320);
      if (sheetReturn && sheetReturn.focus) sheetReturn.focus();
    }
  }
  if (sheet) {
    sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('.sheet-close')) openSheet(false); });
  }

  /* 4. Secret words: just type them anywhere */
  let typed = '';
  const WORDS = {
    hire: () => toast('Good call. My inbox is open: ' + EMAIL, { action: { label: 'Copy', run: copyEmail }, ms: 6000 }),
    sudo: () => toast('Nice try. This site runs on springs, not root.'),
    morvain: () => {
      $$('.avatar').forEach((a) => { a.classList.remove('spin'); void a.offsetWidth; a.classList.add('spin'); });
      toast('Hey, that\'s my username 👀');
    },
  };

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();

    // Konami
    konamiAt = k === KONAMI[konamiAt] ? konamiAt + 1 : (k === KONAMI[0] ? 1 : 0);
    if (konamiAt === KONAMI.length) { konamiAt = 0; toggleLiquid(); return; }

    if (e.key === 'Escape') {
      if (sheet && !sheet.hidden) openSheet(false);
      if (liquid.t === 1) toggleLiquid();
      return;
    }
    if (e.key === '?') { openSheet(sheet.hidden); return; }
    if (/^[1-5]$/.test(e.key) && sheet.hidden) {
      const s = sections[parseInt(e.key, 10) - 1];
      if (s) scrollToEl(s);
      return;
    }
    if (k.length === 1 && /[a-z]/.test(k)) {
      typed = (typed + k).slice(-12);
      for (const w in WORDS) if (typed.endsWith(w)) { WORDS[w](); typed = ''; break; }
    }
  });

  /* 5. The avatar says hello in the three languages I speak */
  const HELLOS = ['Hello 👋', 'नमस्ते 🙏', 'নমস্কার 🙏'];
  let helloAt = 0;
  $$('[data-hello]').forEach((img) => img.addEventListener('click', () => {
    img.classList.remove('wave'); void img.offsetWidth; img.classList.add('wave');
    toast(HELLOS[helloAt++ % HELLOS.length], { ms: 1800 });
  }));

  /* 6. Reaching the very end */
  let endShown = false;
  function reachedEnd() {
    if (endShown || !root.classList.contains('is-ready')) return;
    endShown = true;
    toast('You read the whole thing. Thank you 🙏', { action: { label: 'Copy email', run: copyEmail }, ms: 5000 });
  }

  /* 7. Switch tabs and the title notices */
  const baseTitle = document.title;
  document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? 'Come back, the code is still compiling ⏳' : baseTitle;
  });

  /* 8. A note for anyone who opens DevTools */
  try {
    console.log('%c<sanu />', 'font: 800 28px Lexend, system-ui; color: #D66FFF;');
    console.log('%cHey, curious dev 👋 This background is a WebGPU shader with a WebGL2 fallback, and every motion is a spring.\nPress ? on the page for shortcuts. Some secrets need a keyboard, one needs patience.',
      'font: 13px/1.5 system-ui; color: #aaa;');
  } catch (_) { /* console may be unavailable */ }

  /* ── Boot ───────────────────────────────────────────────── */
  async function boot() {
    const start = performance.now();
    initLoupe();
    measure();
    sizeCanvas();

    const glassPromise = (window.GlassBG ? window.GlassBG.create(canvas) : Promise.resolve(null))
      .catch((err) => { console.warn('[glass]', err); return null; });
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();

    requestAnimationFrame(frame);

    const r = await Promise.race([glassPromise, sleep(2500).then(() => undefined)]);
    if (r) {
      renderer = r;
      if (r.canvas && r.canvas !== canvas) { canvas = r.canvas; sizeCanvas(); }
      r.onlost = fallbackToCSS;
      root.dataset.gpu = r.kind;
    } else {
      fallbackToCSS();
      // If the GPU path was just slow, adopt it when it arrives.
      if (r === undefined) glassPromise.then((late) => {
        if (!late) return;
        renderer = late;
        if (late.canvas) { canvas = late.canvas; sizeCanvas(); }
        late.onlost = fallbackToCSS;
        root.classList.remove('no-gpu');
        root.dataset.gpu = late.kind;
      });
    }

    await Promise.race([fonts, sleep(1500)]);
    const wait = 700 - (performance.now() - start);
    if (wait > 0) await sleep(wait);

    measure();
    root.classList.add('is-ready');
    setTimeout(measure, 1300); // panels finished scaling in: re-read positions
    intro.t = 1;
    if (reduce) intro.snap(1);
    rectsLiveUntil = performance.now() + 1600; // panels are animating in

    // start revealing after the panels begin to arrive
    setTimeout(() => $$('.rv').forEach((el) => revealIO.observe(el)), reduce ? 0 : 260);

    // Capture the headings for the glass lens once everything has settled.
    if (gl) setTimeout(() => loadCapturer().then(captureAll), 2600); // after the hero lines have slid in

    // Fetch and decode the lazy images while idle, so nothing decodes mid-scroll.
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    setTimeout(() => idle(() => $$('img[loading="lazy"]').forEach((img) => {
      img.loading = 'eager';
      if (img.decode) img.decode().catch(() => {});
    })), 1800);
  }

  boot();
})();
