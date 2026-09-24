/* Health strip — six tiles, every value measured.
 *
 * GPU load and p95 latency are back now that services/api/telemetry.py samples
 * them for real: nvidia-smi for GPU, a rolling window of router step durations
 * for p95. Both arrive as null when there is nothing to measure — no NVIDIA GPU
 * on the host, or no router step timed yet — and a null renders as a dash. It
 * must never render as 0%, which would read as an idle GPU rather than a
 * missing reading.
 *
 * The screened rate and the escalation percentage are derived in the browser;
 * neither is on the wire.
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
        icon: icons.chip,
        label: 'GPU load',
        // null = nvidia-smi unreadable on this host, not a zero reading.
        value: hs.gpuUtil === null ? '—' : fmtPct(hs.gpuUtil),
        unit: hs.gpuUtil === null ? 'no reading' : '',
      }),
      tile({
        icon: icons.activity,
        label: 'Router p95',
        // null = no router step measured yet (scenario mode, or just booted).
        value: hs.p95Ms === null ? '—' : Math.round(hs.p95Ms).toLocaleString('en-US'),
        unit: hs.p95Ms === null ? 'no samples' : 'ms',
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
