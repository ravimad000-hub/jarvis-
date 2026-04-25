import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/postprocessing/UnrealBloomPass.js";

const video = document.getElementById("camera");
const threeCanvas = document.getElementById("threeCanvas");
const handCanvas = document.getElementById("handCanvas");
const hctx = handCanvas.getContext("2d");

const gestureStatus = document.getElementById("gestureStatus");
const trackingStatus = document.getElementById("trackingStatus");
const cameraStatus = document.getElementById("cameraStatus");
const modeStatus = document.getElementById("modeStatus");
const calibration = document.getElementById("calibration");
const cursor = document.getElementById("cursor");
const aiMessage = document.getElementById("aiMessage");
const hudRoot = document.getElementById("hudRoot");
const leftPanel = document.querySelector(".left-panel");
const rightPanel = document.querySelector(".right-panel");
const centerRingsEl = document.querySelector(".center-rings");

const energyValue = document.getElementById("energyValue");
const stabilityValue = document.getElementById("stabilityValue");
const fluxValue = document.getElementById("fluxValue");
const analysisValue = document.getElementById("analysisValue");
const networkValue = document.getElementById("networkValue");
const targetValue = document.getElementById("targetValue");

const state = {
    cameraReady: false,
    handsReady: false,
    handTrackingFailed: false,
    hands: [],
    handedness: [],
    handWorld: [],
    handAngles: [],
    systemActive: true,
    collapsed: false,
    modeIndex: 0,
    modes: ["Assembly", "Analysis", "Spectral"],
    gesture: "Waiting",
    primaryPinch: false,
    primaryOpenPalm: false,
    primaryFist: false,
    swipe: {
        prevX: null,
        prevT: 0,
        cooldownUntil: 0
    },
    zoom: {
        prevDistance: null,
        targetScale: 1,
        ringScale: 1
    },
    atomSpread: {
        current: 1,
        target: 1
    },
    cursor: {
        x: window.innerWidth * 0.5,
        y: window.innerHeight * 0.5
    },
    grab: {
        active: false,
        kind: null,
        index: -1,
        handIndex: -1,
        offset: new THREE.Vector3()
    },
    hudDrag: {
        active: false,
        target: null,
        handIndex: -1,
        offsetX: 0,
        offsetY: 0
    },
    messageUntil: 0,
    lastHandsDetectedAt: 0,
    systemBooted: false,
    sceneLoopStarted: false
};

const handRuntime = {
    model: null,
    running: false,
    busy: false,
    rafId: 0,
    firstFrameSent: false,
    firstResultSeen: false,
    seenAnyResults: false,
    lastSendAt: 0,
    lastResultAt: 0,
    restartAttempts: 0
};

function setGesture(text) {
    state.gesture = text;
    gestureStatus.textContent = `Gesture: ${text}`;
}

function setTracking(text) {
    trackingStatus.textContent = text;
}

function setMode(index) {
    state.modeIndex = (index + state.modes.length) % state.modes.length;
    modeStatus.textContent = `Mode: ${state.modes[state.modeIndex]}`;
    queueAiMessage(`${state.modes[state.modeIndex]} mode engaged.`);
}

function queueAiMessage(text, duration = 1800) {
    aiMessage.textContent = text;
    state.messageUntil = performance.now() + duration;
}

function showHandTrackingError(err) {
    const errName = err?.name || "Error";
    const errMessage = err?.message || "Unknown error";
    console.error("MediaPipe Hands failed:", err);

    let box = document.getElementById("handTrackingErrorBox");
    if (!box) {
        box = document.createElement("div");
        box.id = "handTrackingErrorBox";
        box.style.cssText = `
          position: fixed;
          z-index: 999998;
          top: 80px;
          left: 20px;
          right: 20px;
          background: red;
          color: white;
          padding: 20px;
          font: 20px monospace;
        `;
        document.body.appendChild(box);
    }
    box.textContent = `HAND TRACKING ERROR: ${errName} - ${errMessage}`;
}

function clearHandTrackingError() {
    const box = document.getElementById("handTrackingErrorBox");
    if (box) {
        box.remove();
    }
}

function resize() {
    handCanvas.width = window.innerWidth;
    handCanvas.height = window.innerHeight;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);

function bootSystemOnce() {
    if (state.systemBooted) {
        return;
    }
    state.systemBooted = true;
    setGesture("Open palm to activate / pinch to grab");
    queueAiMessage("Analyzing structure... gesture link ready.");
    ensureSceneLoop();
}

