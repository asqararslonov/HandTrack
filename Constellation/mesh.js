// Renders hands as a live network: every joint is a node, fingertips wire
// together into a mesh, and raised fingers close into a filled polygon.
// When two hands are visible, matching raised fingers bridge across them.

export const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
export const TIP_COLORS = {
  thumb: "#f87171",
  index: "#fbbf24",
  middle: "#4ade80",
  ring: "#60a5fa",
  pinky: "#c084fc",
};
const FINGER_NAMES = Object.keys(TIP);

// Hue per raised-finger count, used for the shape fill.
const SHAPE_HUE = { 1: 48, 2: 190, 3: 150, 4: 40, 5: 280 };
export const SHAPE_NAMES = { 0: "", 1: "Point", 2: "Line", 3: "Triangle", 4: "Quad", 5: "Pentagon" };

const TRAIL_LEN = 16;
const LINK_DIST_FACTOR = 1.6; // palms closer than this * hand size => "linked"

const hex2rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, a) => `rgba(${hex2rgb(hex).join(",")},${a})`;

export class Constellation {
  constructor() {
    this.trails = new Map(); // "side-finger" -> [{x,y}, ...]
    this.prev = new Map(); // side -> Float32Array of prior canvas-space landmarks
    this.t0 = performance.now();
  }

  reset() {
    this.trails.clear();
    this.prev.clear();
  }

  // hands: [{ lm, up, side }] — lm is 21 normalized landmarks, up is the
  // finger-extended map, side is "Left" | "Right".
  render(ctx, hands, W, H) {
    const t = performance.now() - this.t0;
    const bySide = new Set(hands.map((h) => h.side));
    for (const key of [...this.trails.keys()]) {
      const [side] = key.split("-");
      if (!bySide.has(side)) this.decay(key);
    }

    const shapes = [];
    const projected = hands.map((h) => this.project(h, W, H));

    for (const h of projected) {
      this.drawSkeleton(ctx, h);
      this.drawTipMesh(ctx, h);
      const shape = this.drawShape(ctx, h);
      if (shape) shapes.push(shape);
      this.drawNodes(ctx, h, t);
      this.prev.set(h.side, h.pts);
    }

    let linked = false;
    if (projected.length === 2) {
      linked = this.drawBridges(ctx, projected[0], projected[1], t);
    }

    return { shapes, linked };
  }

  // Normalized landmarks → canvas pixels, plus per-point velocity from the
  // previous frame (used to make fast-moving joints glow larger).
  project(h, W, H) {
    const pts = new Float32Array(21 * 2);
    for (let i = 0; i < 21; i++) {
      pts[i * 2] = h.lm[i].x * W;
      pts[i * 2 + 1] = h.lm[i].y * H;
    }
    const prev = this.prev.get(h.side);
    const speed = new Float32Array(21);
    for (let i = 0; i < 21; i++) {
      if (!prev) continue;
      const dx = pts[i * 2] - prev[i * 2];
      const dy = pts[i * 2 + 1] - prev[i * 2 + 1];
      speed[i] = Math.hypot(dx, dy);
    }
    const size = Math.hypot(pts[0] - pts[9 * 2], pts[1] - pts[9 * 2 + 1]);
    return { ...h, pts, speed, size };
  }

  pt(h, i) {
    return { x: h.pts[i * 2], y: h.pts[i * 2 + 1] };
  }

  drawSkeleton(ctx, h) {
    ctx.strokeStyle = "#ffffff22";
    ctx.lineWidth = 1.5;
    for (const [a, b] of BONES) {
      const p = this.pt(h, a), q = this.pt(h, b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
  }

  // Every fingertip wired to every other — a small neural-net look. Nearer
  // pairs glow brighter so the mesh tightens as fingers come together.
  drawTipMesh(ctx, h) {
    const tips = FINGER_NAMES.map((name) => ({ name, p: this.pt(h, TIP[name]) }));
    const maxDist = h.size * 2.4;
    for (let i = 0; i < tips.length; i++) {
      for (let j = i + 1; j < tips.length; j++) {
        const a = tips[i], b = tips[j];
        const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
        const k = Math.max(0, 1 - d / maxDist);
        if (k < 0.04) continue;
        const grad = ctx.createLinearGradient(a.p.x, a.p.y, b.p.x, b.p.y);
        grad.addColorStop(0, rgba(TIP_COLORS[a.name].slice(1), k * 0.65));
        grad.addColorStop(1, rgba(TIP_COLORS[b.name].slice(1), k * 0.65));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1 + k * 2;
        ctx.beginPath();
        ctx.moveTo(a.p.x, a.p.y);
        ctx.lineTo(b.p.x, b.p.y);
        ctx.stroke();
      }
    }
  }

  // Raised fingertips close into a filled polygon. Points are ordered by
  // angle around their centroid so the shape never self-intersects,
  // regardless of hand rotation.
  drawShape(ctx, h) {
    const up = FINGER_NAMES.filter((n) => h.up[n]);
    this.pushTrails(h, up);
    if (up.length < 2) return up.length === 1 ? { side: h.side, name: "Point" } : null;

    const tips = up.map((n) => this.pt(h, TIP[n]));
    const cx = tips.reduce((s, p) => s + p.x, 0) / tips.length;
    const cy = tips.reduce((s, p) => s + p.y, 0) / tips.length;
    const ordered = tips
      .map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }))
      .sort((a, b) => a.a - b.a)
      .map((o) => o.p);

