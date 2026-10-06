import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { FINGER_FILTERS, FINGER_ORDER, TIP_COLORS, renderMix } from "./filters.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const fpsEl = document.getElementById("fps");
const metersEl = document.getElementById("meters");
const fullmixEl = document.getElementById("fullmix");

const FINGERS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

let landmarker;

// ---------- curl detection ----------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// Continuous version of the up/down heuristic used elsewhere in the repo:
// same tip-to-wrist distance ratio, smoothed into a 0..1 dial instead of a
// boolean, so curling a finger partway fades its filter in partway.
function fingerCurl(lm) {
  const wrist = lm[0];
  const curl = {};
  for (const name of ["index", "middle", "ring", "pinky"]) {
    const [, pip, , tip] = FINGERS[name];
    const ratio = dist(lm[tip], wrist) / dist(lm[pip], wrist);
    curl[name] = smoothstep(0.88, 1.22, ratio);
  }
  const thumbRatio = dist(lm[4], lm[17]) / dist(lm[2], lm[17]);
  curl.thumb = smoothstep(0.92, 1.25, thumbRatio);
  return curl;
}

// MediaPipe assumes a mirrored input; the raw webcam feed isn't, so flip.
const flipSide = (s) => (s === "Left" ? "Right" : "Left");

// ---------- meters ----------

function buildMeters() {
  metersEl.innerHTML = "";
  for (const name of FINGER_ORDER) {
    const f = FINGER_FILTERS[name];
    const row = document.createElement("div");
    row.className = "meter";
    row.innerHTML = `
      <div class="meter-head">
        <b style="color:${TIP_COLORS[name]}">${f.name}</b>
        <span data-pct>0%</span>
      </div>
      <div class="track"><div class="fill" data-fill style="background:${TIP_COLORS[name]}"></div></div>
    `;
    metersEl.append(row);
  }
}

function updateMeters(weights) {
  const rows = metersEl.children;
  FINGER_ORDER.forEach((name, i) => {
    const w = weights[name] || 0;
    const row = rows[i];
    row.querySelector("[data-fill]").style.width = `${Math.round(w * 100)}%`;
    row.querySelector("[data-pct]").textContent = `${Math.round(w * 100)}%`;
  });
  fullmixEl.classList.toggle("on", FINGER_ORDER.every((n) => (weights[n] || 0) > 0.6));
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

    // Either hand can drive a dial — take the strongest curl per finger
    // across all visible hands so two-handed play works naturally.
    const weights = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
    for (const lm of res.landmarks) {
      const curl = fingerCurl(lm);
      for (const name of FINGER_ORDER) weights[name] = Math.max(weights[name], curl[name]);
    }

    renderMix(ctx, video, canvas.width, canvas.height, weights);
    updateMeters(weights);
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
  buildMeters();
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
init();