// ---------- Three.js Scene ----------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x061220, 0.03);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 8);

const renderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.95, 0.45, 0.2);
composer.addPass(bloomPass);

const hemi = new THREE.HemisphereLight(0x7cf8ff, 0x081018, 0.55);
scene.add(hemi);

const pointA = new THREE.PointLight(0x58dfff, 2.4, 20, 2);
pointA.position.set(4, 3, 4);
scene.add(pointA);

const pointB = new THREE.PointLight(0x1f6cff, 1.7, 16, 2);
pointB.position.set(-4, -2, 3);
scene.add(pointB);

const grid = new THREE.GridHelper(22, 26, 0x2f9eff, 0x1b5fa3);
grid.material.opacity = 0.22;
grid.material.transparent = true;
grid.position.y = -3.2;
scene.add(grid);

const holoPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x2ec8ff, transparent: true, opacity: 0.06, wireframe: true })
);
holoPlane.rotation.x = -Math.PI / 2;
holoPlane.position.y = -2.3;
scene.add(holoPlane);

const coreRoot = new THREE.Group();
scene.add(coreRoot);

const coreSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.76, 48, 48),
    new THREE.MeshStandardMaterial({
        color: 0x69e7ff,
        emissive: 0x1d7cff,
        emissiveIntensity: 1.2,
        metalness: 0.52,
        roughness: 0.18
    })
);
coreRoot.add(coreSphere);

const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.35, 1),
    new THREE.MeshBasicMaterial({ color: 0x7dfcff, transparent: true, opacity: 0.14, wireframe: true })
);
coreRoot.add(shell);

const orbitRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.65, 0.04, 18, 130),
    new THREE.MeshBasicMaterial({ color: 0x57dcff, transparent: true, opacity: 0.48 })
);
orbitRing.rotation.x = Math.PI / 2;
coreRoot.add(orbitRing);

const atomGroup = new THREE.Group();
coreRoot.add(atomGroup);

const nodeCount = 18;
const nodes = [];
const nodeGeom = new THREE.SphereGeometry(0.38, 28, 28);

for (let i = 0; i < nodeCount; i += 1) {
    const phi = Math.acos(1 - 2 * ((i + 1) / (nodeCount + 1)));
    const theta = i * 2.39996;
    const slot = new THREE.Vector3(
        Math.cos(theta) * Math.sin(phi),
        Math.cos(phi),
        Math.sin(theta) * Math.sin(phi)
    ).multiplyScalar(1.9 + (i % 3) * 0.13);

    const mat = new THREE.MeshStandardMaterial({
        color: 0xb2ffff,
        emissive: 0x44a8ff,
        emissiveIntensity: 2.2,
        metalness: 0.28,
        roughness: 0.24
    });

    const node = new THREE.Mesh(nodeGeom, mat);
    node.position.copy(slot);
    node.userData = {
        slot,
        velocity: new THREE.Vector3(),
        target: slot.clone(),
        trail: []
    };

    const trailGeom = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({ color: 0x77f6ff, transparent: true, opacity: 0.5 });
    const trailLine = new THREE.Line(trailGeom, trailMat);
    node.userData.trailLine = trailLine;
    atomGroup.add(node);
    atomGroup.add(trailLine);
    nodes.push(node);
}

const linkGeom = new THREE.BufferGeometry();
const linkMat = new THREE.LineBasicMaterial({ color: 0x73f3ff, transparent: true, opacity: 0.95 });
const linkLines = new THREE.LineSegments(linkGeom, linkMat);
atomGroup.add(linkLines);

const particleCount = 460;
const particleGeom = new THREE.BufferGeometry();
const pPositions = new Float32Array(particleCount * 3);
const pSeeds = new Float32Array(particleCount);
for (let i = 0; i < particleCount; i += 1) {
    pPositions[i * 3] = (Math.random() - 0.5) * 14;
    pPositions[i * 3 + 1] = (Math.random() - 0.5) * 10;
    pPositions[i * 3 + 2] = (Math.random() - 0.5) * 14;
    pSeeds[i] = Math.random() * 100;
}
particleGeom.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
const particles = new THREE.Points(
    particleGeom,
    new THREE.PointsMaterial({
        color: 0x7af2ff,
        size: 0.05,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    })
);
scene.add(particles);

