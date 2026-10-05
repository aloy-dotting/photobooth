/* ============================================================
   FlashFX — "studio flash" grade for captured shots.
   Segments the person (MediaPipe Selfie Segmentation, runs locally),
   brightens the subject and dims/desaturates the background, with a
   feathered edge. Falls back to a radial falloff if the model is missing.
   ============================================================ */
window.FlashFX = (() => {
  'use strict';

  let seg = null;
  let ready = false;
  let pendingResolve = null;
  let loading = null;

  function init(baseUrl) {
    if (loading) return loading;
    loading = (async () => {
      if (typeof SelfieSegmentation === 'undefined') throw new Error('SelfieSegmentation script not loaded');
      seg = new SelfieSegmentation({ locateFile: (f) => baseUrl + f });
      seg.setOptions({ modelSelection: 1, selfieMode: false });
      seg.onResults((r) => { const p = pendingResolve; pendingResolve = null; if (p) p(r); });
      await seg.initialize();
      ready = true;
      // warm-up so the first real shot isn't slow
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      await new Promise((resolve) => { pendingResolve = resolve; seg.send({ image: c }).catch(() => resolve(null)); });
    })().catch((err) => { console.warn('FlashFX: segmentation unavailable, using radial fallback', err); ready = false; });
    return loading;
  }

  // Returns a small canvas holding the person mask (white = person), or null.
  async function personMask(src, mw, mh) {
    if (!ready || !seg) return null;
    const res = await new Promise((resolve) => {
      pendingResolve = resolve;
      seg.send({ image: src }).catch(() => resolve(null));
    });
    if (!res || !res.segmentationMask) return null;
    const c = document.createElement('canvas');
    c.width = mw; c.height = mh;
    const ctx = c.getContext('2d');
    ctx.drawImage(res.segmentationMask, 0, 0, mw, mh);
    return c;
  }

  // Separable box blur on a Float32 mask (feathers the person edge).
  function blurMask(m, w, h, r) {
    if (r <= 0) return m;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const k = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += m[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / k;
        const add = Math.min(w - 1, x + r + 1), sub = Math.max(0, x - r);
        acc += m[y * w + add] - m[y * w + sub];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / k;
        const add = Math.min(h - 1, y + r + 1), sub = Math.max(0, y - r);
        acc += tmp[add * w + x] - tmp[sub * w + x];
      }
    }
    return out;
  }

  function buildLut(gain, contrast, gamma) {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let x = i / 255;
      x = Math.pow(x, 1 / gamma);               // lift mids
      x = x * gain;                             // exposure
      x = 0.5 + (x - 0.5) * (1 + contrast);     // S-ish contrast
      if (x > 0.9) x = 0.9 + (x - 0.9) * 0.6;   // soft highlight roll-off
      lut[i] = Math.round(Math.min(1, Math.max(0, x)) * 255);
    }
    return lut;
  }

  /**
   * apply(srcCanvas, opts) -> Promise<canvas>
   * opts: { subjectGain, subjectContrast, subjectGamma, backgroundDim,
   *         backgroundContrast, backgroundDesat, feather, maskSize }
   */
  async function apply(src, opts = {}) {
    const o = Object.assign({
      subjectGain: 1.22, subjectContrast: 0.22, subjectGamma: 1.12,
      backgroundDim: 0.55, backgroundContrast: -0.05, backgroundDesat: 0.4,
      feather: 6, maskSize: 256,
    }, opts);

    const w = src.width, h = src.height;
    const mw = o.maskSize, mh = Math.round(o.maskSize * h / w);

    // ---- mask (small) ----
    let m = new Float32Array(mw * mh);
    const maskCanvas = await personMask(src, mw, mh);
    if (maskCanvas) {
      const d = maskCanvas.getContext('2d').getImageData(0, 0, mw, mh).data;
      let sum = 0;
      for (let i = 0; i < mw * mh; i++) { m[i] = Math.max(d[i * 4], d[i * 4 + 3]) / 255; sum += m[i]; }
      if (sum / (mw * mh) < 0.02) radial(m, mw, mh); // nobody found -> fallback
    } else {
      radial(m, mw, mh);
    }
    m = blurMask(m, mw, mh, o.feather);

    // ---- upsample mask to full res via canvas (bilinear) ----
    const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
    const mimg = mc.getContext('2d').createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) { const v = Math.round(m[i] * 255); mimg.data[i * 4] = v; mimg.data[i * 4 + 3] = 255; }
    mc.getContext('2d').putImageData(mimg, 0, 0);
    const big = document.createElement('canvas'); big.width = w; big.height = h;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(mc, 0, 0, w, h);
    const mask = bctx.getImageData(0, 0, w, h).data;

    // ---- grade ----
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const octx = out.getContext('2d');
    octx.drawImage(src, 0, 0);
    const img = octx.getImageData(0, 0, w, h);
    const p = img.data;
    const lutS = buildLut(o.subjectGain, o.subjectContrast, o.subjectGamma);
    const lutB = buildLut(o.backgroundDim, o.backgroundContrast, 1);
    const desat = o.backgroundDesat;
    for (let i = 0, j = 0; i < p.length; i += 4, j += 4) {
      const t = mask[j] / 255, u = 1 - t;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      // background branch (dim + desaturate)
      let br = lutB[r], bg = lutB[g], bb = lutB[b];
      const l = 0.299 * br + 0.587 * bg + 0.114 * bb;
      br += (l - br) * desat; bg += (l - bg) * desat; bb += (l - bb) * desat;
      p[i]     = lutS[r] * t + br * u;
      p[i + 1] = lutS[g] * t + bg * u;
      p[i + 2] = lutS[b] * t + bb * u;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  function radial(m, w, h) {
    const cx = 0.5, cy = 0.48;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x / w - cx) / 0.5, dy = (y / h - cy) / 0.6;
      const d = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(1, Math.max(0, (d - 0.45) / 0.55));
      m[y * w + x] = 1 - t * t * (3 - 2 * t);
    }
  }

  return { init, apply, get ready() { return ready; } };
})();
