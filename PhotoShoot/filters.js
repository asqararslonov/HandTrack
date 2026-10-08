// Two-hand "director's frame" gesture → filtered region of the camera feed.
//
// Hold an L with both hands (thumb + index out, other fingers curled) and the
// rectangle between them is filtered. Drop your hands and the rectangle freezes
// where it was. Open it wide and it snaps to the whole screen. Make the gesture
// again to advance to the next filter.

const ENGAGE_FRAMES = 3; // debounce so a half-formed hand doesn't trigger
const RELEASE_FRAMES = 6;
const FULLSCREEN_AT = 0.82; // fraction of each axis that snaps to full frame
const LERP = 0.35;
const MAX_STAMPS = 12; // oldest drops off beyond this, to bound per-frame cost
const POSE_GRACE_FRAMES = 3; // tolerate a brief misread without freezing resize
// The CPU fallback's working resolution adapts to how many regions need it
// *this frame* (see fallbackPassWidth) instead of a single fixed number —
// full quality for the common case of one or two active filters, scaled
// down automatically only when many are stacked at once, so the 12-stamp
// worst case still can't blow the frame budget. The scratch buffer itself
// is resized to match (see ensureScratchSize) — a getImageData/putImageData
// pair costs more the larger the canvas's *allocated* size, regardless of
// how small a sub-region you actually read, so a buffer kept oversized
// "just in case" taxes every frame, including the common one-filter case.
// 1280 means "no cap" in practice — paint() below never upscales past the
// region's own size anyway (k is clamped to 1), so this only matters for
// regions wider than 1280, which can't happen. Measured cost even at this
// ceiling: ~3.7ms for 12 simultaneous fallback regions, ~2.7ms full-screen.
// See README for how much the scratch-buffer fix changed this number.
const PIXEL_PASS_MAX = 1280;
const PIXEL_PASS_MIN = 150;
const PIXEL_PASS_BUDGET = 1280;

function fallbackPassWidth(activeCount) {
  const w = PIXEL_PASS_BUDGET / Math.sqrt(Math.max(1, activeCount));
  return Math.max(PIXEL_PASS_MIN, Math.min(PIXEL_PASS_MAX, Math.round(w)));
}

// --- manual pixel equivalents, used only as a fallback (see below) ---

function grayscalePixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = l;
  }
}
function sepiaPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
    d[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
    d[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
  }
}
function invertPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
}
function nightVisionPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const c = Math.min(255, Math.max(0, (l - 100) * 1.6 + 100));
    d[i] = c * 0.1;
    d[i + 1] = c;
    d[i + 2] = c * 0.25;
  }
}
function posterizePixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (d[i] >> 6) * 85;
    d[i + 1] = (d[i + 1] >> 6) * 85;
    d[i + 2] = (d[i + 2] >> 6) * 85;
  }
}
function thermalPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    d[i] = Math.min(255, v * 520 - 40);
    d[i + 1] = Math.min(255, Math.max(0, v * 430 - 180));
    d[i + 2] = Math.min(255, Math.max(0, 255 * Math.sin(v * Math.PI)));
  }
}

// Every filter prefers a native GPU `ctx.filter` string — Posterize and
// Thermal reference SVG filters defined in index.html, the rest are plain
// CSS filter functions. `pixels` is a manual fallback used only on browsers
// that don't actually apply the native one (see detectSupport below) —
// older/some current Safari versions support `blur()` on Canvas2D but
// silently no-op on grayscale/sepia/invert/hue-rotate and on url(#svg)
// references, so `ctx.filter` can report success while drawing nothing.
export const FILTERS = [
  { name: "Grayscale", css: "grayscale(1)", pixels: grayscalePixels },
  { name: "Sepia", css: "sepia(0.9) contrast(1.1)", pixels: sepiaPixels },
  { name: "Invert", css: "invert(1)", pixels: invertPixels },
  { name: "Night vision", css: "grayscale(1) sepia(1) hue-rotate(55deg) saturate(5) contrast(1.4)", pixels: nightVisionPixels },
  { name: "Posterize", css: "url(#f-posterize)", pixels: posterizePixels },
  { name: "Thermal", css: "url(#f-thermal)", pixels: thermalPixels },
  { name: "Pixelate", blocky: true },
  { name: "Dream", css: "blur(3px) saturate(1.8) brightness(1.15)" },
];

// Draws a known, non-boundary test color through a filter string and checks
// the result actually moved — some Safari versions accept `ctx.filter`
// (plain CSS functions or a url() reference) without erroring, yet never
// apply it, drawing the source unmodified. Tested per exact string (not one
// representative filter standing in for all of them) because a browser can
// support a simple function like invert() while silently failing on a long
// compound chain like Night Vision's, or vice versa.
const PROBE_COLOR = [100, 150, 200]; // arbitrary, and not a fixed point of
// any filter in FILTERS — grayscale/sepia/invert/the SVG ramps all move it.
const supportCache = new Map();