const atomHalo = new THREE.Mesh(
    new THREE.TorusKnotGeometry(2.35, 0.06, 180, 20),
    new THREE.MeshBasicMaterial({ color: 0x78f7ff, transparent: true, opacity: 0.72 })
);
atomHalo.rotation.x = Math.PI * 0.35;
atomGroup.add(atomHalo);

resize();

// ---------- Hand Tracking ----------
function drawHands(hands) {
    hctx.clearRect(0, 0, handCanvas.width, handCanvas.height);
    const drawConnectorsFn = window.drawConnectors;
    const drawLandmarksFn = window.drawLandmarks;
    const connections = window.HAND_CONNECTIONS;

    for (const lm of hands) {
        if (drawConnectorsFn && drawLandmarksFn && connections) {
            drawConnectorsFn(hctx, lm, connections, { color: "rgba(109, 249, 255, 0.42)", lineWidth: 2 });
            drawLandmarksFn(hctx, lm, { color: "rgba(178, 251, 255, 0.85)", radius: 2.2 });
            continue;
        }

        // Fallback draw path so tracking still works even if drawing_utils globals are unavailable.
        hctx.fillStyle = "rgba(178, 251, 255, 0.85)";
        for (const p of lm) {
            hctx.beginPath();
            hctx.arc((1 - p.x) * handCanvas.width, p.y * handCanvas.height, 2.2, 0, Math.PI * 2);
            hctx.fill();
        }
    }
}

function landmarkToScreen(point) {
    return {
        x: (1 - point.x) * window.innerWidth,
        y: point.y * window.innerHeight
    };
}

function getHudDragTargetAt(x, y) {
    // Keep HUD drag limited to side panels so center pinch remains available for atom/core grabs.
    const candidates = [leftPanel, rightPanel].filter(Boolean);
    for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return { el, rect };
        }
    }
    return null;
}

function updateHudDrag(primary, handIndex) {
    if (!primary) return;
    const pinchPoint = landmarkToScreen({
        x: (primary[4].x + primary[8].x) * 0.5,
        y: (primary[4].y + primary[8].y) * 0.5
    });

    if (!state.primaryPinch) {
        state.hudDrag.active = false;
        state.hudDrag.target = null;
        state.hudDrag.handIndex = -1;
        return;
    }

    if (!state.hudDrag.active) {
        const hit = getHudDragTargetAt(pinchPoint.x, pinchPoint.y);
        if (!hit) return;
        state.hudDrag.active = true;
        state.hudDrag.target = hit.el;
        state.hudDrag.handIndex = handIndex;
        state.hudDrag.offsetX = pinchPoint.x - hit.rect.left;
        state.hudDrag.offsetY = pinchPoint.y - hit.rect.top;
    }

    if (!state.hudDrag.target || state.hudDrag.handIndex !== handIndex) {
        return;
    }

    const target = state.hudDrag.target;
    const w = target.offsetWidth;
    const h = target.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, pinchPoint.x - state.hudDrag.offsetX));
    const y = Math.max(8, Math.min(window.innerHeight - h - 8, pinchPoint.y - state.hudDrag.offsetY));
    target.style.position = "fixed";
    target.style.left = `${x}px`;
    target.style.top = `${y}px`;
    target.style.right = "auto";
    target.style.bottom = "auto";
}

