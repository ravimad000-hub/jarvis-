(() => {
  function showFatal(message) {
    const box = document.createElement("div");
    box.style.cssText = [
      "position: fixed",
      "z-index: 999999",
      "top: 20px",
      "left: 20px",
      "right: 20px",
      "background: red",
      "color: white",
      "padding: 20px",
      "font: 20px monospace"
    ].join(";");
    box.textContent = message;
    document.body.appendChild(box);
  }

  async function startCamera() {
    const video = document.getElementById("camera");
    const status = document.getElementById("cameraStatus");

    try {
      if (!video) throw new Error("No #camera video element found");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia not available. Use Chrome/Edge on localhost.");
      }

      console.log("Requesting camera...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: false
      });

      console.log("Stream received", stream.getVideoTracks());

      video.srcObject = stream;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;

      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      await video.play();

      console.log("Video size:", video.videoWidth, video.videoHeight);

      if (status) status.textContent = "CAMERA: CONNECTED";
      document.body.classList.add("camera-connected");
      window.__cameraReady = true;
      window.__cameraVideo = video;
      if (typeof window.__onCameraConnected === "function") {
        window.__onCameraConnected(video);
      }
      window.dispatchEvent(new Event("camera-connected"));
    } catch (err) {
      console.error("CAMERA FAILED:", err);
      if (status) status.textContent = "CAMERA: FAILED";
      showFatal("CAMERA FAILED: " + err.name + " - " + err.message);
    }
  }

  window.startCamera = startCamera;
  document.addEventListener("DOMContentLoaded", startCamera);
  document.getElementById("cameraTestBtn")?.addEventListener("click", startCamera);
})();
