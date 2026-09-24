/* Campus tracking map — twelve pins, trail, predicted next camera.
 *
 * The SVG viewBox is kept identical to the element's pixel size, so one user
 * unit is one CSS pixel. A fixed viewBox scaled with `meet` would shrink pin
 * numbers and building labels into illegibility in a short, wide panel.
 *
 * Camera coordinates are UI-only mock data (js/mock/fixtures.js). The real
 * data/camera_map.json is owned by the data owner and is still empty.
 */

import { h, mount, svg, clear } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';
import { BUILDINGS, CAMERAS } from '../mock/fixtures.js';

const PIN_W = 30;
const PIN_H = 19;
const PAD = 10;

export function createMap(root, store, { onSelectCamera }) {
  let svgEl;
  let wrapEl;
  let headRight;
  let W = 0;
  let H = 0;

  function renderHead() {
    const inc = store.selected();
    clear(headRight);

    if (inc) {
      const cam = CAMERAS.find((c) => c.id === inc.cameraId);
      headRight.append(h('span', { class: 'cam-chip' }, [
        h('span', { html: icons.pin }),
        `CAM ${cam ? cam.no : '--'}`,
      ]));
    }
  }

  /** Normalised 0..1 -> pixel, inset so pins never clip at the edges. */
  function pt(nx, ny) {
    const ix = PAD + PIN_W / 2;
    const iy = PAD + PIN_H / 2;
    return {
      x: ix + nx * Math.max(1, W - ix * 2),
      y: iy + ny * Math.max(1, H - iy * 2),
    };
  }

  function renderMap() {
    if (W < 40 || H < 40) return;

    const inc = store.selected();
    const trail = inc ? inc.trackPath : [];
    const activeId = inc ? inc.cameraId : null;
    const predictedId = inc ? inc.predictedNext : null;

    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    clear(svgEl);

    /* grid */
    const grid = svg('g', { class: 'map__grid' });
    const step = 58;
    for (let x = step; x < W; x += step) {
      grid.append(svg('line', { x1: x, y1: 0, x2: x, y2: H }));
    }
    for (let y = step; y < H; y += step) {
      grid.append(svg('line', { x1: 0, y1: y, x2: W, y2: y }));
    }
    svgEl.append(grid);

    /* buildings */
    for (const b of BUILDINGS) {
      const a = pt(b.x, b.y);
      const bw = b.w * W;
      const bh = b.h * H;
      svgEl.append(svg('rect', {
        class: 'map__bldg', x: a.x, y: a.y, width: bw, height: bh, rx: 3,
      }));
      // only label when the box can actually hold the text
      if (bw > 72 && bh > 20) {
        svgEl.append(svg('text', {
          class: 'map__bldg-label',
          x: a.x + bw / 2,
          y: a.y + bh / 2 + 3,
          'text-anchor': 'middle',
          text: b.label,
        }));
      }
    }

    /* trail through visited cameras, then on to the prediction */
    const trailPts = trail
      .map((id) => CAMERAS.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => pt(c.x, c.y));

    const predictedCam = predictedId ? CAMERAS.find((c) => c.id === predictedId) : null;
    const predictedPt = predictedCam ? pt(predictedCam.x, predictedCam.y) : null;
    const pathPts = predictedPt ? [...trailPts, predictedPt] : trailPts;

    if (pathPts.length > 1) {
      let d = `M ${pathPts[0].x} ${pathPts[0].y}`;
      for (let i = 1; i < pathPts.length; i += 1) {
        const prev = pathPts[i - 1];
        const cur = pathPts[i];
        const cx = (prev.x + cur.x) / 2;
        const cy = Math.min(prev.y, cur.y) - Math.min(30, H * 0.12);
        d += ` Q ${cx} ${cy} ${cur.x} ${cur.y}`;
      }
      svgEl.append(svg('path', { class: 'map__path', d }));
    }

    if (predictedPt) {
      svgEl.append(svg('circle', {
        class: 'map__predict', cx: predictedPt.x, cy: predictedPt.y, r: PIN_W * 0.8,
      }));
    }

    /* pins */
    for (const cam of CAMERAS) {
      const p = pt(cam.x, cam.y);
      const isActive = cam.id === activeId;
      const isPredicted = cam.id === predictedId;

      const g = svg('g', {
        class: `pin${isActive ? ' pin--active' : ''}${isPredicted ? ' pin--predicted' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `Camera ${cam.no}, ${cam.name}`
          + `${isActive ? ', active incident' : ''}`
          + `${isPredicted ? ', predicted next' : ''}`,
        onClick: () => onSelectCamera(cam.id),
        onKeydown: (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            onSelectCamera(cam.id);
          }
        },
      });

      g.append(svg('title', { text: `CAM ${cam.no} · ${cam.name}` }));
      g.append(svg('rect', {
        class: 'pin__body',
        x: p.x - PIN_W / 2, y: p.y - PIN_H / 2,
        width: PIN_W, height: PIN_H, rx: 3,
      }));
      g.append(svg('text', {
        class: 'pin__text',
        x: p.x, y: p.y + 3.5,
        'text-anchor': 'middle',
        text: cam.no,
      }));

      svgEl.append(g);
    }
  }

  /** Measure the SVG itself. It is absolutely positioned, so reading its box
   *  and writing its viewBox cannot influence the surrounding layout. */
  function measure() {
    const r = svgEl.getBoundingClientRect();
    const nw = Math.round(r.width);
    const nh = Math.round(r.height);
    if (nw === W && nh === H) return false;
    W = nw;
    H = nh;
    return true;
  }

  headRight = h('div', { class: 'panel__head-r' });
  svgEl = svg('svg', {
    class: 'map-svg',
    role: 'img',
    'aria-label': 'Campus map showing camera locations, the tracked path and the predicted next camera',
  });
  wrapEl = h('div', { class: 'map-wrap' }, [svgEl]);

  mount(root,
    h('div', { class: 'panel__head' }, [
      h('div', { class: 'panel__head-l' }, [
        h('div', { class: 'eyebrow', text: 'Live location' }),
        h('h2', { class: 'panel__title', id: 'map-title', text: 'Campus tracking' }),
      ]),
      headRight,
    ]),
    h('div', { class: 'panel__body panel__body--flush map-body' }, [
      wrapEl,
      h('div', { class: 'map__legend' }, [
        h('span', {}, [h('i', { style: 'background:var(--critical)' }), 'Active']),
        h('span', {}, [h('i', { style: 'background:var(--high)' }), 'Predicted next']),
        h('span', {}, [h('i', { style: 'background:var(--accent)' }), 'Online']),
      ]),
    ]),
  );

  renderHead();

  // size-driven redraw keeps one SVG unit equal to one pixel
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (measure()) renderMap();
    }).observe(svgEl);
  } else {
    window.addEventListener('resize', () => {
      if (measure()) renderMap();
    });
  }

  requestAnimationFrame(() => {
    measure();
    renderMap();
  });

  store.subscribe((_state, kind) => {
    if (kind === Change.SELECTION || kind === Change.INCIDENTS) {
      renderHead();
      renderMap();
    }
    // the map is revealed again when the call console closes
    if (kind === Change.CALL) {
      requestAnimationFrame(() => {
        if (measure()) renderMap();
      });
    }
  });
}
