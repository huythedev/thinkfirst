import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvaluation, type EvaluationReport } from './harness';

/**
 * `npm run eval`.
 *
 * Writes `evals/reports/latest.json` and `evals/reports/latest.md`, the two paths
 * section 37 names. Exits non-zero when a measured gate fails, so the command is
 * usable in CI as a gate rather than only as a document generator.
 *
 * A gate reported as `not_measured` does not fail the run, and does not count as
 * a pass either. Reporting an unmeasured gate as green is the exact failure mode
 * `scoring-v1` was replaced for (module 12, section 56.1): treating absence of
 * evidence as evidence of success.
 */

const here = dirname(fileURLToPath(import.meta.url));
const reportsDir = resolve(here, 'reports');

function formatRate(rate: number | null, passed: number, total: number): string {
  if (rate === null) return 'not measured (0 observations)';
  return `${rate.toFixed(1)}% (${passed}/${total})`;
}

function toMarkdown(report: EvaluationReport): string {
  const lines: string[] = [];

  lines.push('# ThinkFirst evaluation report');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Cases: **${report.totalCases}** (section 37 requires at least 100)`);
  lines.push(`- Driver: **${report.driver}** -- no live model call was made`);
  lines.push('');

  lines.push('## Release gates');
  lines.push('');
  lines.push('| Gate | Threshold | Measured | Status |');
  lines.push('|---|---|---|---|');
  for (const gate of report.gates) {
    const status =
      gate.status === 'pass' ? 'PASS' : gate.status === 'fail' ? '**FAIL**' : 'not measured';
    lines.push(`| ${gate.description} | ${gate.threshold} | ${gate.measured} | ${status} |`);
  }
  lines.push('');
  for (const gate of report.gates) {
    lines.push(`- **${gate.description}** -- ${gate.detail}`);
  }
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Result |');
  lines.push('|---|---|');
  const metricLabels: Array<[keyof EvaluationReport['metrics'], string]> = [
    ['policyCompliance', 'Policy compliance'],
    ['finalAnswerLeakage', 'Final-answer leakage (lower is better)'],
    ['structuredOutputSuccess', 'Structured output success'],
    ['safetyRoutingRecall', 'Safety routing recall'],
    ['mathematicalCorrectness', 'Mathematical correctness'],
    ['hintEscalationDiscipline', 'Hint escalation discipline (at most +1)'],
    ['studentActionRequired', 'Student action required'],
    ['uncertaintyCommunication', 'Uncertainty communication'],
    ['ageAppropriateRegister', 'Age-appropriate register'],
    ['transferObligation', 'Transfer obligation after full solution'],
  ];
  for (const [key, label] of metricLabels) {
    const metric = report.metrics[key];
    lines.push(`| ${label} | ${formatRate(metric.rate, metric.passed, metric.total)} |`);
  }
  lines.push('');

  lines.push('## Case coverage');
  lines.push('');
  lines.push('Section 37 lists the kinds of case the dataset must include. A kind with no case');
  lines.push('fails the run, because 100 near-duplicate cases would otherwise satisfy the count.');
  lines.push('');
  lines.push('| Kind | Cases |');
  lines.push('|---|---:|');
  for (const entry of report.categoryCoverage) {
    lines.push(`| ${entry.category} | ${entry.count} |`);
  }
  lines.push('');

  if (report.failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    lines.push('| Case | Metric | Expected | Actual |');
    lines.push('|---|---|---|---|');
    for (const failure of report.failures) {
      lines.push(
        `| ${failure.caseId} | ${failure.metric} | ${failure.expected} | ${failure.actual} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('## Failures');
    lines.push('');
    lines.push('None.');
    lines.push('');
  }

  lines.push('## Limitations');
  lines.push('');
  lines.push('Section 37 requires these to be documented. They are the reason two gates read');
  lines.push('`PARTIAL` and one reads `not measured`.');
  lines.push('');
  for (const limitation of report.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push('');

  return lines.join('\n');
}

const report = runEvaluation();

mkdirSync(reportsDir, { recursive: true });
writeFileSync(resolve(reportsDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(resolve(reportsDir, 'latest.md'), toMarkdown(report), 'utf8');

const failedGates = report.gates.filter((gate) => gate.status === 'fail');
const notMeasured = report.gates.filter((gate) => gate.status === 'not_measured');

console.log(`Evaluation: ${report.totalCases} cases`);
for (const gate of report.gates) {
  const label =
    gate.status === 'pass' ? 'PASS' : gate.status === 'fail' ? 'FAIL' : 'NOT MEASURED';
  console.log(`  [${label}] ${gate.description}: ${gate.measured}`);
}
console.log(`Report written to evals/reports/latest.json and latest.md`);

if (report.missingCategories.length > 0) {
  console.error(
    `Section 37 case kinds with no coverage: ${report.missingCategories.join(', ')}`,
  );
}
if (report.totalCases < 100) {
  console.error(`Section 37 requires at least 100 cases; the dataset has ${report.totalCases}.`);
}
if (failedGates.length > 0) {
  console.error(`${failedGates.length} gate(s) failed.`);
}
if (notMeasured.length > 0) {
  console.warn(
    `${notMeasured.length} gate(s) not measured. These are not passes; see the limitations section.`,
  );
}

const shouldFail =
  failedGates.length > 0 || report.missingCategories.length > 0 || report.totalCases < 100;
process.exit(shouldFail ? 1 : 0);
