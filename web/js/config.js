/* Runtime configuration.
 *
 * SOURCE is the single switch between the mock emitter and the real
 * services/api websocket. Nothing else in the UI needs to change when
 * api/ lands — see js/bus.js.
 */

export const config = {
  /** 'mock' drives the UI from js/mock/emitter.js. 'live' opens a websocket. */
  SOURCE: 'mock',

  /** Origin of services/api. Empty string = same origin as this page. */
  API_BASE: '',

  /** GET {API_BASE}{MJPEG_PATH}/{camera_id} — annotated MJPEG stream. */
  MJPEG_PATH: '/mjpeg',

  /** WebSocket path carrying the contracts/events.py envelopes. */
  WS_PATH: '/ws',

  /** Mock cadence. */
  HEALTH_TICK_MS: 1000,
  OVERLAY_TICK_MS: 400,

  /** Frames screened per second, used for the derived "+N/s" readout. */
  FRAMES_PER_SEC: 30,

  /** Toast dwell time. */
  TOAST_MS: 3200,
};

export function mjpegUrl(cameraId) {
  return `${config.API_BASE}${config.MJPEG_PATH}/${encodeURIComponent(cameraId)}`;
}

export function wsUrl() {
  if (config.API_BASE) {
    return config.API_BASE.replace(/^http/, 'ws') + config.WS_PATH;
  }
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${config.WS_PATH}`;
}
