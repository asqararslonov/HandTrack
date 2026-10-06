import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { Constellation, SHAPE_NAMES } from "./mesh.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const fpsEl = document.getElementById("fps");
const shapesEl = document.getElementById("shapes");
const linkedEl = document.getElementById("linked");

// Landmark indices, same layout used across the repo.
const FINGERS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

let landmarker;
const mesh = new Constellation();

// ---------- hand analysis ----------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

// Distance-based so it holds up across hand rotation (see PhotoShoot/app.js
// for the same approach).
function fingerStates(lm) {
  const wrist = lm[0];
  const up = {};
  for (const name of ["index", "middle", "ring", "pinky"]) {
    const [, pip, , tip] = FINGERS[name];
    up[name] = dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.15;
  }
  up.thumb = dist(lm[4], lm[17]) > dist(lm[2], lm[17]) * 1.1;
  return up;
}

function analyze(lm, reportedSide) {
  return {
    lm,
    up: fingerStates(lm),
    // MediaPipe assumes a mirrored input; the raw webcam feed isn't, so flip.
    side: reportedSide === "Left" ? "Right" : "Left",
  };
}

// ---------- UI ----------

function renderShapes(shapes, linked) {
  shapesEl.innerHTML = "";
  for (const s of shapes) {
    if (!s.name) continue;
    const span = document.createElement("span");
    span.textContent = `${s.side}: ${s.name}`;
    shapesEl.append(span);
  }
  linkedEl.classList.toggle("on", linked);
}

// ---------- loop ----------

let lastVideoTime = -1;
let frames = 0;
let fpsT0 = performance.now();

function loop() {
  const now = performance.now();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, now);
    const hands = res.landmarks.map((lm, i) =>
      analyze(lm, res.handedness[i][0].categoryName),
    );

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { shapes, linked } = mesh.render(ctx, hands, canvas.width, canvas.height);
    renderShapes(shapes, linked);
    frames++;
  }

  if (now - fpsT0 >= 1000) {
    fpsEl.textContent = frames;
    frames = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(loop);
}

// ---------- setup ----------

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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
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
addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    mesh.reset();
  }
});
init();