function filterActuallyApplies(filterStr) {
  if (supportCache.has(filterStr)) return supportCache.get(filterStr);
  let ok = false;
  try {
    const src = document.createElement("canvas");
    src.width = src.height = 2;
    src.getContext("2d").fillStyle = `rgb(${PROBE_COLOR.join(",")})`;
    src.getContext("2d").fillRect(0, 0, 2, 2);

    const dst = document.createElement("canvas");
    dst.width = dst.height = 2;
    const dctx = dst.getContext("2d");
    dctx.filter = filterStr;
    dctx.drawImage(src, 0, 0);
    const [r, g, b] = dctx.getImageData(0, 0, 1, 1).data;
    const moved = Math.abs(r - PROBE_COLOR[0]) + Math.abs(g - PROBE_COLOR[1]) + Math.abs(b - PROBE_COLOR[2]);
    ok = moved > 15;
  } catch {
    ok = false;
  }
  supportCache.set(filterStr, ok);
  return ok;
}

// An "L": index extended, middle curled. Ring/pinky aren't checked — on a
// real hand they rarely curl all the way when you're making this shape, and
// they're also the fingers MediaPipe misreads most (most self-occluded), so
// requiring all three down made the gesture far stricter than intended and
// it would basically never fire in practice.
export function isCorner(h) {
  const { index, middle } = h.up;
  return index && !middle;
}

// A one-hand "finger gun" — index out, everything else curled, including
// the thumb cocked up like a hammer. Unlike isCorner this deliberately
// checks all five fingers: it only ever runs with exactly one hand in
// frame (see update()), so there's no risk of it fighting the two-hand
// framing gesture, and tightening it here makes the dismiss gesture read
// as a deliberate, distinct shape instead of firing off whatever pose your
// hand happens to be in while approaching the two-hand gesture.
export function isGunHand(h) {
  const { index, middle, ring, pinky } = h.up;
  return index && !middle && !ring && !pinky;
}

export class FilterFrame {
  constructor() {
    this.idx = -1;
    this.rect = null; // the live rectangle, smoothed, in canvas pixels
    this.target = null;
    this.stamps = []; // every rectangle laid down so far: { rect, idx }
    this.held = false;
    this.engage = 0;
    this.release = 0;
    this.poseGrace = 0;
    this.full = false;
    this.armed = { Left: false, Right: false }; // thumb-up seen while gun-posed
    this.shotAt = 0; // performance.now() of the last dismiss, for UI feedback
    // Resized on demand (see ensureScratchSize) to match each frame's
    // working resolution — once per *frame* at most, never per stamp. A
    // bare `canvas.width = …` assignment is the expensive case (measured
    // ~2.5ms) when it happens 12 times in a frame; once, it's ~0.2ms.
    this.scratch = document.createElement("canvas");
    this.scratch.width = PIXEL_PASS_MIN;
    this.scratch.height = PIXEL_PASS_MIN;
    this.scratchCtx = this.scratch.getContext("2d");
  }

  ensureScratchSize(size) {
    if (this.scratch.width === size) return;
    this.scratch.width = size;
    this.scratch.height = size;
  }

  get filter() {
    return this.idx >= 0 ? FILTERS[this.idx] : null;
  }

  clear() {
    this.rect = null;
    this.target = null;
    this.stamps.length = 0;
    this.held = false;
    this.idx = -1;
    this.armed.Left = this.armed.Right = false;
  }

  undo() {
    if (!this.stamps.length) return;
    this.stamps.pop();
    this.shotAt = performance.now();
  }

  // Bounding box of both hands' thumb and index tips. (A min/max bound
  // over more points can only match or exceed one over fewer points, so
  // including the thumb tip here can't be what makes the frame undersize
  // when you spread your hands — see update() for the actual fix.)
  cornersOf(hands, W, H) {
    const pts = [];
    for (const h of hands) pts.push(h.lm[4], h.lm[8]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H };
  }

