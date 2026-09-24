/* Mirror of the brain's deterministic state graph.
 *
 * Source of truth: services/brain/state_machine.py :: ALLOWED
 * This is a hand-kept COPY so the dashboard never offers a transition the
 * backend would reject. Keep it in sync if brain's graph changes.
 *
 * Two consequences the mockup did not account for, both enforced here:
 *   - Resolving a DISPATCHED incident must pass through TRACKING first.
 *   - DISMISSED is only reachable from NEW or ALERTED, so "false alarm"
 *     is unavailable once dispatch has started.
 */

import { IncidentState } from './contracts.js';

export const ALLOWED = {
  [IncidentState.NEW]: [IncidentState.ALERTED, IncidentState.DISMISSED],
  // MINOR path closes straight from ALERTED; SEVERE path arms dispatch.
  [IncidentState.ALERTED]: [
    IncidentState.DISPATCH_PENDING,
    IncidentState.DISMISSED,
    IncidentState.RESOLVED,
  ],
  [IncidentState.DISPATCH_PENDING]: [IncidentState.DISPATCHED],
  // Chase path: tracking is required before resolve.
  [IncidentState.DISPATCHED]: [IncidentState.TRACKING],
  [IncidentState.TRACKING]: [IncidentState.RESOLVED],
  [IncidentState.RESOLVED]: [],
  [IncidentState.DISMISSED]: [],
};

/** Is `to` reachable from `from` in exactly one legal step? */
export function canTransition(from, to) {
  return (ALLOWED[from] || []).includes(to);
}

/**
 * Shortest legal chain of states from `from` to `to`, excluding `from`.
 * Returns [] when `to` is unreachable or already current.
 *
 * Used so a single button press can walk the graph legally, e.g. Dispatch
 * from NEW yields [ALERTED, DISPATCH_PENDING, DISPATCHED].
 */
export function pathTo(from, to) {
  if (from === to) return [];
  const queue = [[from, []]];
  const seen = new Set([from]);
  while (queue.length) {
    const [node, trail] = queue.shift();
    for (const next of ALLOWED[node] || []) {
      if (seen.has(next)) continue;
      const nextTrail = [...trail, next];
      if (next === to) return nextTrail;
      seen.add(next);
      queue.push([next, nextTrail]);
    }
  }
  return [];
}

/* ---------------- operator actions ---------------- */

export const Action = {
  ACKNOWLEDGE: 'acknowledge',
  DISPATCH: 'dispatch',
  RESOLVE: 'resolve',
  FALSE_ALARM: 'false_alarm',
};

/** Timeline note written when an action lands. */
export const ACTION_NOTE = {
  [Action.ACKNOWLEDGE]: 'Acknowledged by operator',
  [Action.DISPATCH]: 'SIMULATED · campus security',
  [Action.RESOLVE]: 'Closed by operator',
  [Action.FALSE_ALARM]: 'Marked false alarm by operator',
};

export const ACTION_TARGET = {
  [Action.ACKNOWLEDGE]: IncidentState.ALERTED,
  [Action.DISPATCH]: IncidentState.DISPATCHED,
  [Action.RESOLVE]: IncidentState.RESOLVED,
  [Action.FALSE_ALARM]: IncidentState.DISMISSED,
};

/**
 * Which of the four buttons are legal from `state`.
 * Acknowledge is deliberately restricted to NEW, and Resolve is blocked at
 * NEW so nothing is closed before it has been seen.
 */
export function availableActions(state) {
  return {
    [Action.ACKNOWLEDGE]: state === IncidentState.NEW,
    [Action.DISPATCH]: pathTo(state, IncidentState.DISPATCHED).length > 0,
    [Action.RESOLVE]:
      state !== IncidentState.NEW
      && pathTo(state, IncidentState.RESOLVED).length > 0,
    [Action.FALSE_ALARM]: pathTo(state, IncidentState.DISMISSED).length > 0,
  };
}

/** The legal chain of states an action walks from `state`. */
export function actionPath(state, action) {
  const target = ACTION_TARGET[action];
  if (!target) return [];
  return pathTo(state, target);
}
