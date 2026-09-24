/* Live pipeline lab — YOLO/VadCLIP/Qwen path only. No forced runScenario. */

import { config, mjpegUrl, wsUrl } from './config.js';

const MINOR_AT = 0.55;
const SEVERE_AT = 0.80;
const CAMERA = 'cam-01';

const el = {
  ws: document.getElementById('ws-status'),
  vision: document.getElementById('vision-hint'),
  reset: document.getElementById('btn-reset'),
  mjpeg: document.getElementById('mjpeg'),
  canvas: document.getElementById('overlay'),
  boxCount: document.getElementById('box-count'),
  tracks: document.getElementById('track-list'),
  scores: document.getElementById('scores'),
  dispatch: document.getElementById('dispatch'),
  dispatchState: document.getElementById('dispatch-state'),
  dispatchDetail: document.getElementById('dispatch-detail'),
  transcript: document.getElementById('transcript'),
  tools: document.getElementById('tools'),
  draft: document.getElementById('broadcast-draft'),
  broadcastStatus: document.getElementById('broadcast-status'),
  approve: document.getElementById('btn-approve'),
};

const ctx = el.canvas.getContext('2d');
let ws = null;
let activeIncidentId = null;
let broadcastApproved = false;
let gotOverlay = false;

function setPill(node, text, kind) {
  node.textContent = text;
  node.className = `pill pill--${kind}`;
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function connect() {
  ws = new WebSocket(wsUrl());
  ws.addEventListener('open', () => {
    setPill(el.ws, 'WS connected', 'on');
    send({ cmd: 'start' });
  });
  ws.addEventListener('close', () => {
    setPill(el.ws, 'WS disconnected — retry…', 'off');
    setTimeout(connect, 2000);
  });
  ws.addEventListener('error', () => ws.close());
  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    onEvent(msg);
  });
}

function onEvent(msg) {
  switch (msg.type) {
    case 'overlay.boxes':
      if (msg.camera_id === CAMERA) {
        if (!gotOverlay) {
          gotOverlay = true;
          setPill(el.vision, 'live vision overlays', 'on');
        }
        drawBoxes(msg.boxes || []);
      }
      break;
    case 'incident.upsert':
      if (msg.incident) onIncident(msg.incident);
      break;
    case 'call.transcript_delta':
      appendTurn(msg);
      break;
    case 'tool.call_live':
      appendTool(msg);
      break;
    case 'health.strip':
      if (!gotOverlay && msg.frames_escalated > 0) {
        setPill(el.vision, `escalated=${msg.frames_escalated} (waiting boxes)`, 'hot');
      }
      break;
    default:
      break;
  }
}

function drawBoxes(boxes) {
  const w = el.canvas.width;
  const h = el.canvas.height;
  ctx.clearRect(0, 0, w, h);
  el.boxCount.textContent = `${boxes.length} box${boxes.length === 1 ? '' : 'es'}`;
  el.tracks.replaceChildren();

  for (const b of boxes) {
    const weaponish = /weapon|gun|firearm|fight|theft/i.test(b.label || '');
    const x = b.x * w;
    const y = b.y * h;
    const bw = b.w * w;
    const bh = b.h * h;
    ctx.strokeStyle = weaponish ? '#c47a00' : '#5ec8ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bw, bh);
    const score = b.score != null ? ` ${(Number(b.score) * 100).toFixed(0)}%` : '';
    const label = `${b.track_id} ${b.label || 'obj'}${score}`;
    ctx.font = '600 14px "IBM Plex Mono", monospace';
    ctx.fillStyle = weaponish ? '#c47a00' : '#5ec8ff';
    ctx.fillText(label, x + 4, Math.max(14, y - 4));

    const li = document.createElement('li');
    if (weaponish) li.classList.add('is-weapon');
    li.textContent = label.trim();
    el.tracks.append(li);
  }
}

