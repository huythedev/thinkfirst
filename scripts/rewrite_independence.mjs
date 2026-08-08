import fs from 'fs';

let content = fs.readFileSync('lib/scoring/independence.ts', 'utf8');

// Replace rationale mapping
const suggestionsMap = {
  firstAttempt: 'TRY_BEFORE_HELP',
  hintEfficiency: 'TRY_ANOTHER_STEP',
  reasoningExplanation: 'EXPLAIN_WHY',
  transferPerformance: 'DO_SIMILAR',
  verificationBehavior: 'CHECK_ANSWER'
};

content = content.replace(
  /return suggestions\[weakest\.id\];/g,
  `return { text: suggestions[weakest.id], code: weakest.id };` // Wait, buildSuggestion signature is string | null
);

fs.writeFileSync('lib/scoring/independence.ts', content);
