export async function ensureActiveServiceWorker(scriptUrl = "/sw.js") {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }

  const registration = await navigator.serviceWorker.register(scriptUrl, { scope: "/" });

  if (registration.installing) {
    await new Promise<void>((resolve, reject) => {
      const worker = registration.installing;
      if (!worker) {
        resolve();
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" || worker.state === "activated") resolve();
        if (worker.state === "redundant") reject(new Error("Service worker failed to install."));
      });
    });
  }

  if (registration.waiting) {
    registration.waiting.postMessage?.({ type: "SKIP_WAITING" });
    registration.waiting.addEventListener("statechange", () => {
      // activated via clients.claim in sw.js
    });
  }

  const ready = await navigator.serviceWorker.ready;
  if (!ready.active) {
    throw new Error("Service worker is still starting. Wait a second and try again.");
  }
  return ready;
}

export function base64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...decoded].map((character) => character.charCodeAt(0)));
}
