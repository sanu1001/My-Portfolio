# Sanu Mukherjee · Portfolio

Personal portfolio. Plain HTML, CSS and JavaScript, no build step.

**Live:** [sanu-portfolio.vercel.app](https://sanu-portfolio.vercel.app/)

---

## What changed in the rebuild (Nov 2026)

The layout, colours and personality of the original are kept: glass side panel, numbered
sections, big Lexend headings, the circle arrows, the Know More card, the blue achievements
card and the outlined marquee. What changed is how it's drawn and how it moves.

**Why the old version lagged**

- Two huge `backdrop-filter: blur()` panels sat over circles that moved on every scroll
  frame, so the browser had to re-blur most of the screen each frame.
- `ME.jpeg` was a 13.5 MB, 5568 × 3712 photo shown at about 300 px wide.
- Reveal animations transitioned `filter: blur()` on large blocks for 2 seconds.
- The cursor moved with `left` / `top` (layout) instead of `transform`.
- A forced 1.5 s loading screen.

**How it works now**

- **GPU background** (`js/glass.js`). The three circles and the glass panels are drawn by one
  fragment shader. Blurring a soft disc is just a wider soft edge, so the frosted look costs
  almost nothing. Near panel edges the shader bends the background like a rounded glass bezel,
  splits colours slightly and adds a specular rim. WebGPU first, WebGL2 if not, and a static
  CSS version if the device has no real GPU (software renderers are detected and skipped).
- **No `backdrop-filter`** on anything large. The mobile tab bar is the only blurred element.
- **One animation loop** (`js/main.js`) drives smooth scrolling, the cursor, card tilt and the
  background, so nothing fights for the frame. When nothing moves, the background drops to
  about 20 fps on its own, and render resolution adapts if a device can't keep up.
- **Springs everywhere.** Motion uses Apple-style springs (damping ratio + response). CSS
  transitions use spring curves baked into `linear()` easing; interactive bits (cursor, tilt)
  use a small spring solver so they can be interrupted mid-motion.
- **Smooth scrolling** with [Lenis](https://github.com/darkroomengineering/lenis) inside the
  right panel. Turned off when the system asks for reduced motion.
- **Images** resized and converted to WebP: about 15 MB of images became about 250 KB.
- **Fonts** are self-hosted (Lexend variable, a static Lexend 800 cut with overlaps removed for
  the outlined marquee, and Carattere).
- Respects `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`.
- Mobile gets a floating glass tab bar instead of hiding navigation.

**Mouse effects and easter eggs (Nov 2026, second pass)**

- Big headings get a liquid glass lens. Each heading is captured once into a texture with
  [html-to-image](https://github.com/bubkoo/html-to-image), and a WebGL2 glass dome shader adapted
  from [StarKnightt/liquid-glass](https://github.com/StarKnightt/liquid-glass) magnifies it, bends
  it at the rim, splits colours slightly and adds specular and rim light. It samples the texture
  with proper filtering, so edges stay smooth. Whether the lens is on is decided every frame from
  the real text boxes, so it never gets stuck.
- The right panel uses `will-change: scroll-position`. Without it, Chrome on 1x screens repaints
  the whole panel on every scroll frame, which was the cause of the stutter between sections.
- Glass surfaces light up along the edge nearest the pointer; cards and social tiles tilt,
  buttons are gently magnetic, and a glass pill follows you through the menu.
- Secrets: the Konami code, holding the mouse down on empty glass, `?` for shortcuts, `1` to `5`
  to jump between sections, typing `hire`, `sudo` or `morvain`, clicking the avatar, and
  switching browser tabs.

---

## Structure

```
Portfolio/
├── index.html
├── style.css
├── js/
│   ├── main.js            ← loop, springs, scroll, cursor, reveals
│   ├── glass.js           ← WebGPU / WebGL2 background + glass
│   └── vendor/            ← lenis.min.js, html-to-image.js
└── assets/
    ├── fonts/             ← self-hosted woff2
    ├── profile/           ← avatar, portrait, favicon (optimised)
    ├── img/               ← project screenshots (WebP)
    └── icons/             ← tech stack icons
```

`JS1.js`, `assets/ui/`, `assets/projects/` and the original photos in `assets/profile/`
(`ME.jpeg`, `me2.jpeg`, `LOGO.png`) are no longer used by the page and can be deleted.

---

## Running locally

No build step. Any static server works:

```bash
npx serve .
# or VS Code Live Server
```

Opening `index.html` directly also works.

**Debug flags:** add `?gl=webgpu`, `?gl=webgl` or `?gl=off` to the URL to force a background
renderer.

---

## Spring curves

The `--spring-*` values in `style.css` were generated with this, using Apple's damping ratio
(1 = no overshoot) and response (seconds):

```js
function curve(damping, response, eps = 0.001) {
  const w = 2 * Math.PI / response, k = w * w, c = 2 * damping * w;
  let x = 0, v = 0, t = 0, settle = 0; const dt = 1 / 2000, s = [];
  while (t < 4) { v += (-k * (x - 1) - c * v) * dt; x += v * dt; t += dt; s.push([t, x]);
    if (Math.abs(x - 1) > eps || Math.abs(v) > 0.01) settle = t; }
  const out = ['0'];
  for (let i = 1; i <= 48; i++) { const tt = settle * i / 48;
    out.push(i === 48 ? '1' : (s.find(p => p[0] >= tt) || s.at(-1))[1].toFixed(4)); }
  return { duration: Math.round(settle * 1000) + 'ms', easing: `linear(${out.join(', ')})` };
}
```

---

## Credits (all MIT)

- [Lenis](https://github.com/darkroomengineering/lenis) for smooth scrolling
- [html-to-image](https://github.com/bubkoo/html-to-image) for capturing headings into the lens
- [StarKnightt/liquid-glass](https://github.com/StarKnightt/liquid-glass) for the glass lens shader
- [Devicon](https://devicon.dev) for the Python and C++ icons

---

*Sanu Mukherjee · IIIT Kalyani · B.Tech CSE, class of 2027*
