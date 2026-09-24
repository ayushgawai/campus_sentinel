/* Camera wall — six panes with server-drawn overlays.
 *
 * Each pane points at /mjpeg/{camera_id} on services/api. When that request
 * fails the pane stays dark and shows a "no feed" tag.
 *
 * It used to draw a synthetic night-campus scene into a canvas instead, which
 * made a broken feed look like a working one. /mjpeg depends on ffmpeg being
 * installed and on CS_MEDIA_ROOT resolving to the clip pack, so a dead stream
 * is a real state that needs to be visible, not painted over.
 *
 * Overlay boxes are drawn from overlay.boxes either way, so a pane still shows
 * the router working even with no video behind it.
 */

import { h, mount, clear, fmtScore } from './dom.js';
import { icons } from './icons.js';
import { mjpegUrl } from '../config.js';
import { Change } from '../store.js';
import { CAMERAS } from '../cameras.js';

export function createWall(root, store, { onTogglePause }) {
  /** cameraId -> { pane, overlay, tracked, router, expandBtn, cam } */
  const panes = new Map();
  let headRight;
  let gridEl;

  const wallCameras = CAMERAS.filter((c) => c.onWall);

  function buildPane(cam) {
    const offline = h('div', { class: 'pane__offline', text: 'connecting…' });

    const media = h('img', {
      class: 'pane__media',
      alt: '',
      hidden: true,
      decoding: 'async',
    });

    media.addEventListener('load', () => {
      media.hidden = false;
      offline.hidden = true;
    });
    media.addEventListener('error', () => {
      media.hidden = true;
      offline.hidden = false;
      offline.textContent = 'no feed';
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
      media,
      offline,
      overlay,
      h('span', { class: 'pane__label', text: `CAM ${cam.no}` }),
      h('span', { class: 'pane__loc', text: cam.location }),
      h('div', { class: 'pane__foot' }, [tracked, router]),
      expandBtn,
    ]);

    panes.set(cam.id, { pane, overlay, tracked, router, expandBtn, cam });
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

  wallCameras.forEach((cam) => buildPane(cam));

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
}
