/* Scenario ids the demo bar can stage.
 *
 * services/api serves no scenario list, so this mirrors the keys of SCENARIOS
 * in services/api/hub.py. Sending an id that is not in that dict falls back to
 * WEAPON on cam-01 rather than erroring, but keeping this list aligned means
 * the label in the dropdown matches what the brain actually adjudicates.
 *
 * The hub holds eleven keys; several are legacy aliases pointing at the same
 * class (`weapon`, `fall`, `person-down` all resolve to WEAPON on cam-01).
 * Listed here is one entry per distinct outcome.
 *
 * Every non-BENIGN scenario forces the class token, so adjudicate scores
 * fused = 0.40 x 0.88 + 0.60 x 1.0 = 0.952 against severe_at 0.80 in
 * bench/thresholds.json. All five come back SEVERE and start the voice call.
 * `benign` scores 0.078 and comes back NONE, i.e. DISMISSED on arrival.
 */

export const SCENARIOS = [
  { id: 'armed-intruder', label: 'Armed intruder · WEAPON · cam-01' },
  { id: 'fight', label: 'Altercation · FIGHT · cam-01' },
  { id: 'forced-entry', label: 'Break-in · THEFT · cam-02' },
  { id: 'loitering', label: 'Running subject · RUN · cam-03' },
  { id: 'medical', label: 'Medical distress · MEDICAL · cam-01' },
  { id: 'benign', label: 'Benign activity · dismissed on arrival' },
];

export const DEFAULT_SCENARIO_ID = SCENARIOS[0].id;
