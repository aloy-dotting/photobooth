/* ============================================================
   FlashFX — finishing pass for captured shots.
   Segments the person (MediaPipe Selfie Segmentation, runs locally), applies a
   light beauty filter to skin and subtly dims the background (luminance only).
   Falls back to a radial falloff if the model is missing.
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

  // Separable min-filter: shrinks the person mask inward so the subject grade
  // never bleeds onto background pixels (that bleed is what reads as a "glow").
  function erodeMask(m, w, h, r) {
    if (r <= 0) return m;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 1;
      for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); v = Math.min(v, m[y * w + xx]); }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 1;
      for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); v = Math.min(v, tmp[yy * w + x]); }
      out[y * w + x] = v;
    }
    return out;
  }

  // Piecewise-linear tone curve -> LUT. points = [[in,out],...] in 0..255, gain scales the output.
  function curveLut(points, gain = 1) {
    const lut = new Uint8ClampedArray(256);
    const pts = [[0, 0]].concat(points).sort((a, b) => a[0] - b[0]);
    if (pts[pts.length - 1][0] < 255) pts.push([255, pts[pts.length - 1][1] + (255 - pts[pts.length - 1][0]) * 0.6]);
    let k = 0;
    for (let i = 0; i < 256; i++) {
      while (k < pts.length - 2 && i > pts[k + 1][0]) k++;
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
      const t = x1 === x0 ? 0 : (i - x0) / (x1 - x0);
      lut[i] = Math.round(Math.min(255, Math.max(0, (y0 + (y1 - y0) * t) * gain)));
    }
    return lut;
  }

  // Box blur on a Float32Array (separable), used for the local-contrast pass.
  function blurF(src, w, h, r) {
    if (r <= 0) return src;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w; let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / k;
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / k;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  // Separable min filter (shadow floor) on a Float32Array.
  function minF(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 1e9; const row = y * w;
      for (let k = -r; k <= r; k++) v = Math.min(v, src[row + Math.min(w - 1, Math.max(0, x + k))]);
      tmp[row + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 1e9;
      for (let k = -r; k <= r; k++) v = Math.min(v, tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]);
      out[y * w + x] = v;
    }
    return out;
  }

  /**
   * apply(srcCanvas, opts) -> Promise<canvas>
   * Simple, natural pipeline:
   *   1. background dim (luminance only — colour untouched, so it is still the same room)
   *   2. beauty: edge-preserving skin smoothing + slight skin lift (skin pixels only)
   */
  async function apply(src, opts = {}) {
    const o = Object.assign({
      subjectExposure: 1.04,    // tiny lift on the person
      backgroundDim: 0.80,      // 1 = no dim
      contrast: 0.06,           // tiny overall contrast
      skinSmooth: 0.55,         // 0..1 strength of skin smoothing
      skinSmoothRadius: 0.006,  // blur radius, fraction of image width
      skinEdge: 18,             // luminance difference above which detail is kept (eyes, lips, hairline)
      skinBrighten: 1.05,       // slight lift on skin
      skinWeight: 1,
      erode: 22, feather: 14, maskSize: 320,
    }, opts);

    const w = src.width, h = src.height, n = w * h;
    const mw = o.maskSize, mh = Math.round(o.maskSize * h / w);

    // ---- person mask (small -> feathered inside the outline -> full res) ----
    let m = new Float32Array(mw * mh);
    const maskCanvas = await personMask(src, mw, mh);
    if (maskCanvas) {
      const d = maskCanvas.getContext('2d').getImageData(0, 0, mw, mh).data;
      let sum = 0;
      for (let i = 0; i < mw * mh; i++) { m[i] = Math.max(d[i * 4], d[i * 4 + 3]) / 255; sum += m[i]; }
      if (sum / (mw * mh) < 0.02) radial(m, mw, mh);
    } else {
      radial(m, mw, mh);
    }
    m = erodeMask(m, mw, mh, o.erode);
    m = blurMask(m, mw, mh, o.feather);
    m = blurMask(m, mw, mh, Math.round(o.feather / 2));
    const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
    const mimg = mc.getContext('2d').createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) { const v = Math.round(m[i] * 255); mimg.data[i * 4] = v; mimg.data[i * 4 + 3] = 255; }
    mc.getContext('2d').putImageData(mimg, 0, 0);
    const big = document.createElement('canvas'); big.width = w; big.height = h;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(mc, 0, 0, w, h);
    const mask = bctx.getImageData(0, 0, w, h).data;

    // ---- pixels ----
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const octx = out.getContext('2d');
    octx.drawImage(src, 0, 0);
    const img = octx.getImageData(0, 0, w, h);
    const p = img.data;

    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), T = new Float32Array(n), S = new Float32Array(n);
    const smooth = (a, b, x) => { const v = Math.min(1, Math.max(0, (x - a) / (b - a))); return v * v * (3 - 2 * v); };
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = p[j], g = p[j + 1], b = p[j + 2];
      R[i] = r; G[i] = g; B[i] = b; T[i] = mask[j] / 255;
      // skin likeness (hue + saturation window), only inside the person
      let sw = 0;
      if (o.skinWeight > 0 && T[i] > 0.05) {
        const sum = r + g + b + 1, rn = r / sum, gn = g / sum;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx > 0 ? (mx - mn) / mx : 0;
        const hueOk = smooth(0.33, 0.38, rn) * (1 - smooth(0.52, 0.60, rn)) * smooth(0.23, 0.27, gn) * (1 - smooth(0.36, 0.40, gn)) * (r > g && g >= b * 0.92 ? 1 : 0);
        sw = o.skinWeight * hueOk * smooth(0.08, 0.18, sat) * T[i];
      }
      S[i] = sw;
    }
    const Sb = blurF(S, w, h, Math.max(2, Math.round(w * 0.012)));

    // 2. beauty: blur each channel, blend toward the blur on skin where the difference is small
    const rad = Math.max(1, Math.round(w * o.skinSmoothRadius));
    const Rb = blurF(R, w, h, rad), Gb = blurF(G, w, h, rad), Bb = blurF(B, w, h, rad);
    const edge = o.skinEdge;

    for (let i = 0, j = 0; i < n; i++, j += 4) {
      let r = R[i], g = G[i], b = B[i];
      const t = T[i], sw = Sb[i];
      if (sw > 0.01 && o.skinSmooth > 0) {
        const dl = Math.abs((0.299 * (r - Rb[i]) + 0.587 * (g - Gb[i]) + 0.114 * (b - Bb[i])));
        const keep = smooth(edge * 0.6, edge * 1.6, dl);          // 1 = real edge, keep detail
        const a = o.skinSmooth * sw * (1 - keep);
        r += (Rb[i] - r) * a; g += (Gb[i] - g) * a; b += (Bb[i] - b) * a;
      }
      // skin lift
      const k = 1 + (o.skinBrighten - 1) * sw;
      r *= k; g *= k; b *= k;
      // 1. exposure: tiny lift on the person, dim on the background — luminance only, colour ratios untouched
      const k2 = (1 + (o.subjectExposure - 1) * t) * (1 - (1 - o.backgroundDim) * (1 - t));
      r *= k2; g *= k2; b *= k2;
      // tiny overall contrast around mid-grey
      if (o.contrast) {
        const c = 1 + o.contrast;
        r = 128 + (r - 128) * c; g = 128 + (g - 128) * c; b = 128 + (b - 128) * c;
      }
      p[j] = r; p[j + 1] = g; p[j + 2] = b;
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

  return { init, apply, _debugMask: personMask, get ready() { return ready; } };
})();
