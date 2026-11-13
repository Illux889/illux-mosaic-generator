# Illux Mosaik

A landing page with a photo-mosaic generator for illux.dk. The customer picks **one main image** and
**many of their own photos**, and sees the mosaic on screen in the size they choose.

**Everything runs in the visitor's browser.** Photos are never uploaded: no backend, no database and
no tracking. Plain HTML/CSS/JavaScript with ES modules and Web Workers. **No build step, no dependencies.**

Live: **https://illux889.github.io/illux-mosaic-generator/**

## The mosaic is protected

- The customer cannot download the mosaic. Instead of download buttons there is **"Fortsæt til
  produkt"**. For now it shows a short "Produktsiden kommer snart" message. Later it will hand the
  preview to a product page in the shop, and the print file will go to an order folder.
- The on-screen mosaic carries a light, repeated **ILLUX logo** watermark (`src/assets/illux-logo-hvid.png`; strength in
  `watermark` in `src/config.js`). The print file is never shown on the page.
- Right-click, dragging and the long-press "save image" menu are blocked on the mosaic and on the
  example images. This stops visitors without developer knowledge; it cannot stop developer tools.

## Run it locally

You need [Node.js](https://nodejs.org) 20 or newer (only for the local server and the tests).

```bash
npm start
```

Open http://localhost:8080/. The local server (`scripts/serve.mjs`) sends the same security headers
as `_headers`.

"Prøv med eksempelbilleder" in the tool loads the demo photos in `demo/`.

## Tests and checks

```bash
npm test
```

```bash
npm run check
```

- `npm test`: unit tests for the print size / DPI / grid maths and the JPEG encoder.
- `npm run check`: every JS file parses, no leftovers from the old fundraiser tool, and every CSS
  selector in the generator is scoped under `.ilx-mosaic`.

## Files

| Path | What it is |
|---|---|
| `index.html`, `page.css`, `page.js` | The page: hero, before/after, ideas, the tool, questions and answers. |
| `src/` | The generator: engine (`src/engine/`), UI (`src/ui/`), texts (`src/i18n/da.js`), settings (`src/config.js`). |
| `billeder/`, `eksempler/`, `demo/` | Images on the page and the demo photos. Sources and licences in each folder's `KILDER.txt`. |
| `tools/make-examples.js` | Makes the before/after examples with the real engine (run in the browser on the local server). |
| `scripts/`, `tests/` | Local server, checks and tests. |

## Deploy

GitHub Pages from the branch `main`, folder `/ (root)`. Every push redeploys within
a minute or two; a hard refresh (Ctrl+F5) may be needed. The Content-Security-Policy is set in a
`<meta>` tag in `index.html` (GitHub Pages cannot send headers). The empty `.nojekyll` file makes
GitHub serve the files as they are.
