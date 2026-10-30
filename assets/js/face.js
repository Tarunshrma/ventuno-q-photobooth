/**
 * Face geometry for face art, built from the board's face mesh points and
 * smoothed over time: small jitters are damped, real movement is followed
 * immediately so props stay on the face.
 */
class FaceSmoother {
  #faces = [];
  #lastSeen = 0;

  /** detections: meta.faces from the board; mapPoint: normalized frame point -> stage point. */
  update(detections, mapPoint) {
    // Keep props in place through a brief detection miss
    if (!detections.length && performance.now() - this.#lastSeen < 300) return;
    if (detections.length) this.#lastSeen = performance.now();

    const next = detections.map((det) => {
      const pts = {};
      for (const [name, p] of Object.entries(det.points)) pts[name] = mapPoint({ x: p[0], y: p[1] });
      return pts;
    });

    this.#faces = next.map((pts) => {
      const prev = this.#nearest(pts.noseTip);
      if (!prev) return pts;
      // Adaptive smoothing: follow fast moves, damp tiny jitters
      const scale = Math.hypot(pts.leftFace.x - pts.rightFace.x, pts.leftFace.y - pts.rightFace.y) || 100;
      const moved = Math.hypot(pts.noseTip.x - prev.noseTip.x, pts.noseTip.y - prev.noseTip.y);
      const follow = Math.min(1, 0.45 + moved / (scale * 0.08));
      const out = {};
      for (const name of Object.keys(pts)) {
        out[name] = {
          x: prev[name].x + (pts[name].x - prev[name].x) * follow,
          y: prev[name].y + (pts[name].y - prev[name].y) * follow,
        };
      }
      return out;
    });
  }

  #nearest(p) {
    let best = null;
    let bestDist = 150;
    for (const f of this.#faces) {
      const d = Math.hypot(f.noseTip.x - p.x, f.noseTip.y - p.y);
      if (d < bestDist) [best, bestDist] = [f, d];
    }
    return best;
  }

  get faces() {
    return this.#faces.map(buildFace);
  }
}

/**
 * Face geometry in stage coordinates, handed to themes' face art.
 * leftX/rightX are as seen on screen (the picture is mirrored).
 */
function buildFace(p) {
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const onLeft = (a, b) => (a.x <= b.x ? [a, b] : [b, a]);

  const [leftEye, rightEye] = onLeft(p.rightIris, p.leftIris);
  const [leftEyeOuter, rightEyeOuter] = onLeft(p.rightEyeOuter, p.leftEyeOuter);
  const [leftCheek, rightCheek] = onLeft(p.rightCheek, p.leftCheek);
  const [mouthLeftCorner, mouthRightCorner] = onLeft(p.mouthRight, p.mouthLeft);

  return {
    width: dist(p.rightFace, p.leftFace),
    angle: Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x), // head tilt
    leftEye,
    rightEye,
    eyeDistance: dist(leftEye, rightEye),
    foreheadTop: p.foreheadTop,
    forehead: p.forehead,
    browCenter: lerp(p.browCenter, p.noseBridge, 0.35),
    noseBridge: p.noseBridge,
    noseTip: p.noseTip,
    noseBottom: p.noseBottom,
    mustache: lerp(p.noseBottom, p.upperLipTop, 0.45), // between nose and upper lip
    upperLip: p.upperLipTop,
    mouth: lerp(p.upperLipInner, p.lowerLipInner, 0.5),
    upperLipInner: p.upperLipInner,
    mouthLeftCorner,
    mouthRightCorner,
    mouthWidth: dist(p.mouthRight, p.mouthLeft),
    chin: p.chin,
    leftCheek,
    rightCheek,
  };
}
