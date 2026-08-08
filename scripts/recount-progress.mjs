/**
 * Recounts docs/progress.md rather than trusting its typed percentages.
 *
 * Scoring rule 4 says percentages are derived, never typed, and this repository
 * has already shipped two sessions where a phase heading disagreed with its own
 * rows (Phase 8 at 17% against rows summing to 25%, Phase 11 at 25% against 42%).
 * Both survived because the rule was applied to the overall figure and not to the
 * headings. So this script checks every heading and the overall mean.
 *
 * Usage: node scripts/recount-progress.mjs
 */

import { readFileSync } from 'node:fs';

const VALUES = { '[x]': 1, '[~]': 0.5, '[!]': 0, '[ ]': 0 };

const text = readFileSync('docs/progress.md', 'utf8');
const lines = text.split(/\r?\n/);

const phases = [];
let current = null;

for (const line of lines) {
  const heading = line.match(/^## Phase (\d+)\s*--\s*(.+?):\s*(\d+)%\s*$/);
  if (heading) {
    current = {
      number: Number(heading[1]),
      name: heading[2].trim(),
      stated: Number(heading[3]),
      markers: [],
    };
    phases.push(current);
    continue;
  }

  // A criterion row starts with a marker cell: | `[x]` | ...
  const row = line.match(/^\|\s*`(\[[x~! ]\])`\s*\|/);
  if (row && current) {
    current.markers.push(row[1]);
  }
}

let failures = 0;
let totalCriteria = 0;
let totalValue = 0;

console.log('Phase                              rows   sum   derived   stated');
console.log('-----------------------------------------------------------------');

for (const phase of phases) {
  const sum = phase.markers.reduce((total, marker) => total + VALUES[marker], 0);
  const count = phase.markers.length;
  const derived = count === 0 ? 0 : Math.round((sum / count) * 100);
  const label = `${String(phase.number).padStart(2, ' ')} ${phase.name}`.padEnd(34, ' ');
  const flag = derived === phase.stated ? '' : '   <-- MISMATCH';
  if (derived !== phase.stated) failures += 1;

  totalCriteria += count;
  totalValue += sum;

  console.log(
    `${label} ${String(count).padStart(4)}  ${String(sum).padStart(4)}  ${String(derived).padStart(6)}%  ${String(phase.stated).padStart(6)}%${flag}`,
  );
}

const meanOfPhases = Math.round(
  phases.reduce((total, phase) => {
    const sum = phase.markers.reduce((inner, marker) => inner + VALUES[marker], 0);
    return total + (phase.markers.length === 0 ? 0 : sum / phase.markers.length);
  }, 0) / phases.length * 100,
);

const byCriterionWeight = Math.round((totalValue / totalCriteria) * 100);

console.log('-----------------------------------------------------------------');
console.log(`Phases counted:            ${phases.length}`);
console.log(`Criteria counted:          ${totalCriteria}`);
console.log(`Criterion weight sum:      ${totalValue}`);
console.log(`Mean of phases (headline): ${meanOfPhases}%`);
console.log(`By criterion weight:       ${byCriterionWeight}%`);
console.log(`Gap between the two:       ${Math.abs(meanOfPhases - byCriterionWeight)} points`);

const statedOverall = text.match(/^## Overall:\s*(\d+)%/m);
if (statedOverall) {
  const stated = Number(statedOverall[1]);
  console.log(`Stated overall:            ${stated}%`);
  if (stated !== meanOfPhases) {
    failures += 1;
    console.log('  <-- MISMATCH with the mean of phases');
  }
}

process.exit(failures === 0 ? 0 : 1);