function ingestExternalHands(hands, handedness) {
    state.hands = hands || [];
    state.handedness = handedness || [];
    if (state.hands.length > 0) {
        state.lastHandsDetectedAt = performance.now();
        setTracking("TRACKING: HANDS DETECTED");
    } else {
        setTracking("TRACKING: SEARCHING FOR HANDS");
    }
    drawHands(state.hands);
    state.handsReady = true;
    state.handTrackingFailed = false;
    if (!state.systemBooted) {
        bootSystemOnce();
    }
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

function handAngle(lm) {
    const a = lm[5];
    const b = lm[17];
    return Math.atan2(b.y - a.y, b.x - a.x);
}

function handToWorld(lm, depthBias = 0) {
    const nx = (1 - lm[9].x) * 2 - 1;
    const ny = -(lm[9].y * 2 - 1);
    const vec = new THREE.Vector3(nx, ny, 0.4 + depthBias);
    vec.unproject(camera);
    const dir = vec.sub(camera.position).normalize();
    const distance = (0 - camera.position.z) / dir.z;
    return camera.position.clone().add(dir.multiplyScalar(distance));
}

function updateCursor(lm) {
    const tip = lm[8];
    const tx = (1 - tip.x) * window.innerWidth;
    const ty = tip.y * window.innerHeight;
    state.cursor.x += (tx - state.cursor.x) * 0.24;
    state.cursor.y += (ty - state.cursor.y) * 0.24;
    cursor.style.left = `${state.cursor.x}px`;
    cursor.style.top = `${state.cursor.y}px`;
}

function stopHandsRuntime() {
    handRuntime.running = false;
    handRuntime.busy = false;
    if (handRuntime.rafId) {
        cancelAnimationFrame(handRuntime.rafId);
        handRuntime.rafId = 0;
    }
}

function scheduleHandsRestart(videoEl, reason) {
    handRuntime.restartAttempts += 1;
    console.warn(`Hands restart attempt ${handRuntime.restartAttempts}: ${reason}`);
    setTracking("TRACKING: ERROR");
    state.handsReady = false;
    state.handTrackingFailed = true;
    stopHandsRuntime();
    setTimeout(() => {
        if (state.cameraReady && videoEl && videoEl.srcObject && !videoEl.paused) {
            startHandsFromVideo(videoEl);
        }
    }, 450);
}

function startHandsFromVideo(videoEl) {
    console.log("Hands init start");
    if (!videoEl || !videoEl.srcObject) {
        throw new Error("Camera video stream not available for MediaPipe.");
    }
    if (videoEl.readyState < 2 || videoEl.paused) {
        throw new Error("Camera video not ready for hand tracking.");
    }
    const HandsCtor = window.Hands || (typeof Hands !== "undefined" ? Hands : null);
    if (!HandsCtor) {
        throw new Error("MediaPipe Hands library is unavailable.");
    }

    stopHandsRuntime();
    clearHandTrackingError();

    handRuntime.model = new HandsCtor({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    handRuntime.model.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.35,
        minTrackingConfidence: 0.35,
        selfieMode: true
    });

    handRuntime.firstFrameSent = false;
    handRuntime.firstResultSeen = false;
    handRuntime.seenAnyResults = false;
    handRuntime.lastSendAt = 0;
    handRuntime.lastResultAt = performance.now();
    handRuntime.running = true;
    handRuntime.busy = false;

    handRuntime.model.onResults((results) => {
        try {
            state.hands = results.multiHandLandmarks || [];
            state.handedness = results.multiHandedness || [];
            handRuntime.lastResultAt = performance.now();
            handRuntime.seenAnyResults = true;
            if (!handRuntime.firstResultSeen) {
                handRuntime.firstResultSeen = true;
                console.log("Hands first onResults received");
            }
            if (state.hands.length > 0) {
                state.lastHandsDetectedAt = performance.now();
            }
            drawHands(state.hands);
            state.handsReady = true;
            state.handTrackingFailed = false;
        } catch (err) {
            console.error("Hands onResults error:", err);
            showHandTrackingError(err);
        }
    });

    const frameLoop = async (ts) => {
        if (!handRuntime.running) {
            return;
        }
        if (state.cameraReady && videoEl.readyState >= 2 && !videoEl.paused && !handRuntime.busy && ts - handRuntime.lastSendAt > 30) {
            handRuntime.busy = true;
            handRuntime.lastSendAt = ts;
            if (!handRuntime.firstFrameSent) {
                console.log("Hands first frame sent");
                handRuntime.firstFrameSent = true;
            }
            try {
                await handRuntime.model.send({ image: videoEl });
            } catch (err) {
                showHandTrackingError(err);
                console.error("MediaPipe send error:", err);
                setTracking("TRACKING: ERROR");
                state.handTrackingFailed = true;
                state.handsReady = false;
                return;
            } finally {
                handRuntime.busy = false;
            }
        }
        handRuntime.rafId = requestAnimationFrame(frameLoop);
    };
    handRuntime.rafId = requestAnimationFrame(frameLoop);
}

function analyzeHandGestures(now) {
    const hands = state.hands;
    state.handWorld = [];
    state.handAngles = [];

    if (!hands.length) {
        calibration.classList.add("visible");
        cursor.classList.remove("active");
        setTracking("TRACKING: SEARCHING FOR HANDS");
        if (now - state.lastHandsDetectedAt > 3500 && handRuntime.firstFrameSent) {
            queueAiMessage("Hands not detected. Move closer to camera and improve lighting.");
        }
        state.primaryPinch = false;
        state.primaryOpenPalm = false;
        state.primaryFist = false;
        state.zoom.prevDistance = null;
        state.hudDrag.active = false;
        state.hudDrag.target = null;
        state.hudDrag.handIndex = -1;
        return;
    }

    calibration.classList.remove("visible");
    setTracking("TRACKING: HANDS DETECTED");

    hands.forEach((lm, i) => {
        const world = handToWorld(lm, i * 0.03);
        state.handWorld.push(world);
        state.handAngles.push(handAngle(lm));
    });

    const primary = hands[0];
    state.primaryPinch = isPinch(primary);
    state.primaryOpenPalm = isOpenPalm(primary);
    state.primaryFist = isFist(primary);
    const primaryPointing = isPointing(primary);
    const peace = fingerExtended(primary, 8, 6) && fingerExtended(primary, 12, 10) && !fingerExtended(primary, 16, 14) && !fingerExtended(primary, 20, 18);
    const thumbsUp = Math.abs(primary[4].y - primary[2].y) > 0.04 &&
        !fingerExtended(primary, 8, 6) &&
        !fingerExtended(primary, 12, 10) &&
        !fingerExtended(primary, 16, 14) &&
        !fingerExtended(primary, 20, 18);

    // Keep gesture status explicit and stable based on the primary hand.
    if (state.primaryFist) {
        setGesture("Closed Fist: Reset");
    } else if (state.primaryPinch) {
        setGesture("Pinch: Grab / Select");
    } else if (primaryPointing) {
        setGesture("Pointing: Cursor");
    } else if (peace) {
        setGesture("Peace Sign: Focus Mode");
    } else if (thumbsUp) {
        setGesture("Thumbs Up: Confirm");
    } else if (state.primaryOpenPalm) {
        setGesture("Open Palm: Activate");
    }

    if (primaryPointing) {
        updateCursor(primary);
        cursor.classList.add("active");
    } else {
        cursor.classList.remove("active");
    }

    updateHudDrag(primary, 0);

    if (state.primaryOpenPalm) {
        if (!state.systemActive || state.collapsed) {
            queueAiMessage("System reactivated. Holographic matrix online.");
        }
        state.systemActive = true;
        state.collapsed = false;
        setGesture("Open Palm: Activate");
    }

    if (state.primaryFist) {
        state.systemActive = false;
        state.collapsed = true;
        setGesture("Closed Fist: Reset");
        coreRoot.position.set(0, 0, 0);
        coreRoot.rotation.set(0, 0, 0);
        atomGroup.rotation.set(0, 0, 0);
        queueAiMessage("Collapsing interface and resetting structure.");
        releaseGrab();
    }

    const leadWorld = state.handWorld[0];
    const dt = Math.max(16, now - state.swipe.prevT);
    if (leadWorld) {
        if (state.swipe.prevX !== null && state.primaryOpenPalm && now > state.swipe.cooldownUntil) {
            const vx = (leadWorld.x - state.swipe.prevX) / dt;
            if (Math.abs(vx) > 0.025) {
                setMode(state.modeIndex + (vx < 0 ? 1 : -1));
                setGesture(vx < 0 ? "Swipe Right: Next Mode" : "Swipe Left: Previous Mode");
                state.swipe.cooldownUntil = now + 900;
            }
        }
        state.swipe.prevX = leadWorld.x;
        state.swipe.prevT = now;
    }

    if (hands.length >= 2) {
        const dx = hands[0][9].x - hands[1][9].x;
        const dy = hands[0][9].y - hands[1][9].y;
        const d = Math.hypot(dx, dy);
        const mappedScale = THREE.MathUtils.mapLinear(d, 0.08, 0.58, 0.58, 2.45);
        const mappedSpread = THREE.MathUtils.mapLinear(d, 0.08, 0.58, 0.35, 5.0);
        state.zoom.targetScale = THREE.MathUtils.clamp(mappedScale, 0.58, 2.45);
        state.atomSpread.target = THREE.MathUtils.clamp(mappedSpread, 0.35, 5.0);
        state.zoom.ringScale = THREE.MathUtils.clamp(
            THREE.MathUtils.mapLinear(state.atomSpread.target, 0.35, 5.0, 0.78, 1.95),
            0.78,
            1.95
        );

        if (state.zoom.prevDistance !== null) {
            const delta = d - state.zoom.prevDistance;
            if (Math.abs(delta) > 0.005) {
                setGesture(delta > 0 ? "Two Hands Apart: Expand" : "Two Hands Together: Compress");
            }
        }
        state.zoom.prevDistance = d;
    } else {
        state.zoom.prevDistance = null;
    }
}

function worldToScreenPos(world) {
    const p = world.clone().project(camera);
    return {
        x: (p.x * 0.5 + 0.5) * window.innerWidth,
        y: (-p.y * 0.5 + 0.5) * window.innerHeight
    };
}

function nearestNodeToScreenPoint(screenPoint) {
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
        const world = nodes[i].getWorldPosition(new THREE.Vector3());
        const s = worldToScreenPos(world);
        const d = Math.hypot(s.x - screenPoint.x, s.y - screenPoint.y);
        if (d < bestDist) {
            bestDist = d;
            best = { index: i, dist: d, world };
        }
    }
    return best;
}

