import fs from 'fs';
let content = fs.readFileSync('lib/scoring/independence.ts', 'utf8');

content = content.replace("rationaleCode: 'SOLVED_A_SIMILAR_PROBLEM_AFTER'", "rationaleCode: 'SOLVED_A_SIMILAR_PROBLEM_AFTER_NUDGE'");
content = content.replace("rationaleCode: 'SOLVED_A_SIMILAR_PROBLEM_AFTER'", "rationaleCode: 'SOLVED_A_SIMILAR_PROBLEM_AFTER_HINT'"); // the second one

// And fix the template literals which the regex might have missed:
content = content.replace(/rationale:\s*`Worked without asking for a hint, with level \$\{ceiling\} available.`(,?)/g, "rationale: `Worked without asking for a hint, with level ${ceiling} available.`, rationaleCode: 'WORKED_WITHOUT_HINT'$1");
content = content.replace(/rationale:\s*`Needed hints up to level \$\{effectiveHint\} of \$\{ceiling\} available.`(,?)/g, "rationale: `Needed hints up to level ${effectiveHint} of ${ceiling} available.`, rationaleCode: 'NEEDED_HINTS'$1");

content = content.replace(/rationale:\s*met === 0\s*\?\s*'Did not explain the thinking behind the steps.'\s*:\s*`Met \$\{met\} of 4 explanation criteria.`(,?)/g, "rationale: met === 0 ? 'Did not explain the thinking behind the steps.' : `Met ${met} of 4 explanation criteria.`, rationaleCode: met === 0 ? 'DID_NOT_EXPLAIN' : 'MET_EXPLANATION_CRITERIA'$1");

content = content.replace(/rationale:\s*met === 0\s*\?\s*'Did not check the result.'\s*:\s*`Met \$\{met\} of 4 checking criteria.`(,?)/g, "rationale: met === 0 ? 'Did not check the result.' : `Met ${met} of 4 checking criteria.`, rationaleCode: met === 0 ? 'DID_NOT_CHECK' : 'MET_CHECKING_CRITERIA'$1");

fs.writeFileSync('lib/scoring/independence.ts', content);
