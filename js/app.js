/* ============================================================
   Pokémon Photobooth — app logic
   States: setup -> shooting -> review -> setup
   ============================================================ */
(() => {
  'use strict';

  const CFG = window.BOOTH_CONFIG;
  const $ = (sel) => document.querySelector(sel);

  // ---------- DOM ----------
  const body = document.body;
  const cam = $('#cam');
  const shotPreview = $('#shotPreview');
  const guideImg = $('#guide');
  const guideToggle = $('#guideToggle');
  const pokemonOverlay = $('#pokemonOverlay');
  const frameImg = $('#frameImg');
  const flashEl = $('#flash');
  const countdownEl = $('#countdown');
  const dateText = $('#dateText');
  const eventText = $('#eventText');
  const stampEl = $('#stamp');
  const camError = $('#camError');
  const retryCam = $('#retryCam');
  const listPokemon = $('#listPokemon');
  const listFrame = $('#listFrame');
  const startBtn = $('#startBtn');
  const review = $('#review');
  const reviewGrid = $('#reviewGrid');
  const retakeBtn = $('#retakeBtn');
  const shareBtn = $('#shareBtn');
  const printBtn = $('#printBtn');
  const doneBtn = $('#doneBtn');
  const reviewStatus = $('#reviewStatus');
  const shotCounter = $('#shotCounter');
  const stripThumbs = $('#stripThumbs');
  const photoCanvas = $('#photoCanvas');
  const videoCanvas = $('#videoCanvas');

  // ---------- State ----------
  const state = {
    pokemon: CFG.pokemon[0],
    frame: CFG.frames[0],
    guideOn: true,
    stream: null,
    shots: [],          // [{ blob, url, selected }]
    videoBlob: null,
    videoReady: true,   // false while the session video is still rendering
    renderToken: 0,
    videoExt: 'mp4',
    busy: false,
  };

  const images = {}; // loaded Image objects, keyed by src

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (images[src]) return Promise.resolve(images[src]);
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { images[src] = im; resolve(im); };
      im.onerror = () => reject(new Error('Failed to load ' + src));
      im.src = src;
    });
  }

  function todayParts() {
    const d = new Date();
    const dd = String(d.getDate());          // no zero padding: 5·10·26
    const mm = String(d.getMonth() + 1);
    const yy = String(d.getFullYear()).slice(-2);
    return [dd, mm, yy];
  }

  function fileStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // ---------- Setup UI ----------
  function renderCaption() {
    const [dd, mm, yy] = todayParts();
    dateText.innerHTML = `<span>${dd}</span><span class="dot"></span><span>${mm}</span><span class="dot"></span><span>${yy}</span>`;
    eventText.textContent = CFG.eventName;
  }

  function renderLists() {
    listPokemon.innerHTML = '';
    CFG.pokemon.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item' + (p.id === state.pokemon.id ? ' selected' : '') + (p.overlay ? '' : ' disabled');
      b.innerHTML = `<img class="icon" src="${p.icon}" alt="" /><span>${p.name}</span>${p.overlay ? '' : '<span class="sub">coming soon</span>'}`;
      b.addEventListener('click', () => selectPokemon(p));
      listPokemon.appendChild(b);
    });

    listFrame.innerHTML = '';
    CFG.frames.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item' + (f.id === state.frame.id ? ' selected' : '');
      b.innerHTML = `<img class="icon" src="${f.src}" alt="" style="image-rendering:auto" /><span>${f.name}</span>`;
      b.addEventListener('click', () => selectFrame(f));
      listFrame.appendChild(b);
    });
  }

  function selectPokemon(p) {
    state.pokemon = p;
    pokemonOverlay.src = p.overlay || '';
    guideImg.src = p.guide || '';
    applyGuide();
    renderLists();
    loadImage(p.overlay).catch(console.warn);
  }

  function selectFrame(f) {
    state.frame = f;
    frameImg.src = f.src;
    const w = f.window;
    const win = $('.pwindow');
    win.style.left = (w.x * 100) + '%';
    win.style.top = (w.y * 100) + '%';
    win.style.width = (w.w * 100) + '%';
    win.style.height = (w.h * 100) + '%';
    renderLists();
    loadImage(f.src).catch(console.warn);
  }

  function applyGuide() {
    const show = state.guideOn && !!state.pokemon.guide;
    guideImg.classList.toggle('on', show);
  }

  guideToggle.addEventListener('change', () => {
    state.guideOn = guideToggle.checked;
    applyGuide();
  });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      listPokemon.hidden = t.dataset.tab !== 'pokemon';
      listFrame.hidden = t.dataset.tab !== 'frame';
    });
  });

  // ---------- Camera ----------
  async function startCamera() {
    camError.hidden = true;
    if (state.stream) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      state.stream = stream;
      cam.srcObject = stream;
      await cam.play().catch(() => {});
    } catch (err) {
      console.error('Camera error', err);
      camError.hidden = false;
    }
  }
  retryCam.addEventListener('click', startCamera);

  // ---------- Rendering (shared by photo + video) ----------
  // Draw `src` (video or image) to cover rect (x,y,w,h), optionally mirrored.
  function drawCover(ctx, src, x, y, w, h, mirror, align = 'center') {
    const sw = src.videoWidth || src.naturalWidth || src.width;
    const sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return;
    const scale = Math.max(w / sw, h / sh);
    const dw = sw * scale, dh = sh * scale;
    const dx = x + (w - dw) / 2;
    const dy = align === 'bottom' ? y + (h - dh) : y + (h - dh) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (mirror) {
      ctx.translate(x + w, 0); ctx.scale(-1, 1);
      ctx.drawImage(src, dx - x, dy, dw, dh);
    } else {
      ctx.drawImage(src, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  // Draw the complete polaroid (photo content + pokemon + frame + text + stamp)
  // at (fx, fy) with frame width fw. `content` is a video element or an image.
  // `contentMirrored` = true when drawing live video (needs mirroring);
  // false when drawing an already-rendered photo.
  function drawPolaroid(ctx, fx, fy, fw, content, contentMirrored, flashAlpha = 0) {
    const frame = images[state.frame.src];
    const fh = fw / state.frame.aspect;
    const w = state.frame.window;
    const wx = fx + w.x * fw, wy = fy + w.y * fh, ww = w.w * fw, wh = w.h * fh;

    // photo window background
    ctx.fillStyle = '#b9c0c6';
    ctx.fillRect(wx, wy, ww, wh);
    if (content) drawCover(ctx, content, wx, wy, ww, wh, contentMirrored && CFG.mirror);

    // pokemon overlay
    const pk = state.pokemon.overlay && images[state.pokemon.overlay];
    if (pk) drawCover(ctx, pk, wx, wy, ww, wh, false, 'bottom');

    // flash (video only): whites out the whole window, under the frame
    if (flashAlpha > 0) { ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`; ctx.fillRect(wx, wy, ww, wh); }

    // frame
    if (frame) ctx.drawImage(frame, fx, fy, fw, fh);

    // caption
    const t = CFG.text;
    ctx.fillStyle = t.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const dateSize = t.dateSize * fh;
    ctx.font = `${dateSize}px SmoothMarker`;
    const [dd, mm, yy] = todayParts();
    ctx.save();
    ctx.translate(fx + t.x * fw, fy + t.dateY * fh);
    ctx.rotate(((t.dateRotateDeg || 0) * Math.PI) / 180);
    let x = 0;
    const dotR = dateSize * 0.06;
    const gap = dateSize * 0.04;
    [dd, mm, yy].forEach((part, i) => {
      ctx.fillText(part, x, 0);
      x += ctx.measureText(part).width;
      if (i < 2) {
        x += gap + dotR;
        ctx.beginPath(); ctx.arc(x, -dateSize * 0.33, dotR, 0, Math.PI * 2); ctx.fill();
        x += dotR + gap;
      }
    });
    ctx.restore();
    ctx.font = `${t.eventSize * fh}px SmoothMarker`;
    ctx.save();
    // letter-spacing substitute: draw char by char
    let ex = fx + t.x * fw;
    const ey = fy + t.eventY * fh;
    const ls = t.eventSize * fh * 0.08;
    for (const ch of CFG.eventName) {
      ctx.fillText(ch, ex, ey);
      ex += ctx.measureText(ch).width + ls;
    }
    ctx.restore();

    // stamp
    const st = images[CFG.stamp.src];
    if (st) {
      const sw = CFG.stamp.width * fw;
      const sh = sw * (st.naturalHeight / st.naturalWidth);
      ctx.save();
      ctx.translate(fx + CFG.stamp.cx * fw, fy + CFG.stamp.cy * fh);
      ctx.rotate((CFG.stamp.rotateDeg * Math.PI) / 180);
      if (CFG.stamp.shadow) {
        ctx.shadowColor = CFG.stamp.shadow.color;
        ctx.shadowBlur = CFG.stamp.shadow.blur * fw;
        ctx.shadowOffsetY = CFG.stamp.shadow.offsetY * fw;
      }
      ctx.drawImage(st, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
  }

  // Render a full-resolution polaroid photo from the current camera frame.
  function renderPhoto(photo) {
    const fw = CFG.photoWidth;
    const fh = Math.round(fw / state.frame.aspect);
    photoCanvas.width = fw; photoCanvas.height = fh;
    const ctx = photoCanvas.getContext('2d');
    ctx.clearRect(0, 0, fw, fh); // transparent outside the frame -> usable as an IG sticker
    drawPolaroid(ctx, 0, 0, fw, photo, false);
    return new Promise((resolve, reject) => {
      try {
        photoCanvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png');
      } catch (err) {
        reject(err);
      }
    });
  }

  // Raw 3:4 camera crop (mirrored) as a canvas — the single source for all outputs.
  function captureRaw() {
    const pw = CFG.printWidth || 1200;
    const ph = Math.round(pw * 4 / 3);
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#b9c0c6';
    ctx.fillRect(0, 0, pw, ph);
    drawCover(ctx, cam, 0, 0, pw, ph, CFG.mirror);
    return c;
  }

  // Flash grade (subject brighter, background dimmer). Returns the same canvas on failure.
  async function gradeShot(raw) {
    if (!CFG.flash || !CFG.flash.enabled) return raw;
    try {
      return await FlashFX.apply(raw, CFG.flash);
    } catch (err) {
      console.warn('Flash grade failed, using raw', err);
      return raw;
    }
  }

  // Plain 3:4 photo for printing: graded photo + Pokémon, no frame/text/stamp.
  function renderPrintPhoto(photo) {
    const pw = photo.width, ph = photo.height;
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const ctx = c.getContext('2d');
    ctx.drawImage(photo, 0, 0);
    const pk = state.pokemon.overlay && images[state.pokemon.overlay];
    if (pk) drawCover(ctx, pk, 0, 0, pw, ph, false, 'bottom');
    return new Promise((resolve, reject) => {
      try {
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/jpeg', 0.95);
      } catch (err) { reject(err); }
    });
  }

  // A still of just the camera crop (mirrored, 3:4 window) for the on-screen preview.
  // The Pokémon overlay stays layered above it in the DOM, so it is not baked in here.
  function renderWindowStill(photo) {
    const w = state.frame.window;
    const fw = CFG.photoWidth;
    const fh = fw / state.frame.aspect;
    const ww = Math.round(w.w * fw), wh = Math.round(w.h * fh);
    const c = document.createElement('canvas');
    c.width = ww; c.height = wh;
    const ctx = c.getContext('2d');
    drawCover(ctx, photo, 0, 0, ww, wh, false);
    return c.toDataURL('image/jpeg', 0.85);
  }

  // ---------- Video: capture frames during the shoot, render sped-up afterwards ----------
  function pickMime() {
    const cands = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const c of cands) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  // Grabs small JPEG frames of the camera (mirrored 3:4) at a steady rate, plus markers for each shot.
  function createFrameCapture() {
    const fps = CFG.video.captureFps || 15;
    const cw = CFG.video.captureWidth || 360, ch = Math.round(cw * 4 / 3);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    const cap = { frames: [], shots: [], t0: 0, timer: 0, busy: false };

    function grab() {
      if (cap.busy || !cam.videoWidth) return;
      cap.busy = true;
      const t = performance.now() - cap.t0;
      drawCover(ctx, cam, 0, 0, cw, ch, CFG.mirror);
      c.toBlob((blob) => { if (blob) cap.frames.push({ t, blob }); cap.busy = false; }, 'image/jpeg', 0.8);
    }
    cap.start = () => { cap.t0 = performance.now(); cap.frames = []; cap.shots = []; cap.timer = setInterval(grab, 1000 / fps); grab(); };
    cap.markShot = (photo) => { cap.shots.push({ t: performance.now() - cap.t0, photo }); };
    cap.stop = () => { clearInterval(cap.timer); };
    return cap;
  }

  // Renders the session to a video: frames play back at `speed`, and at each shot the video
  // flashes white and freezes on the finished shot for `shotHoldMs`. Runs in the background.
  async function renderSessionVideo(cap, onDone) {
    const mime = pickMime();
    if (!mime || !cap.frames.length) { onDone(null); return; }

    const vw = CFG.videoWidth, vh = CFG.videoHeight;
    videoCanvas.width = vw; videoCanvas.height = vh;
    const ctx = videoCanvas.getContext('2d');
    const fw = Math.round(vw * 0.72);
    const fh = Math.round(fw / state.frame.aspect);
    const fx = Math.round((vw - fw) / 2);
    const fy = Math.round((vh - fh) / 2);

    const speed = CFG.video.speed || 1.75;
    const hold = CFG.shotHoldMs || 1500;
    const flashMs = CFG.video.flashMs || 320;
    const frames = cap.frames;
    const shots = cap.shots;

    // decode with a small look-ahead so memory stays low
    const bitmaps = new Map();
    async function bitmapAt(idx) {
      for (let k = idx; k < Math.min(frames.length, idx + 8); k++) {
        if (!bitmaps.has(k)) bitmaps.set(k, createImageBitmap(frames[k].blob).catch(() => null));
      }
      const bm = await bitmaps.get(idx);
      for (const k of bitmaps.keys()) if (k < idx - 2) { bitmaps.get(k).then((b) => b && b.close && b.close()); bitmaps.delete(k); }
      return bm;
    }

    // timeline: [ {type:'play', from, to}, {type:'shot', photo} ... ] in SOURCE time (ms)
    const segs = [];
    let cursor = 0;
    shots.forEach((sh) => { segs.push({ type: 'play', from: cursor, to: sh.t }); segs.push({ type: 'shot', photo: sh.photo }); cursor = sh.t; });
    if (frames[frames.length - 1].t > cursor + 200) segs.push({ type: 'play', from: cursor, to: frames[frames.length - 1].t });

    let frameIdx = 0;
    const frameAt = (t) => { while (frameIdx < frames.length - 1 && frames[frameIdx + 1].t <= t) frameIdx++; return frameIdx; };

    // paint the first frame before recording starts (no black lead-in)
    const first = await bitmapAt(0);
    // flash is drawn only inside the photo window: white fills the same (bleed) rect the photo
    // fills, UNDER the frame/Pokémon/caption, so it reaches the frame edge with no gap
    const paint = (content, flashAlpha) => {
      ctx.fillStyle = '#e9ebee'; ctx.fillRect(0, 0, vw, vh);
      drawPolaroid(ctx, fx, fy, fw, content, false, flashAlpha);
    };
    paint(first, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const chunks = [];
    let recorder;
    try {
      const stream = videoCanvas.captureStream(CFG.videoFps);
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start(500);
    } catch (err) { console.warn('Recording unavailable', err); onDone(null); return; }

    const token = ++state.renderToken;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    let last = first;

    for (const seg of segs) {
      if (state.renderToken !== token) break;        // cancelled (retake / done)
      if (seg.type === 'play') {
        const start = performance.now();
        const dur = (seg.to - seg.from) / speed;
        while (true) {
          const el = performance.now() - start;
          if (el >= dur) break;
          const srcT = seg.from + el * speed;
          const bm = await bitmapAt(frameAt(srcT));
          if (bm) last = bm;
          paint(last, 0);
          await raf();
          if (state.renderToken !== token) break;
        }
      } else {
        // flash, then freeze on the shot
        const start = performance.now();
        while (true) {
          const el = performance.now() - start;
          if (el >= flashMs + hold) break;
          const a = el < flashMs * 0.4 ? 1 : Math.max(0, 1 - (el - flashMs * 0.4) / (flashMs * 0.6));
          paint(seg.photo, a);
          await raf();
          if (state.renderToken !== token) break;
        }
        last = seg.photo;
      }
    }
    // small tail so the last frame lands
    for (let i = 0; i < 6; i++) { paint(last, 0); await raf(); }

    for (const v of bitmaps.values()) v.then((b) => b && b.close && b.close());
    recorder.onstop = () => onDone(state.renderToken === token ? new Blob(chunks, { type: recorder.mimeType || mime }) : null);
    try { recorder.stop(); } catch { onDone(null); }
  }

  // ---------- Film strip (shooting screen) ----------
  function buildStrip() {
    stripThumbs.innerHTML = '';
    const w = state.frame.window;
    for (let i = 0; i < CFG.shotsPerSession; i++) {
      const t = document.createElement('div');
      t.className = 'thumb';
      t.innerHTML = `<div class="thumb-win" style="left:${w.x * 100}%;top:${w.y * 100}%;width:${w.w * 100}%;height:${w.h * 100}%"></div>` +
        `<img class="thumb-frame" src="${state.frame.src}" alt="" /><img class="thumb-shot" alt="" />`;
      stripThumbs.appendChild(t);
    }
    setCounter(1);
  }
  function setCounter(n) {
    shotCounter.textContent = `${Math.min(n, CFG.shotsPerSession)}/${CFG.shotsPerSession}`;
  }
  function fillThumb(i, url) {
    const t = stripThumbs.children[i];
    if (!t) return;
    t.querySelector('.thumb-shot').src = url;
    t.classList.add('filled');
  }

  // ---------- Screen transition (setup <-> shooting) ----------
  // FLIP: measure the polaroid before/after the layout change and animate the difference,
  // so it glides from the landing position to the centre instead of jumping.
  const polaroidEl = $('#polaroid');
  const panelCol = $('.panel-col');
  const guideRowEl = $('#guideRow');
  async function transitionTo(next) {
    const first = polaroidEl.getBoundingClientRect();
    if (next === 'shooting') {
      // slide the right-hand panel away first (fast)
      const a = panelCol.animate(
        [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(48px)' }],
        { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }
      );
      guideRowEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
      await a.finished.catch(() => {});
    }
    body.dataset.state = next;
    panelCol.getAnimations().forEach((an) => an.cancel());
    guideRowEl.getAnimations().forEach((an) => an.cancel());
    const last = polaroidEl.getBoundingClientRect();
    const dx = first.left - last.left, dy = first.top - last.top;
    const sx = first.width / last.width;
    polaroidEl.style.transformOrigin = 'top left';
    const move = polaroidEl.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sx})` }, { transform: 'none' }],
      { duration: 360, easing: 'cubic-bezier(.22,.9,.3,1)' }
    );
    await move.finished.catch(() => {});
    polaroidEl.style.transformOrigin = '';
  }

  // ---------- Shooting sequence ----------
  async function countdown(n) {
    for (let i = n; i > 0; i--) {
      countdownEl.textContent = String(i);
      countdownEl.classList.remove('tick');
      void countdownEl.offsetWidth; // restart animation
      countdownEl.classList.add('tick');
      await sleep(1000);
    }
    countdownEl.classList.remove('tick');
    countdownEl.textContent = '';
  }

  function flash() {
    flashEl.classList.remove('go');
    void flashEl.offsetWidth;
    flashEl.classList.add('go');
  }

  async function startShooting() {
    if (state.busy) return;
    if (!state.stream) { await startCamera(); if (!state.stream) return; }
    state.busy = true;

    // reset previous session
    state.shots.forEach((s) => URL.revokeObjectURL(s.url));
    state.shots = [];
    state.videoBlob = null;

    // make sure render assets are ready
    await Promise.all([
      loadImage(state.frame.src),
      loadImage(state.pokemon.overlay),
      loadImage(CFG.stamp.src),
      document.fonts.load(`100px SmoothMarker`),
      document.fonts.load('40px Pixellari'),
    ]).catch(console.warn);

    buildStrip();
    await transitionTo('shooting');
    await sleep(120);

    const cap = createFrameCapture();
    cap.start();
    await sleep(250);

    try {
    for (let i = 0; i < CFG.shotsPerSession; i++) {
      setCounter(i + 1);
      await countdown(CFG.countdownSeconds);

      // capture
      // screen flash: light the face with the whole display, then grab the frame while it's lit
      const holdMs = (CFG.flash && CFG.flash.screenFlashMs) || 0;
      flashEl.classList.add('hold');
      if (holdMs) await sleep(holdMs);
      const raw = captureRaw();
      flashEl.classList.remove('hold');
      flash();                             // fade the white out
      const photo = await gradeShot(raw);  // beauty + background dim (≈0.1–0.3 s)
      const stillUrl = renderWindowStill(photo);
      const printBlob = await renderPrintPhoto(photo);
      const blob = await renderPhoto(photo);
      const url = URL.createObjectURL(blob);
      const img = await loadImage(url);
      state.shots.push({ blob, printBlob, url, selected: true });

      cap.markShot(photo);                 // the video freezes on this 3:4 photo at this moment
      shotPreview.src = stillUrl;
      shotPreview.classList.add('show');
      const screenHold = CFG.shotPreviewMs ?? 1000;
      await sleep(screenHold);
      // hand the shot to the film strip and resume the live view
      shotPreview.classList.remove('show');
      fillThumb(i, url);
      await sleep(400);
    }
    } catch (err) {
      console.error('Shooting failed', err);
      cap.stop();
      shotPreview.classList.remove('show');
      countdownEl.textContent = '';
      body.dataset.state = 'setup';
      state.busy = false;
      const tainted = err && (err.name === 'SecurityError' || /tainted|insecure/i.test(err.message || ''));
      showNotice(tainted && location.protocol === 'file:'
        ? 'Chrome blocks photo capture when the page is opened as a file. Run it from a local server (double-click serve.bat / serve.sh) or GitHub Pages.'
        : 'Could not capture the photo: ' + (err && err.message ? err.message : err));
      return;
    }

    await sleep(300);
    cap.stop();

    // show the review right away; the sped-up video renders in the background
    state.videoBlob = null;
    state.videoReady = false;
    showReview();
    state.busy = false;
    renderSessionVideo(cap, (blob) => {
      state.videoBlob = blob;
      state.videoExt = blob && blob.type.includes('webm') ? 'webm' : 'mp4';
      state.videoReady = true;
      if (body.dataset.state === 'review') {
        reviewStatus.textContent = blob ? '' : 'Video is not supported on this browser; photos only.';
        updateShareBtn();
      }
    });
  }

  // ---------- Notices ----------
  const noticeEl = document.createElement('div');
  noticeEl.className = 'notice';
  noticeEl.hidden = true;
  document.body.appendChild(noticeEl);
  let noticeTimer = 0;
  function showNotice(msg, sticky = false) {
    noticeEl.textContent = msg;
    noticeEl.hidden = false;
    clearTimeout(noticeTimer);
    if (!sticky) noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, 8000);
  }
  noticeEl.addEventListener('click', () => { noticeEl.hidden = true; });
  startBtn.addEventListener('click', startShooting);

  // ---------- Review ----------
  function showReview() {
    body.dataset.state = 'review';
    review.hidden = false;
    review.classList.remove('shared');
    reviewStatus.textContent = state.videoReady ? '' : 'Preparing your video…';
    reviewGrid.innerHTML = '';
    state.shots.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'review-shot selected';
      d.innerHTML = `<img src="${s.url}" alt="Shot ${i + 1}" />`;
      d.addEventListener('click', () => {
        s.selected = !s.selected;
        d.classList.toggle('selected', s.selected);
        updateShareBtn();
      });
      reviewGrid.appendChild(d);
    });
    updateShareBtn();
  }

  function updateShareBtn() {
    const none = !state.shots.some((s) => s.selected) || !state.videoReady;
    shareBtn.disabled = none;
    printBtn.disabled = none;
  }

  function backToSetup() {
    state.renderToken++;      // cancels any video still rendering
    state.videoReady = true;
    review.hidden = true;
    body.dataset.state = 'setup';
    shotPreview.classList.remove('show');
    shotPreview.removeAttribute('src');
  }

  retakeBtn.addEventListener('click', () => {
    backToSetup();
    setTimeout(startShooting, 400);
  });
  doneBtn.addEventListener('click', backToSetup);

  async function share(withPrint = false) {
    const stamp = fileStamp();
    const files = [];
    state.shots.forEach((s, i) => {
      if (s.selected) files.push(new File([s.blob], `photobooth-${stamp}-${i + 1}.png`, { type: 'image/png' }));
    });
    if (withPrint) {
      state.shots.forEach((s, i) => {
        if (s.selected && s.printBlob) files.push(new File([s.printBlob], `print-${stamp}-${i + 1}.jpg`, { type: 'image/jpeg' }));
      });
    }
    if (state.videoBlob) {
      files.push(new File([state.videoBlob], `photobooth-${stamp}.${state.videoExt}`, { type: state.videoBlob.type || 'video/mp4' }));
    }
    if (!files.length) return;

    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: 'Pokémon Photobooth' });
        reviewStatus.textContent = 'Shared! Tap Done to start a new session.';
        review.classList.add('shared');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') { reviewStatus.textContent = 'Share cancelled.'; return; }
        console.warn('share failed', err);
      }
    }
    // Fallback: download each file
    files.forEach((f) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    });
    reviewStatus.textContent = 'Sharing is not available here — files downloaded instead.';
    review.classList.add('shared');
  }
  shareBtn.addEventListener('click', () => share(false));
  printBtn.addEventListener('click', () => share(true));

  window.__booth = state; // handy for debugging in Safari's Web Inspector

  // ---------- Init ----------
  async function init() {
    body.classList.toggle('mirror', !!CFG.mirror);
    document.documentElement.style.setProperty('--date-rot', (CFG.text.dateRotateDeg || 0) + 'deg');
    renderCaption();
    $('#printLabel').textContent = CFG.printLabel || 'Print';
    selectFrame(state.frame);
    selectPokemon(state.pokemon);
    loadImage(CFG.stamp.src).catch(console.warn);
    document.fonts.load('100px SmoothMarker').catch(() => {});
    startCamera();
    if (CFG.flash && CFG.flash.enabled && window.FlashFX) FlashFX.init(CFG.flash.modelPath);

    if (location.protocol === 'file:') {
      showNotice('Opened as a file: the camera preview works but Chrome will block saving photos. Run serve.bat (Windows) or serve.sh (Mac) in this folder, then open http://localhost:8000', true);
    }

    // refresh the date if the booth is left open overnight
    setInterval(renderCaption, 60 * 1000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  init();
})();
