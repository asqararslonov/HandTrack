# HandTrack

Computer vision and ML projects built around real-time hand tracking. Each
subfolder is a standalone project — its own README, its own stack, pulled
into this repo as it's finished rather than planned up front.

## Projects

- [`PhotoShoot/`](PhotoShoot/) — real-time hand tracking in the browser
  (MediaPipe Hand Landmarker). A 3D particle field driven by hand position and
  gesture, plus a two-hand "director's frame" gesture that applies live video
  filters to a region of the frame.

## Why this repo exists

Most of this starts as a hobby project, but it doubles as a running build log:
what got built, what broke, and how it got fixed. Each project's README
includes the non-obvious engineering decisions, not just a feature list.

## Stack notes

No build step by default — plain HTML/CSS/JS served statically, so any
project can be opened by just running a local server. Heavier ML work
(custom-trained models, Python pipelines) gets its own `requirements.txt` /
`package.json` inside that project's folder as needed.
