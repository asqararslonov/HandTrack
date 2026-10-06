// A volume of particles in 3D, projected to the screen with perspective.
//
// Depth is real: particles sit at different z, shrink as they recede, and go
// soft and bokeh-like the further they are from the focal plane. Hue follows
// depth (warm near, cool far) the way aerial perspective works, so the cloud
// reads as a volume rather than a flat sheet of dots.

const HOME_K = 0.006; // spring pull back to resting position
const DAMP = 0.93;
const GROUPS = 10; // hue buckets, assigned by resting depth
const BUCKETS = 6; // sprite softness levels, chosen by live depth
const FOCAL = 900; // perspective strength
const Z_NEAR = -260; // closest resting depth (toward the camera)
const Z_FAR = 620;
const DOF = 230; // distance from the focal plane before blur sets in
const SPRITE = 32;

const lerp = (a, b, t) => a + (b - a) * t;

export class Field {
  constructor(w, h, count = 3000) {
    this.w = w;
    this.h = h;
    this.n = count;
    for (const k of ["px", "py", "pz", "vx", "vy", "vz", "hx", "hy", "hz"]) {
      this[k] = new Float32Array(count);
    }
    this.shockwaves = [];
    this.groups = Array.from({ length: GROUPS }, () => []);
    this.sprites = this.buildSprites();
    this.reset();
  }

  // Pre-render every (hue, softness) pair once; the loop then only blits.
  buildSprites() {
    const out = [];
    for (let g = 0; g < GROUPS; g++) {
      const t = g / (GROUPS - 1); // 0 = near, 1 = far
      const hue = lerp(330, 195, t); // pink → cyan with distance
      const light = lerp(72, 55, t);
      const row = [];
      for (let b = 0; b < BUCKETS; b++) {
        const soft = b / (BUCKETS - 1);
        const c = document.createElement("canvas");
        c.width = c.height = SPRITE;
        const x = SPRITE / 2;
        const ctx = c.getContext("2d");
        const grad = ctx.createRadialGradient(x, x, 0, x, x, x);
        // A sharp particle is a tight bright core; a defocused one spreads
        // into a dim, even disc — the bokeh look.
        const core = lerp(0.95, 0.18, soft);
        grad.addColorStop(0, `hsla(${hue},95%,${light}%,${core})`);
        grad.addColorStop(lerp(0.18, 0.62, soft), `hsla(${hue},92%,${light - 8}%,${core * 0.45})`);
        grad.addColorStop(lerp(0.5, 0.9, soft), `hsla(${hue},90%,${light - 18}%,${core * 0.12})`);
        grad.addColorStop(1, `hsla(${hue},90%,50%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, SPRITE, SPRITE);
        row.push(c);
      }
      out.push(row);
    }
    return out;
  }

  reset() {
    const { w, h } = this;
    for (const g of this.groups) g.length = 0;

    for (let i = 0; i < this.n; i++) {
      // Pick where it should land on screen, then push it back to its depth —
      // this keeps the frame evenly covered at every distance.
      const t = Math.random();
      const z = lerp(Z_NEAR, Z_FAR, t * t); // more particles up close
      const k = FOCAL / (FOCAL + z);
      const sx = (Math.random() * 1.1 - 0.05) * w;
      const sy = (Math.random() * 1.1 - 0.05) * h;
      const x = w / 2 + (sx - w / 2) / k;
      const y = h / 2 + (sy - h / 2) / k;

      this.hx[i] = x; this.hy[i] = y; this.hz[i] = z;
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;

      const g = Math.min(GROUPS - 1, (t * GROUPS) | 0);
      this.groups[g].push(i);
    }
    this.shockwaves.length = 0;
  }

  shockwave(x, y, z = 0) {
    this.shockwaves.push({ x, y, z, r: 10, life: 1 });
  }

  // forces: [{ x, y, z, r, strength, swirl }] — strength > 0 repels, < 0 attracts.
  update(forces) {
    const { px, py, pz, vx, vy, vz, hx, hy, hz } = this;

    for (const s of this.shockwaves) {
      s.r += 26;
      s.life -= 0.022;
    }
    this.shockwaves = this.shockwaves.filter((s) => s.life > 0);

    for (let i = 0; i < this.n; i++) {
      const x = px[i], y = py[i], z = pz[i];
      let fx = (hx[i] - x) * HOME_K;
      let fy = (hy[i] - y) * HOME_K;
      let fz = (hz[i] - z) * HOME_K;

      for (let k = 0; k < forces.length; k++) {
        const f = forces[k];
        const dx = x - f.x;
        const dy = y - f.y;
        const dz = z - (f.z || 0);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > f.r * f.r) continue;
        const d = Math.sqrt(d2) + 0.01;
        const falloff = 1 - d / f.r;
        const s = (f.strength * falloff * falloff) / d;
        fx += dx * s;
        fy += dy * s;
        fz += dz * s * 0.6;
        if (f.swirl) {
          const t = (Math.abs(f.strength) * falloff * f.swirl) / d;
          fx += -dy * t;
          fy += dx * t;
        }
      }

      for (let k = 0; k < this.shockwaves.length; k++) {
        const s = this.shockwaves[k];
        const dx = x - s.x, dy = y - s.y, dz = z - s.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
        const band = Math.abs(d - s.r);
        if (band > 70) continue;
        const push = (1 - band / 70) * s.life * 9;
        fx += (dx / d) * push;
        fy += (dy / d) * push;
        fz += (dz / d) * push;
      }

      let nvx = (vx[i] + fx) * DAMP;
      let nvy = (vy[i] + fy) * DAMP;
      let nvz = (vz[i] + fz) * DAMP;
      let nx = x + nvx, ny = y + nvy, nz = z + nvz;

      // Keep the volume bounded so nothing drifts out of frame or through the lens.
      const m = 240;
      if (nx < -m) { nx = -m; nvx = -nvx * 0.5; }
      else if (nx > this.w + m) { nx = this.w + m; nvx = -nvx * 0.5; }
      if (ny < -m) { ny = -m; nvy = -nvy * 0.5; }
      else if (ny > this.h + m) { ny = this.h + m; nvy = -nvy * 0.5; }
      if (nz < Z_NEAR - 120) { nz = Z_NEAR - 120; nvz = -nvz * 0.5; }
      else if (nz > Z_FAR + 200) { nz = Z_FAR + 200; nvz = -nvz * 0.5; }

      vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
      px[i] = nx; py[i] = ny; pz[i] = nz;
    }
  }

  render(ctx) {
    const { w, h, px, py, pz, vx, vy } = this;

    // Fade toward transparent so the camera stays visible behind the trails.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    const cx = w / 2, cy = h / 2;
    for (let g = 0; g < GROUPS; g++) {
      const row = this.sprites[g];
      const idx = this.groups[g];
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        const z = pz[i];
        const k = FOCAL / (FOCAL + z);
        if (k <= 0.02) continue; // behind the camera
        const sx = cx + (px[i] - cx) * k;
        const sy = cy + (py[i] - cy) * k;
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;

        // Out-of-focus particles grow and soften; fast ones flare slightly.
        const blur = Math.min(1, Math.abs(z) / DOF);
        const speed = Math.abs(vx[i]) + Math.abs(vy[i]);
        const size = (2.6 + blur * 7 + Math.min(speed, 8) * 0.5) * k;
        const b = Math.min(BUCKETS - 1, (blur * BUCKETS) | 0);
        ctx.drawImage(row[b], sx - size, sy - size, size * 2, size * 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