function onIncident(inc) {
  activeIncidentId = inc.incident_id;
  const fused = Number(inc.fused_prob ?? 0);
  const router = Number(inc.router_score ?? 0);
  const severe = fused >= SEVERE_AT || inc.severity === 'SEVERE';
  const pct = Math.max(0, Math.min(1, fused)) * 100;
  const rules = Array.isArray(inc.rules_fired) ? inc.rules_fired.join(', ') : '';
  const liveTag = /zrt-live/i.test(inc.description || '') ? 'Qwen live' : (/zrt-forced/i.test(inc.description || '') ? 'forced fallback' : 'unknown');

  el.scores.className = 'scores';
  el.scores.innerHTML = `
    <dl>
      <dt>class (VLM)</dt><dd>${esc(inc.class_token || '?')}</dd>
      <dt>classify</dt><dd>${esc(liveTag)}</dd>
      <dt>track</dt><dd>${esc(inc.track_id || '?')} @ ${esc(inc.camera_id || '?')}</dd>
      <dt>router_score</dt><dd>${router.toFixed(3)}</dd>
      <dt>fused_prob</dt><dd>${fused.toFixed(3)}</dd>
      <dt>severity</dt><dd>${esc(inc.severity || '?')}</dd>
      <dt>rules / vad</dt><dd>${esc(rules || '—')}</dd>
      <dt>minor_at</dt><dd>${MINOR_AT.toFixed(2)}</dd>
      <dt>severe_at</dt><dd>${SEVERE_AT.toFixed(2)}</dd>
    </dl>
    <div class="meter" aria-label="fused probability">
      <div class="meter__fill${severe ? ' is-severe' : ''}" style="width:${pct}%"></div>
      <div class="meter__marks">
        <span class="meter__mark" style="left:${MINOR_AT * 100}%" title="minor"></span>
        <span class="meter__mark" style="left:${SEVERE_AT * 100}%" title="severe"></span>
      </div>
    </div>
    <div class="meter__legend"><span>0</span><span>minor ${MINOR_AT}</span><span>severe ${SEVERE_AT}</span><span>1</span></div>
  `;

  if (severe) {
    setDispatch('CALLING 911', `SEVERE · ${inc.class_token} · ${liveTag}`, 'calling');
    draftBroadcast(inc);
  } else if (inc.severity === 'MINOR') {
    setDispatch('MINOR', 'Logged — no 911 auto-dial', 'idle');
  }
}

function setDispatch(state, detail, kind) {
  el.dispatch.className = `dispatch dispatch--${kind}`;
  el.dispatchState.textContent = state;
  el.dispatchDetail.textContent = detail;
}

function draftBroadcast(inc) {
  if (broadcastApproved) return;
  const text = [
    'SECURITY BROADCAST DRAFT (human approval required)',
    `Class: ${inc.class_token}`,
    `Location: ${inc.location_text || inc.camera_id}`,
    `Person: ${inc.person_description || 'unknown'}`,
    `Camera: ${inc.camera_id} · track ${inc.track_id}`,
    `Fused: ${(Number(inc.fused_prob) || 0).toFixed(3)} (severe≥${SEVERE_AT})`,
    `Path: ${inc.description || ''}`,
    '',
    'Proposed campus message:',
    `Campus security is responding to a ${inc.class_token} alert near ${inc.location_text || inc.camera_id}. Follow official instructions. This is not yet released to students.`,
  ].join('\n');
  el.draft.value = text;
  setPill(el.broadcastStatus, 'Awaiting security approval', 'hot');
  el.approve.disabled = false;
}

function appendTurn(msg) {
  if (activeIncidentId && msg.incident_id && msg.incident_id !== activeIncidentId) return;
  const row = document.createElement('div');
  const who = msg.speaker === 'dispatcher' ? 'dispatcher' : 'sentinel';
  row.className = `turn turn--${who}`;
  row.innerHTML = `<div class="turn__who">${who === 'dispatcher' ? '911' : 'Sentinel'}</div><div>${esc(msg.text || '')}</div>`;
  el.transcript.append(row);
  el.transcript.scrollTop = el.transcript.scrollHeight;
  setDispatch('ON CALL WITH 911', 'Live transcript (dispatcher stand-in)', 'calling');
}

function appendTool(msg) {
  if (activeIncidentId && msg.incident_id && msg.incident_id !== activeIncidentId) return;
  const row = document.createElement('div');
  row.className = 'tool';
  const spoken = (msg.result && (msg.result.spoken || msg.result.text)) || '';
  row.textContent = `tool:${msg.tool} → ${spoken || JSON.stringify(msg.result || {})}`;
  el.tools.append(row);
}

function clearUi() {
  activeIncidentId = null;
  broadcastApproved = false;
  el.transcript.replaceChildren();
  el.tools.replaceChildren();
  el.draft.value = '';
  el.approve.disabled = true;
  setPill(el.broadcastStatus, 'No draft', 'off');
  setDispatch('IDLE', 'SEVERE from live fuse starts 911 loop', 'idle');
  el.scores.className = 'scores scores--idle';
  el.scores.innerHTML = '<p class="muted">Waiting for live incident.upsert from vision bridge…</p>';
  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  el.tracks.replaceChildren();
  el.boxCount.textContent = '0 boxes';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

el.reset.addEventListener('click', clearUi);

el.approve.addEventListener('click', () => {
  if (el.approve.disabled) return;
  broadcastApproved = true;
  el.approve.disabled = true;
  setPill(el.broadcastStatus, 'Approved — campus notify queued (demo)', 'on');
  setDispatch('911 + CAMPUS QUEUE', 'Security approved broadcast (HITL)', 'done');
  el.draft.value += '\n\n[APPROVED by security — campus-wide send armed (demo only)]';
});

el.mjpeg.src = mjpegUrl(CAMERA);
connect();
console.info('[lab] live-only', config.API_BASE || '(same origin)', wsUrl());
