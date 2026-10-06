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

// Every filter is a GPU canvas filter. Posterize and Thermal reference SVG
// filters defined in index.html; Pixelate is a downscale-and-upscale.
export const FILTERS = [
  { name: "Grayscale", css: "grayscale(1)" },
  { name: "Sepia", css: "sepia(0.9) contrast(1.1)" },
  { name: "Invert", css: "invert(1)" },
  { name: "Night vision", css: "grayscale(1) sepia(1) hue-rotate(55deg) saturate(5) contrast(1.4)" },
  { name: "Posterize", css: "url(#f-posterize)" },
  { name: "Thermal", css: "url(#f-thermal)" },
  { name: "Pixelate", blocky: true },
  { name: "Dream", css: "blur(3px) saturate(1.8) brightness(1.15)" },
];

// An "L": index extended, the three small fingers curled.
function isCorner(h) {
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
    this.full = false;
    // One scratch buffer, sized once. Assigning canvas.width reallocates the
    // backing store and costs milliseconds, so it must not happen per frame.
    this.scratch = document.createElement("canvas");
    this.scratch.width = 256;
    this.scratch.height = 256;
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

    if (f.blocky) {
      const sw = Math.max(1, Math.round(w / 22));
      const sh = Math.max(1, Math.round(h / 22));
      this.scratchCtx.drawImage(video, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.scratch, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
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