function beginGrab(handIndex) {
    if (state.grab.active || !state.handWorld[handIndex]) {
        return;
    }

    const lm = state.hands[handIndex];
    const pinchPoint = {
        x: (1 - ((lm[4].x + lm[8].x) * 0.5)) * window.innerWidth,
        y: ((lm[4].y + lm[8].y) * 0.5) * window.innerHeight
    };

    const nearest = nearestNodeToScreenPoint(pinchPoint);
    const coreScreen = worldToScreenPos(coreRoot.getWorldPosition(new THREE.Vector3()));
    const coreDist = Math.hypot(coreScreen.x - pinchPoint.x, coreScreen.y - pinchPoint.y);

    if (nearest && nearest.dist < 280) {
        state.grab.active = true;
        state.grab.kind = "node";
        state.grab.index = nearest.index;
        state.grab.handIndex = handIndex;
        state.grab.offset.copy(nodes[nearest.index].position).sub(state.handWorld[handIndex]);
        queueAiMessage("Node capture confirmed. Manipulate molecular component.");
        setGesture("Pinch: Grab Node");
        return;
    }

    // Always allow core grab as fallback so pinch can always move something.
    state.grab.active = true;
    state.grab.kind = "core";
    state.grab.index = -1;
    state.grab.handIndex = handIndex;
    state.grab.offset.copy(coreRoot.position).sub(state.handWorld[handIndex]);
    queueAiMessage(coreDist < 260
        ? "Core tether locked. Repositioning energy assembly."
        : "Core fallback lock engaged. Move hand to control.");
    setGesture("Pinch: Grab Core");
}

