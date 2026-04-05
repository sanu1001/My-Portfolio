# Sanu Mukherjee — Portfolio

Personal portfolio website built with vanilla HTML, CSS, and JavaScript.

**Live:** [sanu-portfolio.vercel.app](https://sanu-portfolio.vercel.app) *(update this link after Vercel deploy)*

---

## Structure

```
My-Portfolio/
├── index.html
├── style.css
├── JS1.js
└── assets/
    ├── profile/      ← profile photos, logo
    ├── projects/     ← project screenshots
    ├── icons/        ← tech stack icons
    └── ui/           ← arrows, click icon, other UI elements
```

---

## Features

- Custom cursor with context-aware hover states
- Scroll-triggered reveal animations via IntersectionObserver
- Glassmorphism panels with GPU-optimized blur (fixed layer, not scroll layer)
- Parallax background circles on scroll
- Responsive — collapses to single panel on mobile
- Zero dependencies, no frameworks

---

## Projects Showcased

| Project | Stack |
|---|---|
| KhataDost | Flutter, BLoC, Go, PostgreSQL, Hive, Docker |
| PingMate | Go, Gin, PostgreSQL, Redis, JWT, Docker |
| Finkie | HTML, CSS, JavaScript, Python |
| ShopEZ | Flutter, Dart, AI/ML, Supabase |
| Asteroid Shooter | Unity, C# |

---

## Running Locally

No build step needed. Just open `index.html` in a browser or use VS Code Live Server.

```bash
# With Live Server CLI
npx live-server .
```

---

## Deploying to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Framework preset: **Other**
4. Root directory: `/` (default)
5. Deploy — done

---

*Built by Sanu Mukherjee · IIIT Kalyani · CSE 3rd Year*