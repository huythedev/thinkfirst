export const vi = {
  common: {
    loading: "Đang tải...",
    save: "Lưu thay đổi",
    saving: "Đang lưu...",
    saved: "Đã lưu cài đặt.",
    error: "Đã xảy ra lỗi.",
    dashboard: "Trang chủ",
    settings: "Cài đặt",
    sessions: "Phiên học",
    progress: "Tiến độ",
    classrooms: "Lớp học",
    logout: "Đăng xuất",
    skipToMain: "Chuyển đến nội dung chính",
    forTeachers: "dành cho Giáo viên",
    guide: "Hướng dẫn",
  },
  auth: {
    notProvided: "Chưa cung cấp",
    unknown: "Không xác định",
  },
  student: {
    welcome: "Chào bạn, {{name}}",
    ready: "Sẵn sàng học chưa?",
    startNew: "Bắt đầu phiên học mới",
    practiceDesc: "Luyện tập toán hoặc khoa học cùng gia sư AI.",
    startLearning: "Bắt đầu học",
    yourProgress: "Tiến độ của bạn",
    details: "Chi tiết",
    independenceScore: "Điểm Độc lập",
    notEnoughPractice:
      "Chưa đủ dữ liệu. Hãy học thêm một vài phiên để hệ thống đánh giá tiến độ của bạn.",
    basedOn: "Dựa trên {{count}} phiên học",
    classrooms: "Lớp học",
    joinCodeDesc:
      "Có mã tham gia từ giáo viên? Hãy tự thêm mình vào lớp học của họ.",
    joinClassroom: "Tham gia lớp học",
  },
  newSession: {
    title: "Bắt đầu Phiên Học",
    subject: "Môn học",
    math: "Toán học",
    science: "Khoa học",
    mode: "Chế độ Học",
    learn: "Học (Khái niệm mới)",
    practice: "Thực hành (Có hướng dẫn)",
    assignment: "Bài tập (Bắt buộc)",
    verify: "Xác minh (Kiểm tra AI)",
    problem: "Bạn đang giải bài toán nào?",
    problemPlaceholder: "ví dụ: Giải x² - 5x + 6 = 0",
    startBtn: "Bắt đầu",
    startingBtn: "Đang bắt đầu...",
    errorEmpty: "Vui lòng nhập một bài toán hoặc tải lên một hình ảnh",
    errorImage:
      "Kiểm tra và xác nhận văn bản từ hình ảnh của bạn trước khi bắt đầu.",
    errorStart: "Không thể bắt đầu phiên học",
  },
  teacher: {
    welcome: "Chào mừng, {{name}}",
    overview: "Tổng quan lớp học",
    profileInfo: "Thông tin hồ sơ",
    name: "Tên",
    email: "Email",
    role: "Vai trò",
    language: "Ngôn ngữ",
    languageDesc: "Giao diện sẽ hiển thị bằng ngôn ngữ này.",
    dashboardLoadError: "Không thể tải bảng điều khiển",
    tryAgain: "Thử lại",
    dashboardDesc:
      "Bao gồm {{classCount}} lớp học và {{studentCount}} học sinh.",
    activeStudents: "Học sinh đang hoạt động",
    activeStudentsCaption: "Trong 7 ngày qua",
    activeStudentsHelp:
      "Học sinh đã bắt đầu hoặc hoàn thành ít nhất một phiên học trong 7 ngày qua.",
    sessionsCompleted: "Số phiên đã hoàn thành",
    sessionsCompletedCaption: "Tổng cộng {{total}} phiên",
    sessionsCompletedHelp:
      "Các phiên học được đánh dấu hoàn thành trong 7 ngày qua.",
    attemptBeforeHelp: "Thử trước khi trợ giúp",
    attemptBeforeHelpHelp:
      "Tần suất học sinh thực sự tự thử giải trước khi yêu cầu trợ giúp.",
    transferSuccess: "Tự giải thành công",
    transferSuccessHelp:
      "Đo lường khả năng học sinh giải bài toán tương tự sau khi được hướng dẫn. Đây không phải điểm số chính thức.",
    yourClassrooms: "Lớp học của bạn",
    viewAll: "Xem tất cả",
    noClassrooms: "Bạn chưa tạo lớp học nào.",
    createClassroom: "Tạo lớp học",
    activeThisWeek: "Đang hoạt động tuần này",
    topicsReview: "Các chủ đề cần ôn tập",
    noTopicsReview:
      "Không có chủ đề nào có khoảng cách lớn giữa làm có hướng dẫn và tự làm.",
    gapPoints: "Khoảng cách điểm",
    classEvidence: "Đánh giá toàn lớp",
    avgHintLevel: "Mức gợi ý trung bình",
    notMeasured: "Chưa đo lường",
    avgHintLevelDesc:
      "Thang điểm từ 0 đến 7. Điểm cao nghĩa là học sinh cần nhiều gợi ý hơn.",
    reportedIssues: "Các câu trả lời bị báo cáo sai",
    reportedIssuesDesc: "Các báo cáo đang chờ xem xét.",
    howToRead: "Cách đọc các số liệu",
    howToReadDesc:
      "Các con số này mô tả hành vi học tập, không phải thành tích. Đây không phải điểm số, một số thấp có nghĩa là bạn nên chú ý nhiều hơn thay vì phán xét.",
  },
  settings: {
    accountSettings: "Cài đặt Tài khoản",
    applyToEverySession:
      "Những cài đặt này sẽ áp dụng cho mọi phiên học, giúp gia sư phù hợp với trình độ và ngôn ngữ của bạn.",
    language: "Ngôn ngữ",
    languageTutorDesc: "Gia sư sẽ giảng giải bằng ngôn ngữ này.",
    grade: "Lớp",
    gradeDesc: "Dùng để điều chỉnh mức độ giải thích phù hợp.",
    helpAmount: "Bạn muốn được giúp đỡ mức nào?",
    helpAmountDesc: "Giáo viên có thể ghi đè cài đặt này khi giao bài.",
    supportive: "Hỗ trợ nhiều",
    supportiveDesc: "Gợi ý nhiều hơn khi bạn vừa gặp khó khăn.",
    balanced: "Cân bằng",
    balancedDesc: "Mặc định. Mức độ gợi ý tăng dần khi bạn làm bài.",
    independence: "Tự lập",
    independenceDesc:
      "Ít gợi ý hơn. Bạn được khuyến khích tự thử thách bản thân trước.",
    couldNotSave: "Không thể lưu cài đặt. Vui lòng thử lại.",
  },
  guide: {
    studentTitle: "Hướng dẫn cho Học sinh",
    teacherTitle: "Hướng dẫn cho Giáo viên",
  },
  joinClassroom: {
    back: "Quay lại",
    title: "Tham gia lớp học",
    desc: "Nhập mã giáo viên cung cấp cho bạn.",
    codeLabel: "Mã lớp học",
    codePlaceholder: "ABC123",
    joining: "Đang vào...",
    joinBtn: "Tham gia",
    emptyError: "Vui lòng nhập mã lớp học.",
    error: "Không thể tham gia lớp học. Vui lòng thử lại.",
  },
  onboarding: {
    welcome: "Chào mừng đến với ThinkFirst",
    error: "Không thể tạo hồ sơ. Vui lòng thử lại.",
    roleQuestion: "Bạn là học sinh hay giáo viên?",
    student: "Học sinh",
    studentDesc: "Tôi muốn học và luyện tập",
    teacher: "Giáo viên",
    teacherDesc: "Tôi muốn quản lý lớp học",
    continue: "Tiếp tục",
    gradeQuestion: "Bạn học lớp mấy?",
    grade: "Lớp {{grade}}",
    langQuestion: "Ngôn ngữ ưu tiên",
    back: "Quay lại",
    creating: "Đang tạo...",
    complete: "Hoàn tất cài đặt",
  },

  domain: {
    subjects: {
      mathematics: "Toán học",
      science: "Khoa học",
      other: "Khác",
    },
    modes: {
      learn: "Học",
      practice: "Luyện tập",
      assignment: "Bài tập",
      verify: "Kiểm tra",
    },
    strictness: {
      supportive: "Hỗ trợ",
      balanced: "Cân bằng",
      independence: "Tự lập",
      assessment_safe: "An toàn",
    },
    sessionStatus: {
      active: "Đang hoạt động",
      completed: "Đã hoàn thành",
      abandoned: "Đã bỏ dở",
    },
    hintLevels: {
      0: "Thử nghiệm",
      1: "Kiểm tra",
      2: "Làm rõ",
      3: "Tìm hiểu",
      4: "Mục tiêu nhỏ",
      5: "Hướng dẫn",
      6: "Bước cuối",
      7: "Lời giải",
    },
  },
  mySessions: {
    title: "Phiên học của em",
    subtitle: "Tiếp tục phiên học trước hoặc bắt đầu một nội dung mới.",
    startSession: "Bắt đầu phiên học",
    loading: "Đang tải phiên học",
    sessionExpired: "Phiên đăng nhập đã hết hạn. Tải lại trang để tiếp tục.",
    tryAgain: "Thử lại",
    noSessionsTitle: "Chưa có phiên học nào",
    noSessionsDesc:
      "Bắt đầu một phiên học với một bài toán em đang làm, và cuộc hội thoại sẽ được lưu ở đây để em có thể xem lại.",
    startFirst: "Bắt đầu phiên học đầu tiên",
    untitledProblem: "Bài toán không tên",
    hintLevel: "Mức gợi ý {{current}} / {{max}}",
  },
  sessionActions: {
    checkStep: "Kiểm tra bước làm",
    stuck: "Em đang bị bí",
    explainConcept: "Giải thích kiến thức",
    smallerHint: "Gợi ý nhỏ hơn",
    explainDifferently: "Giải thích cách khác",
    reportIssue: "Báo cáo vấn đề",
  },
  activeSession: {
    messages: "{{count}} tin nhắn",
    problem: "Bài toán",
    scratchpad: "Nháp",
    scratchpadPlaceholder:
      "Viết các bước làm của em ở đây. Chỉ em mới có thể xem phần này.",
    composerPlaceholder: "Giải thích bước làm hoặc đặt câu hỏi...",
    send: "Gửi",
    hintLevel: "Mức gợi ý",
    hintLevelDisplay: "Mức gợi ý {{current}} / {{max}}: {{rung}}",
  },

  progress: {
    evidence: {
      NOT_RECORDED: "Chưa được ghi nhận, do đó phần này không được tính điểm.",
      NOT_ENOUGH_EVIDENCE: "Chưa đủ dữ liệu.",
      STARTING_THE_PROBLEM_YOURSELF:
        "Phần bắt đầu giải quyết bài toán không được áp dụng trong phiên này.",
      NO_FIRST_ATTEMPT_WAS_RECORDED:
        "Không có dữ liệu về lần thử đầu tiên, không thể đánh giá.",
      ASKED_FOR_THE_ANSWER_SEVERAL_T:
        "Yêu cầu xem đáp án nhiều lần trước khi thử tự làm.",
      STARTED_WITH_A_MEANINGFUL_ATTE: "Bắt đầu với một nỗ lực có ý nghĩa.",
      STARTED_WITH_A_PARTIAL_ATTEMPT:
        "Bắt đầu với một nỗ lực giải được một phần.",
      STARTED_WITH_A_MINIMAL_ATTEMPT:
        "Bắt đầu với nỗ lực giải quyết tối thiểu.",
      ASKED_FOR_HELP_BEFORE_TRYING_A:
        "Yêu cầu trợ giúp trước khi thử làm bước đầu.",
      HINTS_DID_NOT_COME_UP_IN_THIS: "Không sử dụng gợi ý trong phiên học này.",
      HINT_LEVELS_WERE_NOT_RECORDED:
        "Không có dữ liệu gợi ý cho phiên học này, do đó không được tính.",
      WORKED_WITHOUT_HINT:
        "Làm bài mà không cần gợi ý, với mức gợi ý tối đa là {{ceiling}}.",
      NEEDED_HINTS:
        "Cần sử dụng mức gợi ý lên tới {{effectiveHint}} trên tối đa {{ceiling}}.",
      EXPLAINING_REASONING_DID_NOT_A:
        "Phần giải thích suy luận không được áp dụng trong phiên này.",
      WAS_ASKED_TO_EXPLAIN_THE_REASO:
        "Được yêu cầu giải thích quá trình suy luận nhưng không làm.",
      THE_EXPLANATION_RUBRIC_WAS_NOT:
        "Phần đánh giá giải thích không được tính cho phiên này.",
      DID_NOT_EXPLAIN: "Không giải thích quá trình suy nghĩ trong các bước.",
      MET_EXPLANATION_CRITERIA: "Đạt {{met}} trên 4 tiêu chí giải thích.",
      NO_TRANSFER_PROBLEM_WAS_OFFERE:
        "Không có bài tập vận dụng nào được đưa ra trong phiên học này.",
      A_TRANSFER_PROBLEM_WAS_OFFERED:
        "Có bài tập vận dụng nhưng không thử làm.",
      WHETHER_THE_TRANSFER_ANSWER_WA:
        "Không thể xác định kết quả bài tập vận dụng có đúng hay không.",
      SOLVED_A_SIMILAR_PROBLEM_INDEP: "Đã tự giải quyết một bài toán tương tự.",
      SOLVED_A_SIMILAR_PROBLEM_AFTER_NUDGE:
        "Giải được bài toán tương tự sau khi có một sự trợ giúp nhỏ.",
      SOLVED_A_SIMILAR_PROBLEM_AFTER_HINT:
        "Giải được bài toán tương tự sau một gợi ý nhỏ về khái niệm.",
      MADE_PARTIAL_PROGRESS_ON_A_SIM:
        "Hoàn thành được một phần bài toán tương tự.",
      ATTEMPTED_A_SIMILAR_PROBLEM_AN:
        "Đã thử làm một bài toán tương tự nhưng không ra kết quả đúng.",
      COULD_NOT_START_THE_SIMILAR_PR:
        "Chưa thể bắt đầu giải bài toán tương tự.",
      CHECKING_THE_ANSWER_DID_NOT_CO:
        "Không có việc kiểm tra đáp án trong phiên học này.",
      WAS_ASKED_TO_CHECK_THE_RESULT:
        "Được yêu cầu kiểm tra lại kết quả nhưng không làm.",
      VERIFICATION_BEHAVIOR_WAS_NOT:
        "Đánh giá hành vi kiểm tra chưa được thực hiện cho phiên này.",
      DID_NOT_CHECK: "Không kiểm tra lại kết quả.",
      MET_CHECKING_CRITERIA: "Đạt {{met}} trên 4 tiêu chí kiểm tra kết quả.",
    },
    recommendations: {
      KEEP_GOING:
        "Hãy tiếp tục phát huy. Thử giải một bài toán khó hơn để thử thách bản thân.",
      TRY_BEFORE_HELP:
        "Trước khi nhờ giúp đỡ, hãy viết ra một điều em nhận thấy về bài toán. Kể cả một khởi đầu sai cũng có giá trị.",
      TRY_ANOTHER_STEP:
        "Sau mỗi gợi ý, hãy tự làm thêm một bước trước khi yêu cầu gợi ý tiếp theo.",
      EXPLAIN_WHY:
        "Hãy nói lý do em chọn bước làm đó, không chỉ là em đã làm gì. Việc giải thích sẽ giúp em hiểu sâu hơn.",
      DO_SIMILAR:
        "Khi giải xong một bài toán, hãy thử làm bài tương tự ở cuối. Đó là cách thể hiện kết quả học tập.",
      CHECK_ANSWER:
        "Kiểm tra lại đáp án bằng cách thay kết quả vào bài toán gốc.",
    },
    title: "Tiến độ của bạn",
    desc: "Báo cáo này cho biết cách bạn học, không phải bạn thông minh như thế nào. Điểm số này không dùng để xếp hạng hay đánh giá năng lực.",
    noDataTitle: "Chưa có dữ liệu tiến độ",
    noDataDesc:
      "Điểm Độc lập của bạn sẽ xuất hiện sau khi bạn hoàn thành một phiên học. Điểm này dựa trên quá trình bạn giải quyết vấn đề, không chỉ dựa trên kết quả cuối cùng.",
    startSession: "Bắt đầu phiên học",
    score: "Điểm Độc lập",
    suppressedDesc:
      "Chưa đủ dữ liệu. Hãy học thêm một vài phiên để hệ thống đánh giá tiến độ của bạn.",
    sessionsScored:
      "Bạn có {{count}} phiên học được tính điểm. Điểm số sẽ xuất hiện khi có đủ dữ liệu.",
    scoredSessions: "{{count}} phiên học được tính điểm",
    trendUp: "▲ {{points}} điểm so với các phiên trước",
    trendDown: "▼ {{points}} điểm so với các phiên trước",
    excluded: "{{count}} phiên học không được tính điểm do lỗi hệ thống",
    tryNext: "Gợi ý tiếp theo",
    whatMakesUpScore: "Điểm của bạn bao gồm những gì",
    whatMakesUpScoreDesc:
      "Mỗi phần chỉ được đo lường khi phiên học đó cung cấp dữ liệu tương ứng. Các phần không có dữ liệu sẽ không bị trừ điểm.",
    measuredWithConfidence: "Đo lường với độ tin cậy {{confidence}}%.",
    weights:
      "Trọng số: Lần thử đầu {{firstAttempt}}, Sử dụng gợi ý {{hintEfficiency}}, Giải thích {{reasoningExplanation}}, Vận dụng {{transferPerformance}}, Kiểm tra {{verificationBehavior}}. Phiên bản điểm: {{scoringVersion}}.",
    recentSessions: "Các phiên học gần đây",
    notScoredError: "Không tính điểm: Có lỗi xảy ra từ phía hệ thống",
    notScoredSuppressed: "Không đủ dữ liệu để tính điểm",
    covered: "Bao phủ {{coverage}}% các hành vi được đo lường",
    notApplicable: "không có dữ liệu",
    declined: "được đề nghị nhưng không nhận",
    unavailable: "chưa ghi nhận",
    infoBtn: "Tìm hiểu về Điểm Độc lập",
  },
  session: {
    thisSession: "Phiên học này",
    nothingRecorded: "chưa ghi nhận hành vi nào",
    behaviorsShown: "{{count}} / 5 hành vi",
    notScored: "Không tính điểm: Có lỗi xảy ra từ phía hệ thống",
    keepGoing: "Tiếp tục học để xem điểm số",
    soFar: " / 100 cho đến hiện tại",
    infoBtn: "Tìm hiểu về các hành vi học tập",
    firstTry: "Lần thử đầu",
    hintUse: "Sử dụng gợi ý",
    explaining: "Giải thích",
    transfer: "Vận dụng",
    checking: "Kiểm tra",
  },
  modals: {
    sessionBehaviors: {
      title: "Đánh giá phiên học này",
      desc1: "ThinkFirst tìm kiếm 5 hành vi học tập trong quá trình bạn học.",
      desc2:
        "Những hành vi này giúp đánh giá khả năng tự giải quyết vấn đề của bạn.",
      firstTryTitle: "1. Lần thử đầu (First try)",
      firstTryDesc:
        "Đánh giá xem bạn có thực sự tự mình thử làm trước khi nhận sự trợ giúp hay không. Lần thử đầu không cần phải chính xác — một bước đi hợp lý đã là một nỗ lực đáng ghi nhận.",
      hintUseTitle: "2. Sử dụng gợi ý (Hint use)",
      hintUseDesc:
        "Gợi ý luôn ở đó khi bạn cần. ThinkFirst đo lường lượng gợi ý bạn sử dụng và liệu bạn có thể tự tiếp tục giải quyết vấn đề sau khi nhận gợi ý hay không.",
      explainingTitle: "3. Giải thích (Explaining)",
      explainingDesc:
        "Việc giải thích cách làm hoặc suy luận của bạn chứng tỏ bạn thực sự hiểu khái niệm, thay vì chỉ đơn thuần đưa ra đáp án.",
      transferTitle: "4. Vận dụng (Transfer)",
      transferDesc:
        "Một bài toán tương tự sẽ kiểm tra khả năng áp dụng kiến thức bạn vừa học, giúp đảm bảo rằng bạn đã thực sự hiểu bài.",
      checkingTitle: "5. Kiểm tra (Checking)",
      checkingDesc:
        "Kiểm tra lại bài làm giúp bạn xác minh các tính toán, giả định, hoặc suy luận trước khi nộp kết quả cuối cùng.",
      gotIt: "Đã hiểu",
    },
    independenceScore: {
      title: "Về Điểm Độc Lập",
      desc: "Điểm Độc Lập thể hiện khả năng tự giải quyết vấn đề của bạn. Nó được xây dựng dựa trên các hành vi học tập, không chỉ phụ thuộc vào tính chính xác của các câu trả lời.",
      notGrade:
        "Đây không phải là điểm số chính thức, chỉ số thông minh, hay bảng xếp hạng so với các học sinh khác.",
      evidence:
        "Điểm số chỉ xuất hiện khi hệ thống có đủ bằng chứng đánh giá. Điểm sẽ thay đổi theo thời gian khi bạn tiếp tục luyện tập và học hỏi.",
      gotIt: "Đã hiểu",
    },
  },
};
