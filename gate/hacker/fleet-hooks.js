"use strict";
// Runs BEFORE the fleet console scripts. It does not change them. It only lets the demo
//  1. see the console's controller worker, so every dispatch order can pass through the gate, and
//  2. receive the console's Three.js scene and camera, so the hacker and gate can be drawn in the same clinic.
(function () {
  const H = window.RWHooks = {worker: null, rawPost: null, env: null, gateCommand: null};
  const RealWorker = window.Worker;
  if (RealWorker) {
    const Wrapped = function (url, options) {
      const w = new RealWorker(url, options);
      const raw = w.postMessage.bind(w);
      H.worker = w; H.rawPost = raw;
      w.postMessage = function (msg, transfer) {
        if (H.gateCommand && msg && msg.type === "command" && msg.command) return H.gateCommand(msg, () => raw(msg, transfer));
        return raw(msg, transfer);
      };
      return w;
    };
    Wrapped.prototype = RealWorker.prototype;
    window.Worker = Wrapped;
  }
  let real = null, wrapped = null;
  Object.defineProperty(window, "makeFleetScene", {
    configurable: true,
    get() { return wrapped; },
    set(fn) {
      real = fn;
      wrapped = function (args) { H.env = args; const out = real.call(this, args); window.dispatchEvent(new CustomEvent("rwdemo:scene")); return out; };
    }
  });
})();