function releaseGrab() {
    if (state.grab.active) {
        queueAiMessage("Releasing object. Optimizing configuration...");
    }
    state.grab.active = false;
    state.grab.kind = null;
    state.grab.index = -1;
    state.grab.handIndex = -1;
}

function updateGrabInteraction(delta) {
    if (!state.systemActive) {
        releaseGrab();
        return;
    }
    if (state.hudDrag.active) {
        releaseGrab();
        return;
    }

    const pinchByHand = state.hands.map((lm) => isPinch(lm));

    if (!state.grab.active) {
        const grabHand = pinchByHand.findIndex(Boolean);
        if (grabHand !== -1) {
            beginGrab(grabHand);
        }
    }

    if (state.grab.active) {
        const hi = state.grab.handIndex;
        if (!pinchByHand[hi] || !state.handWorld[hi]) {
            releaseGrab();
            return;
        }

        const handPos = state.handWorld[hi].clone().add(state.grab.offset);
        if (state.grab.kind === "core") {
            // Amplify movement slightly so it reads clearly on camera.
            const boosted = handPos.clone().multiplyScalar(1.45);
            coreRoot.position.lerp(boosted, 1 - Math.exp(-delta * 9));
            const targetAngle = state.handAngles[hi] || 0;
            coreRoot.rotation.z = THREE.MathUtils.lerp(coreRoot.rotation.z, -targetAngle * 1.4, 1 - Math.exp(-delta * 8));
            coreRoot.rotation.x += delta * 0.6;
        }

        if (state.grab.kind === "node") {
            const node = nodes[state.grab.index];
            const desired = atomGroup.worldToLocal(handPos.clone());
            node.position.lerp(desired, 1 - Math.exp(-delta * 14));
            const move = desired.clone().sub(node.position);
            node.userData.velocity.add(move.multiplyScalar(10 * delta));
            const targetAngle = state.handAngles[hi] || 0;
            atomGroup.rotation.y = THREE.MathUtils.lerp(atomGroup.rotation.y, -targetAngle * 1.6, 1 - Math.exp(-delta * 8));
        }
    }
}

