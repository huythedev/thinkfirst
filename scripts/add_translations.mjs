import fs from 'fs';

const enData = `
  domain: {
    subjects: {
      mathematics: 'Mathematics',
      science: 'Science',
      other: 'Other'
    },
    modes: {
      learn: 'Learn',
      practice: 'Practice',
      assignment: 'Assignment',
      verify: 'Verify'
    },
    strictness: {
      supportive: 'Supportive',
      balanced: 'Balanced',
      independence: 'Independence',
      assessment_safe: 'Assessment Safe'
    },
    sessionStatus: {
      active: 'Active',
      completed: 'Completed',
      abandoned: 'Abandoned'
    },
    hintLevels: {
      0: 'Attempt',
      1: 'Verify',
      2: 'Clarify',
      3: 'Investigate',
      4: 'Sub-goal',
      5: 'Guided execution',
      6: 'Final step',
      7: 'Full solution'
    },
  },
  mySessions: {
    title: 'My sessions',
    subtitle: 'Pick up where you left off, or start something new.',
    startSession: 'Start a session',
    loading: 'Loading your sessions',
    sessionExpired: 'Your sign-in has expired. Reload the page to continue.',
    tryAgain: 'Try again',
    noSessionsTitle: 'No sessions yet',
    noSessionsDesc: 'Start a session with a problem you are working on, and your conversation will be saved here so you can come back to it.',
    startFirst: 'Start your first session',
    untitledProblem: 'Untitled problem',
    hintLevel: 'Hint level {{current}} / {{max}}'
  },
  sessionActions: {
    checkStep: 'Check my step',
    stuck: 'I\\'m stuck',
    explainConcept: 'Explain concept',
    smallerHint: 'Smaller hint',
    explainDifferently: 'Explain differently',
    reportIssue: 'Report an issue'
  },
  activeSession: {
    messages_one: '1 message',
    messages_other: '{{count}} messages',
    problem: 'Problem',
    scratchpad: 'Scratchpad',
    scratchpadPlaceholder: 'Work out your steps here. Only you can see this.',
    composerPlaceholder: 'Explain your step or ask a question...',
    send: 'Send',
    hintLevel: 'Hint level',
    hintLevelDisplay: 'Hint level {{current}} of {{max}}: {{rung}}'
  },
`;

const viData = `
  domain: {
    subjects: {
      mathematics: 'Toán học',
      science: 'Khoa học',
      other: 'Khác'
    },
    modes: {
      learn: 'Học',
      practice: 'Luyện tập',
      assignment: 'Bài tập',
      verify: 'Kiểm tra'
    },
    strictness: {
      supportive: 'Hỗ trợ',
      balanced: 'Cân bằng',
      independence: 'Tự lập',
      assessment_safe: 'An toàn'
    },
    sessionStatus: {
      active: 'Đang hoạt động',
      completed: 'Đã hoàn thành',
      abandoned: 'Đã bỏ dở'
    },
    hintLevels: {
      0: 'Thử nghiệm',
      1: 'Kiểm tra',
      2: 'Làm rõ',
      3: 'Tìm hiểu',
      4: 'Mục tiêu nhỏ',
      5: 'Hướng dẫn',
      6: 'Bước cuối',
      7: 'Lời giải'
    },
  },
  mySessions: {
    title: 'Phiên học của em',
    subtitle: 'Tiếp tục phiên học trước hoặc bắt đầu một nội dung mới.',
    startSession: 'Bắt đầu phiên học',
    loading: 'Đang tải phiên học',
    sessionExpired: 'Phiên đăng nhập đã hết hạn. Tải lại trang để tiếp tục.',
    tryAgain: 'Thử lại',
    noSessionsTitle: 'Chưa có phiên học nào',
    noSessionsDesc: 'Bắt đầu một phiên học với một bài toán em đang làm, và cuộc hội thoại sẽ được lưu ở đây để em có thể xem lại.',
    startFirst: 'Bắt đầu phiên học đầu tiên',
    untitledProblem: 'Bài toán không tên',
    hintLevel: 'Mức gợi ý {{current}} / {{max}}'
  },
  sessionActions: {
    checkStep: 'Kiểm tra bước làm',
    stuck: 'Em đang bị bí',
    explainConcept: 'Giải thích kiến thức',
    smallerHint: 'Gợi ý nhỏ hơn',
    explainDifferently: 'Giải thích cách khác',
    reportIssue: 'Báo cáo vấn đề'
  },
  activeSession: {
    messages: '{{count}} tin nhắn',
    problem: 'Bài toán',
    scratchpad: 'Nháp',
    scratchpadPlaceholder: 'Viết các bước làm của em ở đây. Chỉ em mới có thể xem phần này.',
    composerPlaceholder: 'Giải thích bước làm hoặc đặt câu hỏi...',
    send: 'Gửi',
    hintLevel: 'Mức gợi ý',
    hintLevelDisplay: 'Mức gợi ý {{current}} / {{max}}: {{rung}}'
  },
`;

const enProgressData = `
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
    }
`;

const viProgressData = `
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
    }
`;


let enFile = fs.readFileSync('lib/i18n/locales/en.ts', 'utf8');
enFile = enFile.replace('progress: {', enData + '\\n  progress: {' + enProgressData + ',');
fs.writeFileSync('lib/i18n/locales/en.ts', enFile);

let viFile = fs.readFileSync('lib/i18n/locales/vi.ts', 'utf8');
viFile = viFile.replace('progress: {', viData + '\\n  progress: {' + viProgressData + ',');
fs.writeFileSync('lib/i18n/locales/vi.ts', viFile);