  update(hands, W, H) {
    const framing = hands.length === 2 && hands.every(isCorner);
    const twoHands = hands.length === 2;

    if (framing) {
      this.poseGrace = POSE_GRACE_FRAMES;
      this.release = 0;
      this.engage++;
      if (this.engage >= ENGAGE_FRAMES && !this.held) {
        this.held = true;
        this.rect = null; // start a fresh rectangle; earlier ones stay put
        this.idx = (this.idx + 1) % FILTERS.length; // advance on each new frame
      }
    } else {
      this.engage = 0;
      if (this.poseGrace > 0) this.poseGrace--;
    }

    if (this.held && !framing) {
      // Releasing is keyed on the pose lapsing (you stop making the L),
      // same as the on-screen "drop your hands" instruction always meant
      // — not on a hand leaving the camera entirely. A short grace window
      // below covers the one real problem that framing-gated resizing
      // had: a single misread frame mid-stretch shouldn't freeze the
      // rectangle. Gating release on it too would mean letting go of the
      // pose keeps dragging the frame for as long as both hands stay in
      // shot, which reads as "won't stop."
      this.release++;
      if (this.release >= RELEASE_FRAMES) {
        this.held = false;
        if (this.rect && this.rect.w > 8 && this.rect.h > 8) {
          // Lay it down and leave it — frames accumulate.
          this.stamps.push({ rect: { ...this.rect }, idx: this.idx });
          if (this.stamps.length > MAX_STAMPS) this.stamps.shift();
        }
        this.rect = null;
      }
    }

    if (this.held && twoHands && (framing || this.poseGrace > 0)) {
      // Spreading your hands wider to enlarge the frame changes their
      // angle to the camera a lot, which is exactly when the per-finger
      // curl reading gets noisiest — a single misread frame mid-stretch
      // used to freeze the rectangle right there. The grace window rides
      // through that without also meaning "stop resizing" takes as long
      // as "finish the gesture" does (RELEASE_FRAMES) — it should be much
      // faster than that, see POSE_GRACE_FRAMES above.
      const r = this.cornersOf(hands, W, H);
      this.full = r.w > W * FULLSCREEN_AT && r.h > H * FULLSCREEN_AT;
      this.target = this.full ? { x: 0, y: 0, w: W, h: H } : r;
      if (!this.rect) this.rect = { ...this.target };
      for (const k of ["x", "y", "w", "h"]) {
        this.rect[k] += (this.target[k] - this.rect[k]) * LERP;
      }
    }

    // Dismiss gesture: point a finger gun with ONE hand, thumb cocked up,
    // then drop the thumb like pulling the trigger — pops the last frame
    // off, same as Undo. Only looks at this when exactly one hand is in
    // frame, so it can never be confused with the two-hand framing above.
    if (hands.length === 1) {
      const h = hands[0];
      const gun = isGunHand(h);
      const wasArmed = this.armed[h.side];
      if (gun && wasArmed && !h.up.thumb) this.undo(); // falling edge: thumb just dropped
      this.armed[h.side] = gun ? h.up.thumb : false;
    } else {
      this.armed.Left = this.armed.Right = false;
    }
  }

  render(ctx, video, W, H) {
    ctx.clearRect(0, 0, W, H);

    // Count how many regions this frame will actually need the CPU
    // fallback, so each one's working resolution can be as high as
    // possible without the total cost depending on a fixed worst case.
    let activeFallbacks = 0;
    for (const s of this.stamps) {
      const f = FILTERS[s.idx];
      if (f.pixels && !filterActuallyApplies(f.css)) activeFallbacks++;
    }
    if (this.rect && this.filter?.pixels && !filterActuallyApplies(this.filter.css)) activeFallbacks++;
    const passWidth = fallbackPassWidth(activeFallbacks);
    // Only resize for the fallback path's sake — Pixelate's own downscale
    // is tiny regardless, and skipping this when nothing needs it avoids
    // paying for a resize on frames that don't need one at all.
    if (activeFallbacks > 0) this.ensureScratchSize(passWidth);

    for (const s of this.stamps) this.paint(ctx, video, W, H, s.rect, FILTERS[s.idx], false, passWidth);
    if (this.rect && this.filter) this.paint(ctx, video, W, H, this.rect, this.filter, true, passWidth);
  }

  paint(ctx, video, W, H, r, f, live, passWidth = PIXEL_PASS_MAX) {
    if (!r || !f || r.w < 8 || r.h < 8) return;

    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const w = Math.min(W - x, Math.round(r.w));
    const h = Math.min(H - y, Math.round(r.h));
    if (w < 8 || h < 8) return;

    const nativeOk = f.css ? filterActuallyApplies(f.css) : false;

    if (f.blocky) {
      const sw = Math.max(1, Math.round(w / 22));
      const sh = Math.max(1, Math.round(h / 22));
      this.scratchCtx.drawImage(video, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.scratch, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    } else if (f.pixels && !nativeOk) {
      // CPU fallback: compute on a downscaled copy (full-res round-trips
      // are what made the old per-pixel path slow, not the pixel math) and
      // scale back up. The working size itself (passWidth) is never larger
      // than the region, so a small framed rectangle still renders at its
      // own full resolution rather than being needlessly upscaled.
      const k = Math.min(1, passWidth / w, passWidth / h);
      const sw = Math.max(1, Math.round(w * k));
      const sh = Math.max(1, Math.round(h * k));
      this.scratchCtx.drawImage(video, x, y, w, h, 0, 0, sw, sh);
      const img = this.scratchCtx.getImageData(0, 0, sw, sh);
      f.pixels(img.data);
      this.scratchCtx.putImageData(img, 0, 0);
      ctx.drawImage(this.scratch, 0, 0, sw, sh, x, y, w, h);
    } else {
      ctx.filter = f.css;
      ctx.drawImage(video, x, y, w, h, x, y, w, h);
      ctx.filter = "none";
    }

    this.drawBrackets(ctx, x, y, w, h, live);
  }

  drawBrackets(ctx, x, y, w, h, live) {
    const len = Math.min(42, w * 0.25, h * 0.25);
    ctx.strokeStyle = live ? "#ffffff" : "#fbbf24";
    ctx.lineWidth = live ? 3 : 2;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ]) {
      ctx.moveTo(cx + sx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * len);
    }
    ctx.stroke();
  }
}
