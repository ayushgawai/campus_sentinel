import assert from "node:assert/strict";

import { cameraStream } from "./js/transport.js";

assert.deepEqual(cameraStream("cam-01", "ws://zgx-b505:8080/ws"), {
  kind: "mjpeg",
  url: "http://zgx-b505:8080/mjpeg/cam-01",
});
assert.deepEqual(cameraStream("cam-04", "wss://demo.example/ws"), {
  kind: "video",
  url: "https://demo.example/media/cam-04",
});

console.log("web self-check OK");
