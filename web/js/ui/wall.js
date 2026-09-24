/* Camera wall — six panes with server-drawn overlays.
 *
 * Each pane points at the future MJPEG endpoint on services/api and falls
 * back to a locally drawn placeholder the moment that request fails, which
 * is always the case today. Overlay boxes animate either way, so the pane
 * still shows the router working.
 */

import { h, mount, clear, fmtScore } from './dom.js';
import { icons } from './icons.js';
import { mjpegUrl } from '../config.js';
import { Change } from '../store.js';
import { CAMERAS } from '../mock/fixtures.js';

/** Deterministic per-camera jitter for the placeholder scene. */
function seeded(n) {
  let a = (n * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic night-campus frame so a pane is never an empty black box. */
function drawPlaceholder(canvas, index) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const hgt = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = w * dpr;
  canvas.height = hgt * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rand = seeded(index + 7);

  // sky / far wall
  const sky = ctx.createLinearGradient(0, 0, 0, hgt);
  sky.addColorStop(0, '#16202b');
  sky.addColorStop(0.55, '#121a23');
  sky.addColorStop(1, '#0c1218');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hgt);

  const horizon = hgt * (0.40 + rand() * 0.10);

  // building blocks along the horizon
  let x = -10;
  while (x < w + 10) {
    const bw = 22 + rand() * 46;
    const bh = 14 + rand() * 40;
    ctx.fillStyle = '#1b2632';
    ctx.fillRect(x, horizon - bh, bw, bh);

    // lit windows
    const cols = Math.max(1, Math.floor(bw / 13));
    for (let c = 0; c < cols; c += 1) {
      if (rand() > 0.62) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(226,196,120,.32)' : 'rgba(150,180,210,.18)';
        ctx.fillRect(x + 4 + c * 12, horizon - bh + 5 + rand() * (bh - 12), 5, 4);
      }
    }
    x += bw + 3 + rand() * 10;
  }

  // ground
  const ground = ctx.createLinearGradient(0, horizon, 0, hgt);
  ground.addColorStop(0, '#141c25');
  ground.addColorStop(1, '#0a1015');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, hgt - horizon);

  // walkway edges in perspective
  ctx.strokeStyle = 'rgba(140,170,200,.10)';
  ctx.lineWidth = 1;
  const vpx = w * (0.35 + rand() * 0.3);
  for (const off of [-0.55, -0.2, 0.2, 0.55]) {
    ctx.beginPath();
    ctx.moveTo(vpx + off * w * 0.25, horizon);
    ctx.lineTo(vpx + off * w * 1.7, hgt);
    ctx.stroke();
  }

  // lamp pools
  for (let i = 0; i < 3; i += 1) {
    const lx = w * (0.15 + i * 0.32 + rand() * 0.06);
    const ly = horizon + (hgt - horizon) * (0.25 + rand() * 0.5);
    const pool = ctx.createRadialGradient(lx, ly, 2, lx, ly, 40 + rand() * 30);
    pool.addColorStop(0, 'rgba(232,208,150,.14)');
    pool.addColorStop(1, 'rgba(232,208,150,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(lx, ly, 46 + rand() * 30, 0, Math.PI * 2);
    ctx.fill();
  }

  // sensor grain
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < (w * hgt) / 180; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000';
    ctx.fillRect(rand() * w, rand() * hgt, 1, 1);
  }
  ctx.globalAlpha = 1;

  // vignette
  const vig = ctx.createRadialGradient(w / 2, hgt / 2, Math.min(w, hgt) * 0.25,
    w / 2, hgt / 2, Math.max(w, hgt) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, hgt);
}

