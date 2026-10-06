<div align="center">

# FingerMix

**Each finger is a filter dial.** Curl it in and the filter fades out;
extend it and the filter fades in — mix several live instead of switching
between them one at a time.

[![MediaPipe](https://img.shields.io/badge/vision-MediaPipe%20Hand%20Landmarker-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
[![Canvas 2D](https://img.shields.io/badge/render-Canvas%202D-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#)
[![No backend](https://img.shields.io/badge/backend-none-success?style=flat-square)](#)

<img src="docs/mix-demo.jpg" width="760" alt="Thermal, Sepia and Arctic filters blended together, with live percentage dials in the sidebar">
<br><sub>Thumb (Thermal) at 85%, Sepia and Arctic each at 50% — three filters layered live, dials tracking the mix</sub>

</div>

```bash
python3 -m http.server 5175
open http://localhost:5175
```

## The idea

Five fingers, five filters, one dial each:

| Finger | Filter |
|---|---|
| Thumb | Thermal |
| Index | Sepia |
| Middle | Night Vision |
| Ring | Arctic |
| Pinky | Posterize |

How extended a finger is (0 = curled, 1 = fully open) controls that
filter's opacity. Curl your hand into a fist and you see raw video; open
one finger partway and its filter fades in partway; open several at once
and they blend — not a selector, a mixing board.

## How the dial works

[`app.js`](app.js) computes a continuous **curl** value per finger instead
of the boolean up/down used in [PhotoShoot](../PhotoShoot) and
[Constellation](../Constellation) — same tip-to-wrist distance ratio those
two already proved out on a real camera, just smoothed into a 0–1 ramp
(`smoothstep`) instead of thresholded into true/false. With two hands
visible, either hand can drive a dial — each finger's weight is the max
curl across all visible hands, so you're not locked to one hand.

[`filters.js`](filters.js) draws the raw frame once, then layers each
engaged finger's filter on top at `globalAlpha` equal to its curl, in
thumb → pinky order. It's a straightforward over-compositing blend, not a
weighted average — a filter added later in the order sits visually on top
of one added earlier at the same weight. That's a known trade-off (see
below), not a bug: it still reads clearly as "mixing," and keeping it to
plain alpha compositing is what keeps five full-frame filter passes cheap
enough to run every frame.

All five filters are GPU `ctx.filter` strings — three native CSS filter
functions, and two (Posterize, Thermal) are SVG filters referenced via
`url(#id)`, reused from PhotoShoot's fix for the same problem: a per-pixel
JS pass costs a few milliseconds per full-frame layer, and here up to five
layers run every frame, which a CPU round-trip can't afford. Measured
worst case — two hands, all five dials fully open — **~4ms/frame**,
comfortably inside the 16.7ms budget at 60fps.

## Known gaps

- The blend is order-dependent alpha compositing, not a true weighted
  average — layering all five at 100% leans toward whichever filter comes
  later in thumb→pinky order, rather than splitting evenly five ways.
- Filter-to-finger mapping is fixed; an obvious follow-up is letting you
  reassign which filter lives on which finger, or swap in a whole second
  bank with a gesture.
