import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cameraStream } from "./js/transport.js";
import { createStore } from "./js/store.js";

globalThis.requestAnimationFrame = (fn) => {
  fn();
  return 1;
};

const store = createStore();
store.handle({ type: "camera.online", camera_id: "cam-01", online: true });
assert.equal(store.getState().cameras["cam-01"]?.online, true);

assert.deepEqual(cameraStream("cam-01", "ws://zgx-b505:8080/ws"), {
  kind: "mjpeg",
  url: "http://zgx-b505:8080/mjpeg/cam-01",
});
assert.deepEqual(cameraStream("cam-04", "wss://demo.example/ws"), {
  kind: "video",
  url: "https://demo.example/media/cam-04",
});
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
assert.match(html, /img-src[^;]*http:/);
assert.match(html, /media-src[^;]*http:/);

console.log("web self-check OK");