export function createWall(root, store, { onTogglePause }) {
  /** cameraId -> { pane, overlay, foot: {tracked, router}, canvas, index } */
  const panes = new Map();
  let headRight;
  let gridEl;

  const wallCameras = CAMERAS.filter((c) => c.onWall);

  function buildPane(cam, index) {
    const canvas = h('canvas', { class: 'pane__canvas', 'aria-hidden': 'true' });

    const offline = h('div', {
      class: 'pane__offline',
      text: 'placeholder feed',
    });

    const media = h('img', {
      class: 'pane__media',
      alt: '',
      hidden: true,
      decoding: 'async',
    });

    // Try the real annotated stream; fall back the instant it fails.
    media.addEventListener('load', () => {
      media.hidden = false;
      canvas.style.display = 'none';
      offline.hidden = true;
    });
    media.addEventListener('error', () => {
      media.hidden = true;
      canvas.style.display = '';
      offline.hidden = false;
    });
    media.src = mjpegUrl(cam.id);

    const overlay = h('div', { class: 'pane__overlay' });
    const tracked = h('span', { text: '0 tracked' });
    const router = h('span', { text: 'ROUTER 0.00' });

    const expandBtn = h('button', {
      class: 'pane__expand',
      type: 'button',
      'aria-label': `Expand camera ${cam.no}, ${cam.name}`,
      onClick: (ev) => {
        ev.stopPropagation();
        store.toggleExpand(cam.id);
      },
    }, [h('span', { html: icons.expand, style: 'width:12px;height:12px;display:block' })]);

    const pane = h('div', {
      class: 'pane',
      dataset: { cameraId: cam.id },
      role: 'group',
      'aria-label': `Camera ${cam.no}, ${cam.name}`,
    }, [
      canvas,
      media,
      offline,
      overlay,
      h('span', { class: 'pane__label', text: `CAM ${cam.no}` }),
      h('span', { class: 'pane__loc', text: cam.name }),
      h('div', { class: 'pane__foot' }, [tracked, router]),
      expandBtn,
    ]);

    panes.set(cam.id, { pane, overlay, tracked, router, canvas, index, expandBtn, cam });
    return pane;
  }

  function renderHead() {
    const state = store.getState();
    const online = wallCameras.filter((c) => state.cameras.get(c.id)?.online !== false).length;
    const allUp = online === wallCameras.length;
    const expanded = state.expandedCameraId;

    clear(headRight);

    headRight.append(
      h('span', { class: `nominal${allUp ? '' : ' nominal--warn'}` }, [
        h('span', { html: allUp ? icons.check : icons.alert }),
        `${online} feed${online === 1 ? '' : 's'} ${allUp ? 'nominal' : 'degraded'}`,
      ])
    );

    if (expanded) {
      headRight.append(h('button', {
        class: 'panelbtn',
        type: 'button',
        'aria-label': 'Back to all six cameras',
        onClick: () => store.toggleExpand(expanded),
      }, [h('span', { html: icons.grid })]));
    }

    headRight.append(h('button', {
      class: 'panelbtn',
      type: 'button',
      'aria-pressed': String(state.paused),
      'aria-label': state.paused ? 'Resume camera feeds' : 'Pause camera feeds',
      onClick: () => onTogglePause(),
    }, [
      h('span', { html: state.paused ? icons.play : icons.pause }),
      h('span', { class: 'panelbtn__text', text: state.paused ? 'Paused' : 'Live' }),
    ]));
  }

  function renderGrid() {
    const { expandedCameraId } = store.getState();
    const shown = expandedCameraId
      ? wallCameras.filter((c) => c.id === expandedCameraId)
      : wallCameras;

    gridEl.className = `wall${expandedCameraId ? ' wall--expanded' : ''}`;
    clear(gridEl);

    for (const cam of shown) {
      const entry = panes.get(cam.id);
      gridEl.append(entry.pane);
      entry.expandBtn.setAttribute(
        'aria-label',
        expandedCameraId
          ? `Shrink camera ${cam.no}, ${cam.name}`
          : `Expand camera ${cam.no}, ${cam.name}`
      );
      clear(entry.expandBtn);
      entry.expandBtn.append(h('span', {
        html: expandedCameraId ? icons.shrink : icons.expand,
        style: 'width:12px;height:12px;display:block',
      }));
    }

    // A ResizeObserver per canvas handles the real draw. This nudge covers the
    // first paint, where the element may not have been measured yet.
    requestAnimationFrame(() => {
      for (const cam of shown) {
        const entry = panes.get(cam.id);
        drawPlaceholder(entry.canvas, entry.index);
      }
    });
  }

  function renderOverlays() {
    const state = store.getState();
    const alerting = store.alertingTracks();

    for (const [cameraId, entry] of panes) {
      const ov = state.overlays.get(cameraId);
      const alertTracks = alerting.get(cameraId);
      const paneAlert = Boolean(alertTracks && alertTracks.size);

      entry.pane.classList.toggle('pane--alert', paneAlert);

      if (!ov) continue;

      entry.tracked.textContent = `${ov.tracked} tracked`;
      entry.router.textContent = `ROUTER ${fmtScore(ov.routerScore)}`;

      clear(entry.overlay);
      for (const box of ov.boxes) {
        const isAlert = Boolean(alertTracks && alertTracks.has(box.trackId));
        entry.overlay.append(h('div', {
          class: `bbox${isAlert ? ' bbox--alert' : ''}`,
          style: `left:${(box.x * 100).toFixed(2)}%;top:${(box.y * 100).toFixed(2)}%;`
            + `width:${(box.w * 100).toFixed(2)}%;height:${(box.h * 100).toFixed(2)}%`,
        }, [
          h('span', {
            class: 'bbox__tag',
            text: box.score !== null
              ? `${box.trackId} ${fmtScore(box.score)}`
              : box.trackId,
          }),
        ]));
      }
    }
  }

  /* ---------------- build ---------------- */

  headRight = h('div', { class: 'panel__head-r' });
  gridEl = h('div', { class: 'wall' });

  wallCameras.forEach((cam, i) => buildPane(cam, i));

  mount(root,
    h('div', { class: 'panel__head' }, [
      h('div', { class: 'panel__head-l' }, [
        h('div', { class: 'eyebrow', text: 'Live monitoring' }),
        h('h2', { class: 'panel__title', id: 'wall-title', text: 'Camera wall' }),
      ]),
      headRight,
    ]),
    h('div', { class: 'panel__body panel__body--flush' }, [gridEl]),
  );

  renderHead();
  renderGrid();
  renderOverlays();

  store.subscribe((_state, kind) => {
    if (kind === Change.OVERLAYS || kind === Change.INCIDENTS) renderOverlays();
    if (kind === Change.WALL) {
      renderGrid();
      renderHead();
      renderOverlays();
    }
    if (kind === Change.CAMERAS || kind === Change.DEMO) renderHead();
  });

  /* Redraw whenever a pane's box actually changes — covers first paint, window
   * resize, and the expand/collapse swap, none of which a single rAF catches
   * reliably. */
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const entry = [...panes.values()].find((p) => p.canvas === e.target);
        if (!entry) continue;
        const { width, height } = e.contentRect;
        if (width < 8 || height < 8) continue;
        if (entry.drawnW === Math.round(width) && entry.drawnH === Math.round(height)) continue;
        entry.drawnW = Math.round(width);
        entry.drawnH = Math.round(height);
        drawPlaceholder(entry.canvas, entry.index);
      }
    });
    for (const entry of panes.values()) ro.observe(entry.canvas);
  } else {
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        for (const entry of panes.values()) drawPlaceholder(entry.canvas, entry.index);
      }, 150);
    });
  }
}
