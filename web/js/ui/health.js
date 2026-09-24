/* Health strip — six tiles.
 *
 * Only cameras/models/gpu_util/p95_ms/frames_screened/frames_escalated come
 * off the wire. The screened rate and the escalation percentage are derived
 * here; the model count and chip temperature are optional extras that the
 * mock supplies and the real api will not, so both degrade quietly.
 */

import { h, mount, fmtInt, fmtPct, fmtPctValue } from './dom.js';
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

    // models: prefer the mock's count, fall back to the contract boolean
    const modelsValue = hs.modelsCount !== null ? String(hs.modelsCount) : '';
    const modelsUnit = hs.modelsResident
      ? (hs.modelsCount !== null ? 'resident' : 'RESIDENT')
      : 'loading';

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
        value: modelsValue,
        unit: modelsUnit,
        tone: hs.modelsResident ? 'ok' : 'warn',
      }),
      tile({
        icon: icons.gauge,
        label: 'GPU load',
        value: fmtPct(hs.gpuUtil),
        // chip temperature is a mock-only extra
        unit: hs.gpuTempC !== null ? `${hs.gpuTempC}°C` : '',
        tone: hs.gpuUtil > 0.9 ? 'warn' : null,
      }),
      tile({
        icon: icons.activity,
        label: 'p95 latency',
        value: fmtInt(hs.p95Ms),
        unit: 'ms',
        tone: hs.p95Ms > 220 ? 'warn' : null,
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
