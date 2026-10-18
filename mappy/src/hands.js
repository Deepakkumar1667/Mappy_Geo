// Webcam hand tracking (MediaPipe Hand Landmarker) + gesture analysis.
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export function createHandTracker() {
  let landmarker = null;
  let stream = null;
  let video = null;
  let lastVideoTime = -1;
  let last = { hands: [] };

  async function ensureModel() {
    if (landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5
      });
    try {
      landmarker = await make('GPU');
    } catch {
      landmarker = await make('CPU');
    }
  }

  return {
    get active() {
      return !!stream;
    },

    async start(videoEl) {
      video = videoEl;
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      await ensureModel();
      lastVideoTime = -1;
    },

    stop() {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video) video.srcObject = null;
      last = { hands: [] };
    },

    // Returns { hands: [{ lm, side, score }], ms } - reuses the last result if the video frame has not changed.
    detect(now) {
      if (!stream || !landmarker || video.readyState < 2) return last;
      if (video.currentTime === lastVideoTime) return last;
      lastVideoTime = video.currentTime;
      const t0 = performance.now();
      const res = landmarker.detectForVideo(video, now);
      const ms = performance.now() - t0;
      last = {
        ms,
        hands: res.landmarks.map((lm, i) => {
          const cat = res.handednesses?.[i]?.[0];
          // The camera image is not mirrored, MediaPipe's label assumes a mirrored one -> swap.
          const side = cat?.categoryName === 'Left' ? 'RIGHT' : 'LEFT';
          return { lm, side, score: cat?.score ?? 0 };
        })
      };
      return last;
    }
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Turns 21 landmarks into a simple gesture description.
export function analyzeHand(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6;
  const extended = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18]
  ].map(([tip, pip]) => dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.08);
  const count = extended.filter(Boolean).length;

  let gesture = 'HAND';
  if (count >= 4) gesture = 'OPEN PALM';
  else if (count === 0) gesture = 'FIST';
  else if (extended[0] && !extended[2] && !extended[3]) gesture = 'POINT';

  return {
    gesture,
    pinchRatio: dist(lm[4], lm[8]) / palm,
    palm: lm[9],
    tip: lm[8]
  };
}
