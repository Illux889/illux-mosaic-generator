/**
 * Illux Mosaik — synthetic test images for manual/browser QA (no real photos needed).
 * Use from the browser console on the local server (http://localhost:8080/):
 *   const m = await import('/tests/browser/fixtures.js');
 *   await m.loadDemo(window.illuxMosaic, { sources: 120 });
 */
function canvasFile(canvas, name, type = 'image/jpeg', quality = .9) {
  return new Promise(resolve => canvas.toBlob(blob => resolve(new File([blob], name, { type, lastModified: Date.now() })), type, quality));
}

/** A portrait test motif: dark background, light circle, coloured diagonal band and a frame. */
export async function makeTarget(width = 900, height = 1260) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#1d2b3a'); bg.addColorStop(1, '#5B5544');
  g.fillStyle = bg; g.fillRect(0, 0, width, height);
  g.fillStyle = '#f2efe6'; g.beginPath(); g.arc(width / 2, height * .42, width * .3, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c0392b'; g.save(); g.translate(width / 2, height * .72); g.rotate(-.35); g.fillRect(-width, -40, width * 2, 80); g.restore();
  g.strokeStyle = '#e8c547'; g.lineWidth = 24; g.strokeRect(30, 30, width - 60, height - 60);
  return canvasFile(c, 'testmotiv.jpg');
}

/** Varied "photos": random gradients, blobs and some with a white or transparent border. */
export async function makeSources(count = 120, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const files = [];
  for (let i = 0; i < count; i++) {
    const portrait = rnd() > .5, w = portrait ? 480 : 640, h = portrait ? 640 : 480;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const hue = Math.floor(rnd() * 360), light = 15 + rnd() * 70;
    const grad = g.createLinearGradient(0, 0, w * rnd(), h);
    grad.addColorStop(0, `hsl(${hue} ${30 + rnd() * 60}% ${light}%)`);
    grad.addColorStop(1, `hsl(${(hue + 40 + rnd() * 80) % 360} ${30 + rnd() * 60}% ${Math.min(95, light + rnd() * 40)}%)`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = `hsla(${Math.floor(rnd() * 360)} 70% ${20 + rnd() * 70}% / .7)`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 120, 0, Math.PI * 2); g.fill();
    }
    let type = 'image/jpeg';
    if (i % 17 === 0) { // product-shot style: object on white
      const d = document.createElement('canvas'); d.width = w; d.height = h;
      const dg = d.getContext('2d'); dg.fillStyle = '#fff'; dg.fillRect(0, 0, w, h); dg.drawImage(c, w * .2, h * .2, w * .6, h * .6);
      files.push(await canvasFile(d, `produkt-${i}.jpg`)); continue;
    }
    if (i % 23 === 0) { // transparent PNG
      const d = document.createElement('canvas'); d.width = w; d.height = h;
      d.getContext('2d').drawImage(c, w * .15, h * .15, w * .7, h * .7);
      files.push(await canvasFile(d, `logo-${i}.png`, 'image/png')); continue;
    }
    files.push(await canvasFile(c, `foto-${String(i).padStart(3, '0')}.jpg`, type));
  }
  return files;
}

/** Problem files: too small, not an image, a duplicate. */
export async function makeProblemFiles(sources) {
  const tiny = document.createElement('canvas'); tiny.width = 40; tiny.height = 30;
  tiny.getContext('2d').fillRect(0, 0, 40, 30);
  return [
    await canvasFile(tiny, 'for-lille.jpg'),
    new File(['not an image'], 'tekst.jpg', { type: 'image/jpeg' }),
    new File([await sources[1].arrayBuffer()], 'kopi-af-foto.jpg', { type: 'image/jpeg' })
  ];
}

export async function loadDemo(app, { sources = 120 } = {}) {
  await app.setTarget(await makeTarget());
  const files = await makeSources(sources);
  await app.addSources(files);
  return files;
}