function applyModeTargets(t) {
    const mode = state.modes[state.modeIndex];
    const spread = state.atomSpread.current;

    for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const slot = node.userData.slot;

        if (mode === "Assembly") {
            node.userData.target.copy(slot).multiplyScalar(spread);
        } else if (mode === "Analysis") {
            const a = i * 0.55 + t * 0.8;
            node.userData.target.set(Math.cos(a) * 2.2, (i - nodes.length * 0.5) * 0.14, Math.sin(a) * 2.2).multiplyScalar(spread);
        } else {
            const a = i * 0.4 + t;
            const r = 1.6 + Math.sin(t * 0.7 + i) * 0.35;
            node.userData.target.set(Math.cos(a) * r, Math.sin(a * 1.4) * 1.5, Math.sin(a) * r).multiplyScalar(spread);
        }
    }

    if (mode === "Analysis" && Math.random() < 0.005) {
        queueAiMessage("Analyzing structure... Optimizing configuration...");
    }
}

function updateNodes(delta, t) {
    applyModeTargets(t);

    let snapCount = 0;

    for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const data = node.userData;
        const grabbed = state.grab.active && state.grab.kind === "node" && state.grab.index === i;

        if (!grabbed) {
            const pull = data.target.clone().sub(node.position).multiplyScalar(3.2 * delta);
            data.velocity.add(pull);

            // Magnetic snap: when close to its intended molecular slot, snap firmly.
            const scaledSlot = data.slot.clone().multiplyScalar(state.atomSpread.current);
            const slotDist = node.position.distanceTo(scaledSlot);
            if (slotDist < 0.32) {
                node.position.lerp(scaledSlot, 1 - Math.exp(-delta * 16));
                data.velocity.multiplyScalar(0.8);
                snapCount += 1;
            }

            // Predictive drift adds subtle AI-driven autonomous movement.
            data.velocity.x += Math.sin(t * 0.8 + i) * 0.00065;
            data.velocity.y += Math.cos(t * 0.7 + i * 0.6) * 0.00065;
            data.velocity.z += Math.sin(t * 0.9 + i * 0.4) * 0.00065;
        }

        data.velocity.multiplyScalar(0.93);
        node.position.add(data.velocity.clone().multiplyScalar(60 * delta));

        data.trail.push(node.position.clone());
        if (data.trail.length > 16) {
            data.trail.shift();
        }

        const positions = new Float32Array(data.trail.length * 3);
        data.trail.forEach((p, idx) => {
            positions[idx * 3] = p.x;
            positions[idx * 3 + 1] = p.y;
            positions[idx * 3 + 2] = p.z;
        });
        data.trailLine.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        data.trailLine.geometry.computeBoundingSphere();
    }

    if (snapCount > nodeCount - 3 && !state.grab.active && Math.random() < 0.006) {
        queueAiMessage("Molecular matrix synchronized.");
    }
}

function updateLinks() {
    const segments = [];

    for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i].position;
            const b = nodes[j].position;
            if (a.distanceToSquared(b) < 2.3) {
                segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
            }
        }
    }

    linkGeom.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
    linkGeom.computeBoundingSphere();
}

function animateHudStats(t) {
    const pulse = (Math.sin(t * 1.9) + 1) * 0.5;
    energyValue.textContent = `${Math.round(60 + pulse * 35)}%`;
    fluxValue.textContent = `${(1.8 + pulse * 1.4).toFixed(2)}THz`;
    analysisValue.textContent = `${(84 + pulse * 15).toFixed(1)}%`;

    stabilityValue.textContent = pulse > 0.7 ? "Optimal" : pulse < 0.2 ? "Balancing" : "Nominal";
    networkValue.textContent = ["Synced", "Secured", "Routing"][Math.floor((t * 0.6) % 3)];
    targetValue.textContent = ["Locked", "Acquiring", "Tracking"][Math.floor((t * 0.8) % 3)];
}

