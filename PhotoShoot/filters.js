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
const PIXEL_PASS_W = 240; // width a CPU-fallback filter is computed at

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

export class FilterFrame {
  constructor() {
    this.idx = -1;
    this.rect = null; // the live rectangle, smoothed, in canvas pixels
    this.target = null;
    this.stamps = []; // every rectangle laid down so far: { rect, idx }
    this.held = false;
    this.engage = 0;
    this.release = 0;
    this.full = false;
    // One scratch buffer, sized once. Assigning canvas.width reallocates the
    // backing store and costs milliseconds, so it must not happen per frame.
    this.scratch = document.createElement("canvas");
    this.scratch.width = 384;
    this.scratch.height = 384;
    this.scratchCtx = this.scratch.getContext("2d");
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
  }

  undo() {
    this.stamps.pop();
  }

  // Bounding box of both hands' thumb and index tips.
  cornersOf(hands, W, H) {
    const pts = [];
    for (const h of hands) {
      pts.push(h.lm[4], h.lm[8]);
    }
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

    if (framing) {
      this.release = 0;
      this.engage++;
      if (this.engage >= ENGAGE_FRAMES && !this.held) {
        this.held = true;
        this.rect = null; // start a fresh rectangle; earlier ones stay put
        this.idx = (this.idx + 1) % FILTERS.length; // advance on each new frame
      }
    } else {
      this.engage = 0;
      if (this.held) {
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
    }

    if (this.held && framing) {
      const r = this.cornersOf(hands, W, H);
      this.full = r.w > W * FULLSCREEN_AT && r.h > H * FULLSCREEN_AT;
      this.target = this.full ? { x: 0, y: 0, w: W, h: H } : r;
      if (!this.rect) this.rect = { ...this.target };
      for (const k of ["x", "y", "w", "h"]) {
        this.rect[k] += (this.target[k] - this.rect[k]) * LERP;
      }
    }
    // Held-but-not-framing is the release countdown: leave the rectangle alone
    // so it lands where it was framed, not where the hands trailed off to.
  }

  render(ctx, video, W, H) {
    ctx.clearRect(0, 0, W, H);
    for (const s of this.stamps) this.paint(ctx, video, W, H, s.rect, FILTERS[s.idx], false);
    if (this.rect && this.filter) this.paint(ctx, video, W, H, this.rect, this.filter, true);
  }

  paint(ctx, video, W, H, r, f, live) {
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
      // scale back up.
      const k = Math.min(1, PIXEL_PASS_W / w, PIXEL_PASS_W / h);
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
