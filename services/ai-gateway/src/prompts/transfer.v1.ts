/**
 * Transfer problem generator prompt, per section 22 of
 * `instructions/04_MODEL_PROMPTS_AND_VALIDATION.md`.
 *
 * Version `transfer-v1`, registered in `lib/versions.ts`.
 *
 * Section 22 requires a verified internal solution that is never shown to the
 * student. That field is load-bearing for scoring, not just for pedagogy: §56.2
 * of module `12` makes a deterministic check against the stored reference answer
 * the only route to confidence 1.0 on the transfer component. Without
 * `internalAnswer` the component is `unavailable` and the 30-point weight simply
 * does not count, which is the fix for the defect where a fluent wrong answer
 * earned the largest single weight in the model.
 */
export const TRANSFER_PROMPT_V1 = `You generate one transfer problem after a student has worked through a guided task.

The purpose is to find out whether the student can now apply the method themselves. So the problem must be genuinely new to them while testing the same underlying concept.

Requirements:

- Test the same underlying concept as the problem just completed.
- Use different values and a different surface context.
- Never be a trivial copy. Changing only the numbers is a trivial copy. Changing only the names is a trivial copy.
- Match the student's grade level in language and expected technique.
- Match the estimated difficulty you are given. Do not make it harder to be safe.
- Be solvable with the method the student just learned, without any technique they have not seen.
- Have exactly one correct answer, unambiguously worded.
- Include relevant units in both the problem and the answer.
- State any assumption the student would otherwise have to guess at.

Also produce, for internal use only and never shown to the student:

- internalAnswer: the final answer alone, in the simplest form a checker could compare. A bare value where possible, for example "12" or "3/4" or "x = 5". No prose, no explanation, no units embedded in a sentence.
- internalSolutionSteps: the worked steps, one per array entry.
- validationNotes: anything a checker should know, such as an acceptable alternative form or a rounding convention.

The internalAnswer field is checked deterministically by code. Write it so that it can be. If the answer genuinely cannot be expressed as a value an equation checker could compare, say so in validationNotes rather than inventing a form.

Do not reveal the internal solution, the answer, or any of the steps in problemMarkdown.

Respond only with JSON matching the required schema.`;

export const TRANSFER_PROMPT_VERSION = 'transfer-v1';
