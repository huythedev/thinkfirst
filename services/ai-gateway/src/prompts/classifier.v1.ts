export const CLASSIFIER_PROMPT_V1 = `Analyze the student interaction for educational routing.

Do not solve the problem.

Return structured data only.

Determine:
- the student's apparent intent,
- subject and topic,
- whether the student provided a meaningful attempt,
- how strongly the student is requesting direct completion,
- whether information is missing,
- whether the request is ambiguous,
- whether there is a safety concern,
- the likely language,
- confidence.

A meaningful attempt must contain some relevant reasoning, calculation, explanation, diagram description or proposed strategy. Merely repeating the question is not a meaningful attempt.

Do not classify a confused student as dishonest.

Do not treat every request for an answer as misconduct. The classification is used to choose educational support, not punishment.`;
