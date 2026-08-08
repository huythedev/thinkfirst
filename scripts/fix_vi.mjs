import fs from 'fs';

let content = fs.readFileSync('lib/i18n/locales/vi.ts', 'utf8');

const replacementData = `
    evidence: {
      NOT_RECORDED: 'Chưa được ghi nhận, do đó phần này không được tính điểm.',
      NOT_ENOUGH_EVIDENCE: 'Chưa đủ dữ liệu.',
      STARTING_THE_PROBLEM_YOURSELF: 'Phần bắt đầu giải quyết bài toán không được áp dụng trong phiên này.',
      NO_FIRST_ATTEMPT_WAS_RECORDED: 'Không có dữ liệu về lần thử đầu tiên, không thể đánh giá.',
      ASKED_FOR_THE_ANSWER_SEVERAL_T: 'Yêu cầu xem đáp án nhiều lần trước khi thử tự làm.',
      STARTED_WITH_A_MEANINGFUL_ATTE: 'Bắt đầu với một nỗ lực có ý nghĩa.',
      STARTED_WITH_A_PARTIAL_ATTEMPT: 'Bắt đầu với một nỗ lực giải được một phần.',
      STARTED_WITH_A_MINIMAL_ATTEMPT: 'Bắt đầu với nỗ lực giải quyết tối thiểu.',
      ASKED_FOR_HELP_BEFORE_TRYING_A: 'Yêu cầu trợ giúp trước khi thử làm bước đầu.',
      HINTS_DID_NOT_COME_UP_IN_THIS: 'Không sử dụng gợi ý trong phiên học này.',
      HINT_LEVELS_WERE_NOT_RECORDED: 'Không có dữ liệu gợi ý cho phiên học này, do đó không được tính.',
      WORKED_WITHOUT_HINT: 'Làm bài mà không cần gợi ý, với mức gợi ý tối đa là {{ceiling}}.',
      NEEDED_HINTS: 'Cần sử dụng mức gợi ý lên tới {{effectiveHint}} trên tối đa {{ceiling}}.',
      EXPLAINING_REASONING_DID_NOT_A: 'Phần giải thích suy luận không được áp dụng trong phiên này.',
      WAS_ASKED_TO_EXPLAIN_THE_REASO: 'Được yêu cầu giải thích quá trình suy luận nhưng không làm.',
      THE_EXPLANATION_RUBRIC_WAS_NOT: 'Phần đánh giá giải thích không được tính cho phiên này.',
      DID_NOT_EXPLAIN: 'Không giải thích quá trình suy nghĩ trong các bước.',
      MET_EXPLANATION_CRITERIA: 'Đạt {{met}} trên 4 tiêu chí giải thích.',
      NO_TRANSFER_PROBLEM_WAS_OFFERE: 'Không có bài tập vận dụng nào được đưa ra trong phiên học này.',
      A_TRANSFER_PROBLEM_WAS_OFFERED: 'Có bài tập vận dụng nhưng không thử làm.',
      WHETHER_THE_TRANSFER_ANSWER_WA: 'Không thể xác định kết quả bài tập vận dụng có đúng hay không.',
      SOLVED_A_SIMILAR_PROBLEM_INDEP: 'Đã tự giải quyết một bài toán tương tự.',
      SOLVED_A_SIMILAR_PROBLEM_AFTER_NUDGE: 'Giải được bài toán tương tự sau khi có một sự trợ giúp nhỏ.',
      SOLVED_A_SIMILAR_PROBLEM_AFTER_HINT: 'Giải được bài toán tương tự sau một gợi ý nhỏ về khái niệm.',
      MADE_PARTIAL_PROGRESS_ON_A_SIM: 'Hoàn thành được một phần bài toán tương tự.',
      ATTEMPTED_A_SIMILAR_PROBLEM_AN: 'Đã thử làm một bài toán tương tự nhưng không ra kết quả đúng.',
      COULD_NOT_START_THE_SIMILAR_PR: 'Chưa thể bắt đầu giải bài toán tương tự.',
      CHECKING_THE_ANSWER_DID_NOT_CO: 'Không có việc kiểm tra đáp án trong phiên học này.',
      WAS_ASKED_TO_CHECK_THE_RESULT: 'Được yêu cầu kiểm tra lại kết quả nhưng không làm.',
      VERIFICATION_BEHAVIOR_WAS_NOT: 'Đánh giá hành vi kiểm tra chưa được thực hiện cho phiên này.',
      DID_NOT_CHECK: 'Không kiểm tra lại kết quả.',
      MET_CHECKING_CRITERIA: 'Đạt {{met}} trên 4 tiêu chí kiểm tra kết quả.'
    },
    recommendations: {
      KEEP_GOING: 'Hãy tiếp tục phát huy. Thử giải một bài toán khó hơn để thử thách bản thân.',
      TRY_BEFORE_HELP: 'Trước khi nhờ giúp đỡ, hãy viết ra một điều em nhận thấy về bài toán. Kể cả một khởi đầu sai cũng có giá trị.',
      TRY_ANOTHER_STEP: 'Sau mỗi gợi ý, hãy tự làm thêm một bước trước khi yêu cầu gợi ý tiếp theo.',
      EXPLAIN_WHY: 'Hãy nói lý do em chọn bước làm đó, không chỉ là em đã làm gì. Việc giải thích sẽ giúp em hiểu sâu hơn.',
      DO_SIMILAR: 'Khi giải xong một bài toán, hãy thử làm bài tương tự ở cuối. Đó là cách thể hiện kết quả học tập.',
      CHECK_ANSWER: 'Kiểm tra lại đáp án bằng cách thay kết quả vào bài toán gốc.'
    },`;

content = content.replace(/evidence:\s*\{\s*NOT_RECORDED:[\s\S]*?CHECK_ANSWER: '[^']*'\s*\}[,]/, replacementData);
fs.writeFileSync('lib/i18n/locales/vi.ts', content);
