/* Campus tracking map — six pins, positioned from real coordinates.
 *
 * The SVG viewBox is kept identical to the element's pixel size, so one user
 * unit is one CSS pixel. A fixed viewBox scaled with `meet` would shrink pin
 * numbers into illegibility in a short, wide panel.
 *
 * Pin positions come from js/cameras.js, which projects the lat/lon in
 * data/camera_map.json onto this panel. Relative geography is real; absolute
 * scale is not meaningful.
 *
 * No movement trail and no predicted-next ring: nothing on the wire carries
 * either. `track_path` and `predicted_next` were mock-only fields, and no
 * service computes a camera-to-camera prediction. The map shows where the
 * cameras are and which one holds the selected incident.
 */

import { h, mount, svg, clear } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';
import { CAMERAS, cameraById } from '../cameras.js';

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
      const cam = cameraById(inc.cameraId);
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
    const activeId = inc ? inc.cameraId : null;

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

    /* pins */
    for (const cam of CAMERAS) {
      const p = pt(cam.x, cam.y);
      const isActive = cam.id === activeId;

      const g = svg('g', {
        class: `pin${isActive ? ' pin--active' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `Camera ${cam.no}, ${cam.name}`
          + `${isActive ? ', active incident' : ''}`,
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
    'aria-label': 'Campus map showing camera locations and which camera holds the selected incident',
  });
  wrapEl = h('div', { class: 'map-wrap' }, [svgEl]);

  mount(root,
    h('div', { class: 'panel__head' }, [
      h('div', { class: 'panel__head-l' }, [
        h('div', { class: 'eyebrow', text: 'Camera locations' }),
        h('h2', { class: 'panel__title', id: 'map-title', text: 'Campus map' }),
      ]),
      headRight,
    ]),
    h('div', { class: 'panel__body panel__body--flush map-body' }, [
      wrapEl,
      h('div', { class: 'map__legend' }, [
        h('span', {}, [h('i', { style: 'background:var(--critical)' }), 'Active incident']),
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
