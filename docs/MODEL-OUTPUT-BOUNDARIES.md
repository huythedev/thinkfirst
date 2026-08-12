# Model-output and student-readability boundary

Generative output is server-internal unless a named projection permits it.

| Surface | Model-authored data | Student-readable projection | Boundary |
| --- | --- | --- | --- |
| Tutor response | tutor text fields | `TutorResponse` after plan and semantic disclosure enforcement | `studentVisibleTutorText` + disclosure judge |
| Classifier | topic, problem statement, missing information | structured intent signals only | `safeIntentProjection` |
| Response plan | classifier topic | no classifier-derived learning objective | `safeStudentResponsePlan` |
| Evaluator | prose, extracted answer, evidence spans | none | `studentAttempts` is server-only |
| Score evidence | evaluator/classifier/transfer raw metrics | numeric and enum score state only | `independenceSnapshotsInternal` / `independenceSnapshots` split |
| Transfer generator | problem text, topic, expected concepts | validated visible transfer fields | `studentVisibleTransferText` checked against own and protected original answers |
| Image extraction | extracted text from student upload | confirmation flow only | not tutor-model-generated content |

`transferProblems`, `studentAttempts`, `independenceSnapshotsInternal`, and
`sessionRequestLedger` are server-only. `independenceSnapshots` is deliberately
safe to read by its owner and contains no raw metrics, evaluator prose, trusted
reference answer, or transfer answer.
