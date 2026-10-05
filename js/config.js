/* ============================================================
   Pokémon Photobooth — configuration
   Edit this file to change the event name, add Pokémon or frames.
   ============================================================ */

window.BOOTH_CONFIG = {
  // Small text printed under the date on the polaroid
  eventName: 'ART RIOT',

  // Countdown (seconds) before each shot, and number of shots per session
  countdownSeconds: 5,
  shotsPerSession: 3,

  // How long (ms) the video freezes on each captured shot
  shotHoldMs: 1500,
  // How long (ms) the captured shot stays on screen before moving to the film strip
  shotPreviewMs: 1000,

  // Label on the review-screen print button; the print file is a plain 3:4 photo
  // (camera + Pokémon, no frame) added to the share alongside everything else.
  printLabel: 'Print +$8',
  printWidth: 1200,            // 3:4 -> 1200 x 1600

  // Finishing pass on captured shots only (live preview stays raw).
  flash: {
    enabled: true,
    screenFlashMs: 350,        // whole iPad screen goes white for this long BEFORE the frame is grabbed (front cameras have no real flash)
    backgroundDim: 0.85,       // background brightness multiplier, luminance only — colours stay the same room (1 = off)
    skinSmooth: 0.55,          // beauty filter strength on skin (0 = off)
    skinSmoothRadius: 0.006,   // smoothing radius, fraction of image width
    skinEdge: 18,              // detail above this contrast is kept (eyes, lips, hairline)
    skinBrighten: 1.05,        // slight lift on skin (1 = off)
    erode: 22, feather: 14, maskSize: 320,   // person-mask edge: ramp stays inside the outline, no halo
    modelPath: 'vendor/mediapipe/',
  },

  // Mirror the camera like a selfie (preview AND final photo)
  mirror: true,

  // Output sizes
  photoWidth: 1332,            // polaroid PNG/JPEG width  (frame is 444x683 -> x3)
  videoWidth: 1080,            // 9:16 video
  videoHeight: 1920,
  videoFps: 30,

  // Watermark stamp (bottom-right of the polaroid)
  stamp: {
    src: 'assets/stamp.png',
    cx: 0.77,                  // centre, as a fraction of frame width
    cy: 0.85,                  // centre, as a fraction of frame height
    width: 0.32,               // width, as a fraction of frame width
    rotateDeg: -5,
    shadow: { blur: 0.012, offsetY: 0.006, color: 'rgba(0,0,0,0.35)' }, // fractions of frame width
  },

  // Date + event text (fractions of frame width/height)
  text: {
    x: 0.075,
    dateY: 0.89,               // baseline of the big date
    dateSize: 0.125,           // font size as fraction of frame height
    dateRotateDeg: 2,          // slight tilt, right side lower
    eventY: 0.945,             // baseline of the small event name
    eventSize: 0.03,
    color: '#111111',
  },

  // Polaroid frames. `window` = where the photo sits (fractions of the frame image).
  // Measured from the transparent cut-out of the PNG.
  frames: [
    {
      id: 'classic',
      name: 'Classic',
      src: 'assets/frames/classic.png',
      aspect: 444 / 683,
      // Slightly larger than the cut-out (≈8px bleed, more at the top) so the
      // frame's soft inner edge always covers the photo — no gaps.
      window: { x: 36 / 444, y: 56 / 683, w: 371 / 444, h: 502 / 683 },
    },
  ],

  // Pokémon. `overlay` sits inside the photo window above the camera;
  // `guide` is an optional pose guide (shown on screen only, never in the output).
  pokemon: [
    {
      id: 'oshawott',
      name: 'Oshawott',
      icon: 'assets/pokemon/oshawott-icon.png',
      overlay: 'assets/pokemon/oshawott.png',
      guide: 'assets/pokemon/oshawott-guide.png',
    },
    {
      id: 'rowlet',
      name: 'Rowlet',
      icon: 'assets/pokemon/rowlet-icon.png',
      overlay: null,           // TODO: add assets/pokemon/rowlet.png
      guide: null,
    },
    {
      id: 'eevee',
      name: 'Eevee',
      icon: 'assets/pokemon/eevee-icon.png',
      overlay: null,
      guide: null,
    },
    {
      id: 'gengar',
      name: 'Gengar',
      icon: 'assets/pokemon/gengar-icon.png',
      overlay: null,
      guide: null,
    },
  ],
};
