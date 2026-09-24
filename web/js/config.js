/* Runtime configuration.
 *
 * The dashboard talks to services/api and nothing else. There is no mock
 * source any more — see js/bus.js.
 *
 * Indraneel: officer dashboard = index.html.
 * ZGX Tailscale IP below; override if your network differs.
 */

export const config = {
  /** Origin of services/api. Empty string = same origin as this page.
   *  Live lab / Mac: ZGX Tailscale. Same-host ZGX: also works as http://127.0.0.1:8080
   */
  API_BASE: 'http://100.83.170.35:8080',

  /** GET {API_BASE}{MJPEG_PATH}/{camera_id} — annotated MJPEG stream.
   *  services/api/server.py has clips for cam-01..cam-06 only. */
  MJPEG_PATH: '/mjpeg',

  /** WebSocket path carrying the contracts/events.py envelopes. */
  WS_PATH: '/ws',

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
