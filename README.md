<div align="center">

# HandTrack

**Computer vision & ML projects built around real-time hand tracking.**
No installs, no backend — everything runs live in the browser off the webcam.

[![Last commit](https://img.shields.io/github/last-commit/asqararslonov/HandTrack?style=flat-square&color=blueviolet)](https://github.com/asqararslonov/HandTrack/commits/main)
[![License: MIT](https://img.shields.io/github/license/asqararslonov/HandTrack?style=flat-square&color=blue)](LICENSE)
[![JavaScript](https://img.shields.io/badge/javascript-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#)
[![MediaPipe](https://img.shields.io/badge/vision-MediaPipe-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/edge/mediapipe)
[![No backend](https://img.shields.io/badge/backend-none-success?style=flat-square)](#)

<img src="Constellation/docs/mesh-demo.jpg" width="820" alt="Hand mesh forming a triangle, bridged to a second hand">

</div>

<br>

## Projects

<table>
<tr>
<td width="220"><img src="PhotoShoot/docs/filter-stack.jpg" width="200" alt="Stacked filter frames"></td>
<td>

### [PhotoShoot](PhotoShoot/)
Real-time hand & finger tracking (MediaPipe) and a two-hand "director's
frame" gesture that stacks live video filters over the feed.

**[Read the full writeup →](PhotoShoot/README.md)**

</td>
</tr>
<tr>
<td width="220"><img src="Constellation/docs/mesh-demo.jpg" width="200" alt="Hand mesh forming a triangle, bridged to a second hand"></td>
<td>

### [Constellation](Constellation/)
Your hands as a live network: every joint is a node, fingertips wire
together into a mesh, and whichever fingers you raise close into a filled
shape — a triangle at 3 fingers, a pentagon at 5. Two hands bridge across
matching fingertips.

**[Read the full writeup →](Constellation/README.md)**

</td>
</tr>
<tr>
<td width="220"><img src="FingerMix/docs/mix-demo.jpg" width="200" alt="Thermal, Sepia and Arctic filters blended via finger dials"></td>
<td>

### [FingerMix](FingerMix/)
Each finger is a filter dial — curl it in and the filter fades out, extend
it and it fades in. Thumb is Thermal, index Sepia, middle Night Vision,
ring Arctic, pinky Posterize. Open several fingers at once and the filters
blend live instead of switching one at a time.

**[Read the full writeup →](FingerMix/README.md)**

</td>
</tr>
</table>

More projects get added here as they're finished — each one gets its own
folder and its own README.

## Why this repo exists

Most of this starts as a hobby project, but it doubles as a running build
log: what got built, what broke, and how it got fixed. Each project's README
covers the non-obvious engineering decisions, not just a feature list —
performance bugs, tracking quirks, the stuff that's actually worth writing
down.

## Stack notes

No build step by default — plain HTML/CSS/JS served statically, so any
project can be opened by just running a local server:

```bash
cd <project> && python3 -m http.server 5173
```

Heavier ML work (custom-trained models, Python pipelines) gets its own
`requirements.txt` / `package.json` inside that project's folder as needed.

## License

[MIT](LICENSE) — do whatever you want with it.
