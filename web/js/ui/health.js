/* Health strip — four tiles.
 *
 * Every value here moves. The GPU load and p95 latency tiles were removed:
 * DemoHub._health() in services/api/hub.py publishes gpu_util=0.68 and
 * p95_ms=182.0 as literal constants on every tick, so those tiles read like
 * live telemetry while reporting nothing. No GPU or latency measurement exists
 * anywhere in the service yet. Put them back when it does.
 *
 * The screened rate and the escalation percentage are derived in the browser;
 * neither is on the wire.
 */

import { h, mount, fmtInt, fmtPctValue } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';

export function createHealthStrip(root, store) {
  let prev = null;
  let ratePerSec = 0;

  function tile({ icon, label, value, unit, tone }) {
    return h('div', { class: `htile${tone ? ` htile--${tone}` : ''}` }, [
      h('span', { class: 'htile__icon', html: icon }),
      h('div', { class: 'htile__body' }, [
        h('div', { class: 'htile__label', text: label }),
        h('div', { class: 'htile__value' }, [
          value,
          unit ? h('span', { class: 'htile__unit', text: unit }) : null,
        ]),
      ]),
    ]);
  }

  function render() {
    const state = store.getState();
    const hs = state.health;

    if (!hs) {
      mount(root, tile({
        icon: icons.activity,
        label: 'Status',
        value: 'waiting',
        unit: 'for events',
      }));
      return;
    }

    const allCamsUp = hs.camerasOnline === hs.camerasTotal;

    mount(root,
      tile({
        icon: icons.camera,
        label: 'Cameras',
        value: `${hs.camerasOnline} / ${hs.camerasTotal}`,
        unit: 'online',
        tone: allCamsUp ? 'ok' : 'warn',
      }),
      tile({
        icon: icons.chip,
        label: 'Models',
        value: hs.modelsResident ? 'Resident' : 'Loading',
        unit: '',
        tone: hs.modelsResident ? 'ok' : 'warn',
      }),
      tile({
        icon: icons.scan,
        label: 'Frames screened',
        value: fmtInt(hs.framesScreened),
        unit: state.paused ? 'paused' : `+${ratePerSec}/s`,
      }),
      tile({
        icon: icons.bolt,
        label: 'Escalated',
        value: fmtInt(hs.framesEscalated),
        unit: fmtPctValue(hs.escalationPct),
      }),
    );
  }

  function recomputeRate() {
    const hs = store.getState().health;
    if (!hs) return;

    if (prev && hs.ts && prev.ts) {
      const dt = (hs.ts.getTime() - prev.ts.getTime()) / 1000;
      if (dt > 0) {
        ratePerSec = Math.round((hs.framesScreened - prev.framesScreened) / dt);
      }
    }
    prev = { framesScreened: hs.framesScreened, ts: hs.ts };
  }

  store.subscribe((_state, kind) => {
    if (kind === Change.HEALTH) {
      recomputeRate();
      render();
    } else if (kind === Change.DEMO) {
      render();
    }
  });

  render();
}
