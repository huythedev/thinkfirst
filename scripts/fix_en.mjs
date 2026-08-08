import fs from 'fs';

let content = fs.readFileSync('lib/i18n/locales/en.ts', 'utf8');

const replacementData = `
    evidence: {
      NOT_RECORDED: 'This was not recorded yet, so it is not counted either way.',
      NOT_ENOUGH_EVIDENCE: 'Not enough evidence yet.',
      STARTING_THE_PROBLEM_YOURSELF: 'Starting the problem yourself did not apply in this session.',
      NO_FIRST_ATTEMPT_WAS_RECORDED: 'No first attempt was recorded, so this could not be measured.',
      ASKED_FOR_THE_ANSWER_SEVERAL_T: 'Asked for the answer several times before trying a step.',
      STARTED_WITH_A_MEANINGFUL_ATTE: 'Started with a meaningful attempt.',
      STARTED_WITH_A_PARTIAL_ATTEMPT: 'Started with a partial attempt.',
      STARTED_WITH_A_MINIMAL_ATTEMPT: 'Started with a minimal attempt.',
      ASKED_FOR_HELP_BEFORE_TRYING_A: 'Asked for help before trying a first step.',
      HINTS_DID_NOT_COME_UP_IN_THIS: 'Hints did not come up in this session.',
      HINT_LEVELS_WERE_NOT_RECORDED: 'Hint levels were not recorded for this session, so this is not counted.',
      WORKED_WITHOUT_HINT: 'Worked without asking for a hint, with level {{ceiling}} available.',
      NEEDED_HINTS: 'Needed hints up to level {{effectiveHint}} of {{ceiling}} available.',
      EXPLAINING_REASONING_DID_NOT_A: 'Explaining reasoning did not apply in this session.',
      WAS_ASKED_TO_EXPLAIN_THE_REASO: 'Was asked to explain the reasoning and did not.',
      THE_EXPLANATION_RUBRIC_WAS_NOT: 'The explanation rubric was not evaluated for this session.',
      DID_NOT_EXPLAIN: 'Did not explain the thinking behind the steps.',
      MET_EXPLANATION_CRITERIA: 'Met {{met}} of 4 explanation criteria.',
      NO_TRANSFER_PROBLEM_WAS_OFFERE: 'No transfer problem was offered in this session.',
      A_TRANSFER_PROBLEM_WAS_OFFERED: 'A transfer problem was offered and not attempted.',
      WHETHER_THE_TRANSFER_ANSWER_WA: 'Whether the transfer answer was correct could not be established.',
      SOLVED_A_SIMILAR_PROBLEM_INDEP: 'Solved a similar problem independently.',
      SOLVED_A_SIMILAR_PROBLEM_AFTER_NUDGE: 'Solved a similar problem after a small nudge.',
      SOLVED_A_SIMILAR_PROBLEM_AFTER_HINT: 'Solved a similar problem after one concept hint.',
      MADE_PARTIAL_PROGRESS_ON_A_SIM: 'Made partial progress on a similar problem.',
      ATTEMPTED_A_SIMILAR_PROBLEM_AN: 'Attempted a similar problem and did not reach a correct answer.',
      COULD_NOT_START_THE_SIMILAR_PR: 'Could not start the similar problem yet.',
      CHECKING_THE_ANSWER_DID_NOT_CO: 'Checking the answer did not come up in this session.',
      WAS_ASKED_TO_CHECK_THE_RESULT: 'Was asked to check the result and did not.',
      VERIFICATION_BEHAVIOR_WAS_NOT: 'Verification behavior was not evaluated for this session.',
      DID_NOT_CHECK: 'Did not check the result.',
      MET_CHECKING_CRITERIA: 'Met {{met}} of 4 checking criteria.'
    },
    recommendations: {
      KEEP_GOING: 'Keep going the way you are. Try a harder problem to stretch yourself.',
      TRY_BEFORE_HELP: 'Before asking for help, write down one thing you notice about the problem. Even a wrong start counts.',
      TRY_ANOTHER_STEP: 'After each hint, try one more step on your own before asking for the next one.',
      EXPLAIN_WHY: 'Say why you chose a step, not just what you did. Explaining it makes it stick.',
      DO_SIMILAR: 'When you finish a problem, try the similar one offered at the end. That is where learning shows.',
      CHECK_ANSWER: 'Check your answer by substituting it back into the original problem.'
    },`;

content = content.replace(/evidence:\s*\{\s*NOT_RECORDED:[\s\S]*?CHECK_ANSWER: '[^']*'\s*\}[,]/, replacementData);
fs.writeFileSync('lib/i18n/locales/en.ts', content);
