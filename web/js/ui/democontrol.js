/* Demo control bar — deterministic scenario runner.
 *
 * Playbook §11: the demo must be forceable to a known state on demand, so
 * scenario selection and reset are first-class controls, not a debug hack.
 */

import { h, mount, clear } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';
import { SCENARIOS } from '../mock/fixtures.js';

export function createDemoControl(root, store, { onRunScenario, onReset }) {
  let select;
  let prewarmEl;

  function renderPrewarm() {
    const { prewarmed } = store.getState();
    clear(prewarmEl);
    prewarmEl.className = `prewarm${prewarmed ? '' : ' prewarm--cold'}`;
    prewarmEl.append(
      h('span', { class: 'prewarm__dot', 'aria-hidden': 'true' }),
      prewarmed ? 'Models pre-warmed' : 'Models cold'
    );
  }

  select = h('select', {
    class: 'select',
    id: 'scenario-select',
    'aria-label': 'Scenario to stage',
  }, SCENARIOS.map((s) => h('option', { value: s.id, text: s.label })));

  prewarmEl = h('span', { class: 'prewarm' });

  mount(root,
    h('div', { class: 'demobar__label' }, [
      h('div', { class: 'demobar__eyebrow', text: 'Demo control' }),
      h('div', { class: 'demobar__title', text: 'Deterministic scenario runner' }),
    ]),

    h('label', {
      class: 'demobar__eyebrow',
      for: 'scenario-select',
      text: 'Scenario',
    }),
    select,

    h('button', {
      class: 'dbtn',
      type: 'button',
      onClick: () => onRunScenario(select.value),
    }, [h('span', { html: icons.play }), 'Run scenario']),

    prewarmEl,

    h('button', {
      class: 'dbtn',
      type: 'button',
      onClick: () => onReset(),
    }, [h('span', { html: icons.reset }), 'Reset demo']),
  );

  renderPrewarm();

  store.subscribe((_state, kind) => {
    if (kind === Change.DEMO) renderPrewarm();
  });
}
