// Each finger is a filter dial: how far it's extended (0 = curled, 1 =
// fully open) is that filter's opacity. Layers composite in thumb → pinky
// order, each drawn over the full frame with its own alpha, so you mix
// multiple looks at once instead of picking one.
//
// All five are GPU canvas filters — native `ctx.filter` strings for most,
// and SVG filters (defined in index.html) referenced by url() for the two
// that need per-pixel math (posterize, thermal). See PhotoShoot's README
// for why: a per-pixel JS pass here costs ~2-3ms per full-frame layer, and
// five of them per frame would blow the budget. GPU filters cost ~0.2ms
// each regardless of which kind.

export const TIP_COLORS = {
  thumb: "#f87171",
  index: "#fbbf24",
  middle: "#4ade80",
  ring: "#60a5fa",
  pinky: "#c084fc",
};

export const FINGER_FILTERS = {
  thumb: { name: "Thermal", css: "url(#fm-thermal)" },
  index: { name: "Sepia", css: "sepia(0.9) contrast(1.1)" },
  middle: { name: "Night Vision", css: "grayscale(1) sepia(1) hue-rotate(55deg) saturate(5) contrast(1.4)" },
  ring: { name: "Arctic", css: "sepia(0.3) hue-rotate(182deg) saturate(2.1) contrast(1.08) brightness(1.08)" },
  pinky: { name: "Posterize", css: "url(#fm-posterize)" },
};

export const FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"];

// Draws the base frame, then layers each engaged finger's filter over it at
// an alpha equal to how extended that finger is.
export function renderMix(ctx, video, W, H, weights) {
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.drawImage(video, 0, 0, W, H);

  for (const name of FINGER_ORDER) {
    const w = weights[name] || 0;
    if (w < 0.04) continue;
    ctx.globalAlpha = w;
    ctx.filter = FINGER_FILTERS[name].css;
    ctx.drawImage(video, 0, 0, W, H);
  }
  ctx.globalAlpha = 1;
  ctx.filter = "none";
}