function animateScene(now) {
    const t = now * 0.001;
    const delta = Math.min(0.035, clock.getDelta());

    analyzeHandGestures(now);
    updateGrabInteraction(delta);
    state.atomSpread.current = THREE.MathUtils.lerp(
        state.atomSpread.current,
        state.atomSpread.target,
        1 - Math.exp(-delta * 7)
    );
    if (centerRingsEl) {
        const currentScale = Number(centerRingsEl.dataset.scale || "1");
        const nextScale = THREE.MathUtils.lerp(currentScale, state.zoom.ringScale, 1 - Math.exp(-delta * 10));
        centerRingsEl.dataset.scale = String(nextScale);
        centerRingsEl.style.transform = `translate(-50%, -50%) scale(${nextScale.toFixed(3)})`;
    }

    if (state.collapsed) {
        // Keep atoms visible even in collapse mode so content remains controllable/showable.
        coreRoot.scale.lerp(new THREE.Vector3(0.55, 0.55, 0.55), 1 - Math.exp(-delta * 8));
    } else {
        const target = state.zoom.targetScale * (state.systemActive ? 1 : 0.06);
        const v = new THREE.Vector3(target, target, target);
        coreRoot.scale.lerp(v, 1 - Math.exp(-delta * 6));
    }

    updateNodes(delta, t);
    updateLinks();

    coreSphere.rotation.y += delta * 0.65;
    shell.rotation.x += delta * 0.45;
    shell.rotation.y += delta * 0.5;
    orbitRing.rotation.z += delta * 0.9;
    atomHalo.rotation.x += delta * 0.25;
    atomHalo.rotation.y += delta * 0.35;
    atomHalo.material.opacity = 0.42 + Math.abs(Math.sin(t * 1.6)) * 0.28;

    // Inertia + float for cinematic motion.
    if (!state.grab.active) {
        coreRoot.position.x += (Math.sin(t * 0.9) * 0.35 - coreRoot.position.x) * 0.02;
        coreRoot.position.y += (Math.cos(t * 0.7) * 0.24 - coreRoot.position.y) * 0.02;
        coreRoot.rotation.y += delta * 0.42;
    }

    const pos = particleGeom.attributes.position;
    for (let i = 0; i < particleCount; i += 1) {
        const ix = i * 3;
        pos.array[ix + 1] += Math.sin(t + pSeeds[i]) * 0.0017;
        pos.array[ix] += Math.cos(t * 0.8 + pSeeds[i]) * 0.0012;
        if (pos.array[ix + 1] > 5) pos.array[ix + 1] = -5;
    }
    pos.needsUpdate = true;
    particles.rotation.y += delta * 0.07;

    bloomPass.strength = state.systemActive ? 1.02 : 0.35;
    bloomPass.radius = 0.42 + Math.sin(t * 0.8) * 0.08;

    animateHudStats(t);

    if (state.messageUntil < now && Math.random() < 0.0025) {
        queueAiMessage(["New element detected.", "Predictive stabilization engaged.", "Optimizing configuration..."][Math.floor(Math.random() * 3)]);
    }

    composer.render();
    requestAnimationFrame(animateScene);
}

const clock = new THREE.Clock();
function ensureSceneLoop() {
    if (state.sceneLoopStarted) {
        return;
    }
    state.sceneLoopStarted = true;
    requestAnimationFrame(animateScene);
}

window.__setHandsLandmarks = ingestExternalHands;
if (window.__latestHandsData) {
    ingestExternalHands(window.__latestHandsData.hands, window.__latestHandsData.handedness);
}

function tryBootFromCamera() {
    if (video && video.srcObject && video.readyState >= 2 && !video.paused) {
        state.cameraReady = true;
        bootSystemOnce();
        ensureSceneLoop();
        if (!handRuntime.running) {
            try {
                setTracking("TRACKING: INITIALIZING HAND MODEL");
                startHandsFromVideo(video);
            } catch (err) {
                state.handTrackingFailed = true;
                state.handsReady = false;
                setTracking("TRACKING: ERROR");
                showHandTrackingError(err);
            }
        }
    }
}

video?.addEventListener("playing", tryBootFromCamera);
window.addEventListener("camera-connected", tryBootFromCamera);
window.__onCameraConnected = () => {
    state.cameraReady = true;
    tryBootFromCamera();
};
if (window.__cameraReady) {
    state.cameraReady = true;
    tryBootFromCamera();
}

// Fallback poll in case playback starts before listeners are attached.
const bootPoll = setInterval(() => {
    tryBootFromCamera();
    if (state.systemBooted && handRuntime.running) {
        clearInterval(bootPoll);
    }
}, 600);
