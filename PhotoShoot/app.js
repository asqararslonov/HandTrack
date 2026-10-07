import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { FilterFrame, isCorner } from "./filters.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const fxCanvas = document.getElementById("fx");
const fxCtx = fxCanvas.getContext("2d");
const labelEl = document.getElementById("label");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const fpsEl = document.getElementById("fps");
const handsEl = document.getElementById("hands");
const cardTpl = document.getElementById("hand-card");
const draw = new DrawingUtils(ctx);

// Landmark indices: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
const FINGERS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};
const TIP_COLORS = {
  thumb: "#f87171",
  index: "#fbbf24",
  middle: "#4ade80",
  ring: "#60a5fa",
  pinky: "#c084fc",
};

let landmarker;
const frame = new FilterFrame();
let mode = "filter";

// ---------- geometry ----------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

// Distance-based so it works regardless of hand rotation.
function fingerStates(lm) {
  const wrist = lm[0];
  const up = {};
  for (const name of ["index", "middle", "ring", "pinky"]) {
    const [, pip, , tip] = FINGERS[name];
    up[name] = dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15;
  }
  // Thumb: extended when its tip is far from the pinky base,
  // folded across the palm when it gets close.
  up.thumb = dist(lm[4], lm[17]) > dist(lm[2], lm[17]) * 1.1;
  return up;
}

function gestureName(up, pinching) {
  const { thumb, index, middle, ring, pinky } = up;
  const n = Object.values(up).filter(Boolean).length;

  if (pinching && middle && ring && pinky) return "👌 OK";
  if (pinching) return "🤏 Pinch";
  if (n === 0) return "✊ Fist";
  if (n === 5) return "🖐 Open palm";
  if (index && middle && !ring && !pinky) return "✌️ Peace";
  if (index && pinky && !middle && !ring) return "🤘 Rock";
  if (thumb && n === 1) return "👍 Thumbs up";
  if (index && n === 1) return "☝️ Pointing";
  if (thumb && pinky && n === 2) return "🤙 Call me";
  return "";
}

function analyze(lm, reportedSide) {
  const up = fingerStates(lm);
  const handSize = dist(lm[0], lm[9]);
  const pinching = dist(lm[4], lm[8]) < handSize * 0.3;
  return {
    lm,
    up,
    pinching,
    // MediaPipe assumes a mirrored input; the raw webcam feed isn't, so flip.
    side: reportedSide === "Left" ? "Right" : "Left",
    count: Object.values(up).filter(Boolean).length,
    gesture: gestureName(up, pinching),
  };
}

// ---------- rendering ----------

function drawHand(lm, dim) {
  draw.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, {
    color: dim ? "#ffffff44" : "#ffffffaa",
    lineWidth: dim ? 2 : 3,
  });
  if (dim) return;
  draw.drawLandmarks(lm, { color: "#ffffff", radius: 3 });
  for (const [name, idx] of Object.entries(FINGERS)) {
    draw.drawLandmarks([lm[idx[3]]], { color: TIP_COLORS[name], radius: 7 });
  }
}

// Live readout of whether each hand currently passes the filter-frame
// gesture check — lets you see which hand/finger is off instead of guessing.
function drawCornerBadge(h, W, H) {
  const ok = isCorner(h);
  const wrist = h.lm[0];
  const x = wrist.x * W;
  const y = wrist.y * H + 28;
  ctx.save();
  // The canvas element is CSS-mirrored for the selfie view; flip the text
  // back around its own position so it still reads left-to-right.
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.font = "600 13px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = ok ? "#4ade80" : "#f87171";
  ctx.fillText(ok ? "L ✓" : "L ✗", 0, 0);
  ctx.restore();
}

function renderPanel(hands) {
  if (!hands.length) {
    if (!handsEl.querySelector(".empty")) {
      handsEl.innerHTML = '<p class="empty">Show your hand to the camera.</p>';
    }
    return;
  }
  while (handsEl.children.length > hands.length) handsEl.lastChild.remove();
  handsEl.querySelector(".empty")?.remove();

  hands.forEach((h, i) => {
    let card = handsEl.children[i];
    if (!card) {
      card = cardTpl.content.firstElementChild.cloneNode(true);
      handsEl.append(card);
    }
    card.querySelector(".side").textContent = `${h.side} hand`;
    card.querySelector(".count").textContent = h.count;
    card.querySelector(".gesture").textContent = h.gesture;
    for (const li of card.querySelectorAll(".fingers li")) {
      li.classList.toggle("up", h.up[li.dataset.f]);
    }
  });
}

// ---------- loop ----------

let lastVideoTime = -1;
let frames = 0;
let fpsT0 = performance.now();
let hands = [];

function loop() {
  const now = performance.now();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, now);
    hands = res.landmarks.map((lm, i) =>
      analyze(lm, res.handedness[i][0].categoryName),
    );
    renderPanel(hands);
    frames++;
  }

  if (mode === "filter") {
    frame.update(hands, fxCanvas.width, fxCanvas.height);
    frame.render(fxCtx, video, fxCanvas.width, fxCanvas.height);
    const f = frame.filter;
    const n = frame.stamps.length;
    labelEl.textContent = frame.rect && f
      ? `${f.name}${frame.full ? " · full" : ""}${n ? ` · +${n}` : ""}`
      : n ? `${n} frame${n > 1 ? "s" : ""}` : "";
    labelEl.classList.toggle("frozen", !frame.rect && n > 0);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const h of hands) drawHand(h.lm, mode !== "inspect");
  if (mode === "filter") {
    for (const h of hands) drawCornerBadge(h, canvas.width, canvas.height);
  }

  if (now - fpsT0 >= 1000) {
    fpsEl.textContent = frames;
    frames = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(loop);
}

// ---------- setup ----------

function setMode(next) {
  mode = next;
  for (const b of document.querySelectorAll(".modes button")) {
    b.classList.toggle("on", b.dataset.mode === next);
  }
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  labelEl.textContent = "";
  frame.clear();
}

async function startCamera() {
  startBtn.hidden = true;
  statusEl.textContent = "Starting camera…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    for (const c of [canvas, fxCanvas]) {
      c.width = video.videoWidth;
      c.height = video.videoHeight;
    }
    statusEl.textContent = "";
    loop();
  } catch (err) {
    statusEl.textContent = `Camera error: ${err.message}`;
    startBtn.hidden = false;
  }
}

async function init() {
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  } catch (err) {
    statusEl.textContent = `Failed to load model: ${err.message}`;
    return;
  }
  statusEl.textContent = "";
  startBtn.hidden = false;
}

startBtn.addEventListener("click", startCamera);
for (const b of document.querySelectorAll(".modes button")) {
  b.addEventListener("click", () => setMode(b.dataset.mode));
}
addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    frame.clear();
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    labelEl.textContent = "";
  }
  if (e.key === "z") frame.undo();
});
init();
