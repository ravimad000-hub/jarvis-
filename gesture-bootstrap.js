(() => {
  window.__handsBootstrapActive = true;

  const state = {
    running: false,
    model: null,
    busy: false,
    rafId: 0,
    firstResult: false,
    fallback: {
      dragActive: false,
      dragTarget: null,
      dragOffsetX: 0,
      dragOffsetY: 0,
      zoomPrevDistance: null,
      zoomScale: 1,
      swipePrevX: null,
      swipePrevT: 0,
      swipeCooldownUntil: 0,
      atomOrbitPhase: 0,
      atomLayer: null,
      atomCore: null,
      atomNodes: [],
      defaultLayoutCaptured: false,
      defaultLayout: {
        left: null,
        right: null,
        rings: null,
        atom: { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 }
      }
    }
  };

  const MODES = ["Assembly", "Analysis", "Spectral"];

  function setTracking(text) {
    const el = document.getElementById("trackingStatus");
    if (el) el.textContent = text;
  }

  function setGesture(text) {
    const el = document.getElementById("gestureStatus");
    if (el) el.textContent = `Gesture: ${text}`;
  }

  function setMode(indexDelta) {
    const modeStatus = document.getElementById("modeStatus");
    if (!modeStatus) return;
    const current = (modeStatus.textContent || "").replace(/mode:\s*/i, "").trim();
    let idx = MODES.findIndex((m) => m.toLowerCase() === current.toLowerCase());
    if (idx < 0) idx = 0;
    idx = (idx + indexDelta + MODES.length) % MODES.length;
    modeStatus.textContent = `Mode: ${MODES[idx]}`;
  }

  function showError(err) {
    console.error("GESTURE BOOTSTRAP FAILED:", err);
    let box = document.getElementById("handTrackingErrorBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "handTrackingErrorBox";
      box.style.cssText = [
        "position: fixed",
        "z-index: 999998",
        "top: 80px",
        "left: 20px",
        "right: 20px",
        "background: red",
        "color: white",
        "padding: 20px",
        "font: 20px monospace"
      ].join(";");
      document.body.appendChild(box);
    }
    box.textContent = `HAND TRACKING ERROR: ${(err && err.name) || "Error"} - ${(err && err.message) || "Unknown error"}`;
    setTracking("TRACKING: ERROR");
  }

  function fingerExtended(lm, tip, pip) {
    return lm[tip].y < lm[pip].y;
  }

  function isOpenPalm(lm) {
    const count = [
      Math.abs(lm[4].x - lm[2].x) > 0.03,
      fingerExtended(lm, 8, 6),
      fingerExtended(lm, 12, 10),
      fingerExtended(lm, 16, 14),
      fingerExtended(lm, 20, 18)
    ].filter(Boolean).length;
    return count >= 4;
  }

  function isPinch(lm) {
    const dx = lm[4].x - lm[8].x;
    const dy = lm[4].y - lm[8].y;
    return Math.hypot(dx, dy) < 0.06;
  }

  function isFist(lm) {
    const folded = [
      !fingerExtended(lm, 8, 6),
      !fingerExtended(lm, 12, 10),
      !fingerExtended(lm, 16, 14),
      !fingerExtended(lm, 20, 18)
    ].filter(Boolean).length;
    return folded >= 4;
  }

  function isPointing(lm) {
    return fingerExtended(lm, 8, 6) && !fingerExtended(lm, 12, 10) && !fingerExtended(lm, 16, 14) && !fingerExtended(lm, 20, 18);
  }

  function drawHands(handCanvas, hands) {
    const ctx = handCanvas.getContext("2d");
    ctx.clearRect(0, 0, handCanvas.width, handCanvas.height);

    const drawConnectorsFn = window.drawConnectors;
    const drawLandmarksFn = window.drawLandmarks;
    const connections = window.HAND_CONNECTIONS;

    for (const lm of hands) {
      if (drawConnectorsFn && drawLandmarksFn && connections) {
        drawConnectorsFn(ctx, lm, connections, { color: "rgba(109, 249, 255, 0.42)", lineWidth: 2 });
        drawLandmarksFn(ctx, lm, { color: "rgba(178, 251, 255, 0.85)", radius: 2.2 });
      }
    }
  }

  function classifyGesture(hands) {
    if (!hands.length) return "WAITING...";
    const lm = hands[0];
    if (isFist(lm)) return "Closed Fist";
    if (isPinch(lm)) return "Pinch";
    if (isPointing(lm)) return "Pointing";
    if (isOpenPalm(lm)) return "Open Palm";
    return "Tracking";
  }

  function toScreen(point) {
    return {
      x: (1 - point.x) * window.innerWidth,
      y: point.y * window.innerHeight
    };
  }

  function ensureFallbackAtoms() {
    if (state.fallback.atomLayer) return state.fallback.atomLayer;

    const layer = document.createElement("div");
    layer.id = "fallbackAtomLayer";
    layer.style.cssText = [
      "position: fixed",
      "left: 50%",
      "top: 50%",
      "width: 260px",
      "height: 260px",
      "transform: translate(-50%, -50%)",
      "z-index: 2",
      "pointer-events: none"
    ].join(";");

    const core = document.createElement("div");
    core.style.cssText = [
      "position: absolute",
      "left: 50%",
      "top: 50%",
      "width: 52px",
      "height: 52px",
      "border-radius: 50%",
      "transform: translate(-50%, -50%)",
      "background: radial-gradient(circle at 35% 35%, rgba(200,255,255,0.95), rgba(76,195,255,0.78), rgba(8,36,76,0.24))",
      "box-shadow: 0 0 38px rgba(109,249,255,0.9), 0 0 80px rgba(46,143,255,0.55)"
    ].join(";");
    layer.appendChild(core);

    const nodes = [];
    for (let i = 0; i < 10; i += 1) {
      const node = document.createElement("div");
      node.style.cssText = [
        "position: absolute",
        "left: 50%",
        "top: 50%",
        "width: 16px",
        "height: 16px",
        "border-radius: 50%",
        "background: rgba(156, 246, 255, 0.95)",
        "box-shadow: 0 0 18px rgba(109,249,255,0.95), 0 0 34px rgba(46,143,255,0.65)"
      ].join(";");
      layer.appendChild(node);
      nodes.push(node);
    }

    document.body.appendChild(layer);
    state.fallback.atomLayer = layer;
    state.fallback.atomCore = core;
    state.fallback.atomNodes = nodes;
    return layer;
  }

  function animateFallbackAtoms(now) {
    const layer = ensureFallbackAtoms();
    const nodes = state.fallback.atomNodes;
    const t = now * 0.001;
    state.fallback.atomOrbitPhase = t;

    const scale = state.fallback.zoomScale;
    layer.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;

    for (let i = 0; i < nodes.length; i += 1) {
      const a = t * (0.7 + i * 0.04) + i * 0.7;
      const r = 72 + Math.sin(t * 1.6 + i) * 22;
      const x = Math.cos(a) * r;
      const y = Math.sin(a * 1.2) * r;
      nodes[i].style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px))`;
    }
  }

  function getDragTargetAt(x, y) {
    const leftPanel = document.querySelector(".left-panel");
    const rightPanel = document.querySelector(".right-panel");
    const rings = document.querySelector(".center-rings");
    const atomLayer = ensureFallbackAtoms();

    const candidates = [leftPanel, rightPanel, rings, atomLayer].filter(Boolean);
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { el, rect };
      }
    }

    if (rings) {
      const rect = rings.getBoundingClientRect();
      return { el: rings, rect };
    }

    return null;
  }

  function captureDefaultLayout() {
    if (state.fallback.defaultLayoutCaptured) return;
    const leftPanel = document.querySelector(".left-panel");
    const rightPanel = document.querySelector(".right-panel");
    const rings = document.querySelector(".center-rings");
    const atomLayer = ensureFallbackAtoms();

    if (leftPanel) state.fallback.defaultLayout.left = leftPanel.getBoundingClientRect();
    if (rightPanel) state.fallback.defaultLayout.right = rightPanel.getBoundingClientRect();
    if (rings) state.fallback.defaultLayout.rings = rings.getBoundingClientRect();
    if (atomLayer) {
      const rect = atomLayer.getBoundingClientRect();
      state.fallback.defaultLayout.atom = {
        x: rect.left + rect.width * 0.5,
        y: rect.top + rect.height * 0.5
      };
    }

    state.fallback.defaultLayoutCaptured = true;
  }

  function positionElementAt(el, x, y, w, h) {
    const clampedX = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const clampedY = Math.max(8, Math.min(window.innerHeight - h - 8, y));
    el.style.position = "fixed";
    el.style.left = `${clampedX}px`;
    el.style.top = `${clampedY}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function updateFallbackControls(hands, now) {
    const cursor = document.getElementById("cursor");
    const leftPanel = document.querySelector(".left-panel");
    const rightPanel = document.querySelector(".right-panel");
    const rings = document.querySelector(".center-rings");
    const atomLayer = ensureFallbackAtoms();

    captureDefaultLayout();
    animateFallbackAtoms(now);

    if (!hands.length) {
      if (cursor) cursor.classList.remove("active");
      state.fallback.dragActive = false;
      state.fallback.dragTarget = null;
      state.fallback.zoomPrevDistance = null;
      return;
    }

    const primary = hands[0];
    const openPalm = isOpenPalm(primary);
    const fist = isFist(primary);
    const pinch = isPinch(primary);
    const pointing = isPointing(primary);
    const pinchPoint = toScreen({
      x: (primary[4].x + primary[8].x) * 0.5,
      y: (primary[4].y + primary[8].y) * 0.5
    });

    if (pointing && cursor) {
      const p = toScreen(primary[8]);
      cursor.style.left = `${p.x}px`;
      cursor.style.top = `${p.y}px`;
      cursor.classList.add("active");
    } else if (cursor) {
      cursor.classList.remove("active");
    }

    if (fist) {
      if (leftPanel && state.fallback.defaultLayout.left) {
        positionElementAt(leftPanel, state.fallback.defaultLayout.left.left, state.fallback.defaultLayout.left.top, leftPanel.offsetWidth, leftPanel.offsetHeight);
      }
      if (rightPanel && state.fallback.defaultLayout.right) {
        positionElementAt(rightPanel, state.fallback.defaultLayout.right.left, state.fallback.defaultLayout.right.top, rightPanel.offsetWidth, rightPanel.offsetHeight);
      }
      if (rings) {
        const rect = state.fallback.defaultLayout.rings;
        if (rect) {
          positionElementAt(rings, rect.left, rect.top, rings.offsetWidth, rings.offsetHeight);
        }
      }
      if (atomLayer) {
        const atom = state.fallback.defaultLayout.atom;
        positionElementAt(atomLayer, atom.x - atomLayer.offsetWidth * 0.5, atom.y - atomLayer.offsetHeight * 0.5, atomLayer.offsetWidth, atomLayer.offsetHeight);
      }
      state.fallback.zoomScale = 1;
      state.fallback.dragActive = false;
      state.fallback.dragTarget = null;
      setGesture("Closed Fist: Reset");
      return;
    }

    if (pinch) {
      if (!state.fallback.dragActive) {
        const hit = getDragTargetAt(pinchPoint.x, pinchPoint.y);
        if (hit) {
          state.fallback.dragActive = true;
          state.fallback.dragTarget = hit.el;
          state.fallback.dragOffsetX = pinchPoint.x - hit.rect.left;
          state.fallback.dragOffsetY = pinchPoint.y - hit.rect.top;
        }
      }

      if (state.fallback.dragTarget) {
        const target = state.fallback.dragTarget;
        positionElementAt(
          target,
          pinchPoint.x - state.fallback.dragOffsetX,
          pinchPoint.y - state.fallback.dragOffsetY,
          target.offsetWidth,
          target.offsetHeight
        );
      }
      setGesture("Pinch: Drag HUD / Atoms");
    } else {
      state.fallback.dragActive = false;
      state.fallback.dragTarget = null;
      if (openPalm) {
        setGesture("Open Palm: Activate");
      }
    }

    if (openPalm) {
      const px = toScreen(primary[9]).x;
      const dt = Math.max(16, now - state.fallback.swipePrevT);
      if (state.fallback.swipePrevX !== null && now > state.fallback.swipeCooldownUntil) {
        const vx = (px - state.fallback.swipePrevX) / dt;
        if (Math.abs(vx) > 1.25) {
          setMode(vx < 0 ? 1 : -1);
          setGesture(vx < 0 ? "Swipe Right: Next Mode" : "Swipe Left: Previous Mode");
          state.fallback.swipeCooldownUntil = now + 900;
        }
      }
      state.fallback.swipePrevX = px;
      state.fallback.swipePrevT = now;
    }

    if (hands.length >= 2) {
      const dx = hands[0][9].x - hands[1][9].x;
      const dy = hands[0][9].y - hands[1][9].y;
      const d = Math.hypot(dx, dy);
      if (state.fallback.zoomPrevDistance !== null) {
        const delta = d - state.fallback.zoomPrevDistance;
        state.fallback.zoomScale = Math.max(0.6, Math.min(1.9, state.fallback.zoomScale + delta * 1.6));
        if (Math.abs(delta) > 0.004) {
          setGesture(delta > 0 ? "Two Hands Apart: Zoom In" : "Two Hands Together: Zoom Out");
        }
      }
      state.fallback.zoomPrevDistance = d;
      if (rings) {
        rings.style.transform = `translate(-50%, -50%) scale(${state.fallback.zoomScale.toFixed(3)})`;
      }
    } else {
      state.fallback.zoomPrevDistance = null;
    }
  }

  async function startHandsFromVideo(video) {
    if (state.running) return;
    const HandsCtor = window.Hands;
    if (!HandsCtor) throw new Error("MediaPipe Hands not loaded");

    const handCanvas = document.getElementById("handCanvas");
    if (!handCanvas) throw new Error("#handCanvas not found");

    handCanvas.width = window.innerWidth;
    handCanvas.height = window.innerHeight;
    window.addEventListener("resize", () => {
      handCanvas.width = window.innerWidth;
      handCanvas.height = window.innerHeight;
    });

    console.log("Gesture bootstrap: hands init start");
    state.model = new HandsCtor({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    state.model.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.2,
      minTrackingConfidence: 0.2,
      selfieMode: true
    });

    state.model.onResults((results) => {
      const hands = results.multiHandLandmarks || [];
      const handedness = results.multiHandedness || [];
      const now = performance.now();

      if (!state.firstResult) {
        state.firstResult = true;
        console.log("Gesture bootstrap: first onResults received");
      }

      window.__latestHandsData = { hands, handedness };

      if (typeof window.__setHandsLandmarks === "function") {
        window.__setHandsLandmarks(hands, handedness);
      } else {
        drawHands(handCanvas, hands);
        if (hands.length) {
          setTracking("TRACKING: HANDS DETECTED");
        } else {
          setTracking("TRACKING: SEARCHING FOR HANDS");
        }

        setGesture(classifyGesture(hands));
        updateFallbackControls(hands, now);
      }
    });

    state.running = true;
    const loop = async () => {
      if (!state.running) return;
      if (video.srcObject && video.readyState >= 2 && !video.paused && !state.busy) {
        state.busy = true;
        try {
          await state.model.send({ image: video });
        } catch (err) {
          showError(err);
        } finally {
          state.busy = false;
        }
      }
      state.rafId = requestAnimationFrame(loop);
    };

    state.rafId = requestAnimationFrame(loop);
    console.log("Gesture bootstrap: loop started");
  }

  async function maybeStart() {
    try {
      const video = document.getElementById("camera");
      if (!video || !video.srcObject || video.readyState < 2 || video.paused) {
        return;
      }
      await startHandsFromVideo(video);
      window.__handsBootstrapActive = true;
    } catch (err) {
      showError(err);
    }
  }

  window.addEventListener("camera-connected", maybeStart);
  window.addEventListener("load", maybeStart);
  setInterval(maybeStart, 800);
})();