    const hue = SHAPE_HUE[up.length] ?? 200;
    if (up.length >= 3) {
      ctx.beginPath();
      ordered.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue},85%,60%,0.16)`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue},90%,65%,0.8)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = `hsla(${hue},90%,65%,0.8)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ordered[0].x, ordered[0].y);
      ctx.lineTo(ordered[1].x, ordered[1].y);
      ctx.stroke();
    }

    this.drawTrails(ctx, h, up);
    return { side: h.side, name: SHAPE_NAMES[up.length] };
  }

  pushTrails(h, up) {
    for (const name of FINGER_NAMES) {
      const key = `${h.side}-${name}`;
      let arr = this.trails.get(key);
      if (!arr) this.trails.set(key, (arr = []));
      if (up.includes(name)) {
        arr.push(this.pt(h, TIP[name]));
        if (arr.length > TRAIL_LEN) arr.shift();
      } else if (arr.length) {
        arr.shift();
      }
    }
  }

  drawTrails(ctx, h, up) {
    for (const name of up) {
      const arr = this.trails.get(`${h.side}-${name}`);
      if (!arr || arr.length < 2) continue;
      for (let i = 1; i < arr.length; i++) {
        const a = (i / arr.length) * 0.5;
        ctx.strokeStyle = rgba(TIP_COLORS[name].slice(1), a);
        ctx.lineWidth = 1 + (i / arr.length) * 2;
        ctx.beginPath();
        ctx.moveTo(arr[i - 1].x, arr[i - 1].y);
        ctx.lineTo(arr[i].x, arr[i].y);
        ctx.stroke();
      }
    }
  }

  // Shrinks and eventually drops a hand's trails once it leaves the frame.
  decay(key) {
    const arr = this.trails.get(key);
    if (!arr) return;
    arr.shift();
    if (!arr.length) this.trails.delete(key);
  }

  drawNodes(ctx, h, t) {
    for (let i = 0; i < 21; i++) {
      const isTip = Object.values(TIP).includes(i);
      const base = isTip ? 6 : i === 0 ? 5 : 3;
      const pulse = 1 + 0.12 * Math.sin(t / 280 + i);
      const boost = Math.min(h.speed[i] * 0.35, 7);
      const r = (base + boost) * pulse;
      const p = this.pt(h, i);
      const name = FINGER_NAMES.find((n) => TIP[n] === i);
      const color = name ? TIP_COLORS[name] : "#ffffff";

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? rgba(color.slice(1), 0.9) : "#ffffff33";
      ctx.fill();
      if (isTip) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(color.slice(1), 0.35);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // Matching raised fingers bridge across both hands; palms close enough
  // counts as "linked".
  drawBridges(ctx, a, b, t) {
    for (const name of FINGER_NAMES) {
      if (!a.up[name] || !b.up[name]) continue;
      const p = this.pt(a, TIP[name]);
      const q = this.pt(b, TIP[name]);
      const pulse = 0.5 + 0.3 * Math.sin(t / 200);
      ctx.strokeStyle = rgba(TIP_COLORS[name].slice(1), pulse);
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const pa = this.pt(a, 0), pb = this.pt(b, 0);
    const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    const avgSize = (a.size + b.size) / 2;
    return d < avgSize * LINK_DIST_FACTOR;
  }
}

// Standard MediaPipe hand connections (bone graph), inlined so this module
// has no dependency on the vision bundle.
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
