import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cameraStream } from "./js/transport.js";
import { restartAll } from "./js/cameraSources.js";
import { createStore } from "./js/store.js";
import { startAutoFollow } from "./js/ui/autofollow.js";

globalThis.requestAnimationFrame = (fn) => {
  fn();
  return 1;
};

let played = 0;
const video = { readyState: 1, currentTime: 12, play: () => (played += 1) };
const stream = {
  src: "http://zgx-b505:8080/mjpeg/cam-01",
  removeAttribute() {
    this.src = "";
  },
  setAttribute(_name, value) {
    this.src = value;
  },
};
globalThis.window = {
  __cameraVideos: new Map([["cam-04", video]]),
  __cameraStreams: new Map([["cam-01", stream]]),
};
restartAll();
assert.equal(video.currentTime, 0);
assert.equal(played, 1);
assert.equal(stream.src, "http://zgx-b505:8080/mjpeg/cam-01");

const store = createStore();
store.handle({ type: "camera.online", camera_id: "cam-01", online: true });
assert.equal(store.getState().cameras["cam-01"]?.online, true);

let onState = null;
const opened = [];
startAutoFollow(
  {
    subscribe(fn) {
      onState = fn;
      return () => {};
    },
    getActiveSevere() {
      return null;
    },
  },
  { open: (tab) => opened.push(tab) },
  null,
);
onState({
  demo: { autoFollow: false },
  call: { incidentId: "inc-1" },
  incidents: { "inc-1": { incident_id: "inc-1", state: "DISPATCHED" } },
  order: ["inc-1"],
});
assert.deepEqual(opened, ["call"]);

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
