export const en = {
  common: {
    loading: "Loading...",
    save: "Save changes",
    saving: "Saving...",
    saved: "Settings saved.",
    error: "An error occurred.",
    dashboard: "Dashboard",
    settings: "Settings",
    sessions: "Sessions",
    progress: "Progress",
    classrooms: "Classrooms",
    logout: "Logout",
    skipToMain: "Skip to main content",
    forTeachers: "for Teachers",
    guide: "Guide",
  },
  auth: {
    notProvided: "Not provided",
    unknown: "Unknown",
  },
  student: {
    welcome: "Welcome, {{name}}",
    ready: "Ready to learn today?",
    startNew: "Start a new session",
    practiceDesc: "Practice math or science with your adaptive AI tutor.",
    startLearning: "Start Learning",
    yourProgress: "Your Progress",
    details: "Details",
    independenceScore: "Independence Score",
    notEnoughPractice:
      "Not enough practice yet to estimate this. Work through a session to see how you are learning.",
    basedOn: "Based on {{count}} session(s)",
    classrooms: "Classrooms",
    joinCodeDesc:
      "Have a join code from your teacher? Add yourself to their classroom.",
    joinClassroom: "Join a classroom",
  },
  newSession: {
    title: "Start Learning Session",
    subject: "Subject",
    math: "Mathematics",
    science: "Science",
    mode: "Learning Mode",
    learn: "Learn (New Concept)",
    practice: "Practice (Guided)",
    assignment: "Assignment (Attempt Required)",
    verify: "Verify (Check AI)",
    problem: "What problem are you working on?",
    problemPlaceholder: "e.g. Solve x² - 5x + 6 = 0",
    startBtn: "Start Session",
    startingBtn: "Starting...",
    errorEmpty: "Please enter a problem, or upload a photo of one",
    errorImage: "Check and confirm the text from your image before starting.",
    errorStart: "Failed to start session",
  },
  teacher: {
    welcome: "Welcome, {{name}}",
    overview: "Classroom Overview",
    profileInfo: "Profile Information",
    name: "Name",
    email: "Email",
    role: "Role",
    language: "Language",
    languageDesc: "The interface will be displayed in this language.",
    dashboardLoadError: "Dashboard could not be loaded",
    tryAgain: "Try again",
    dashboardDesc:
      "Across {{classCount}} classroom(s) and {{studentCount}} student(s).",
    activeStudents: "Active students",
    activeStudentsCaption: "In the last 7 days",
    activeStudentsHelp:
      "Students who started or completed at least one learning session in the last seven days.",
    sessionsCompleted: "Sessions completed",
    sessionsCompletedCaption: "{{total}} in total",
    sessionsCompletedHelp:
      "Learning sessions marked completed in the last seven days.",
    attemptBeforeHelp: "Attempt before help",
    attemptBeforeHelpHelp:
      "How often a student made a genuine attempt before asking for help.",
    transferSuccess: "Transfer success",
    transferSuccessHelp:
      "Transfer success measures performance on a similar problem after guided assistance. It is not an official grade.",
    yourClassrooms: "Your classrooms",
    viewAll: "View all",
    noClassrooms: "You have not created any classrooms yet.",
    createClassroom: "Create classroom",
    activeThisWeek: "Active this week",
    topicsReview: "Topics needing review",
    noTopicsReview:
      "No topic currently shows a wide gap between guided and independent work.",
    gapPoints: "Guided minus independent",
    classEvidence: "Class-wide evidence",
    avgHintLevel: "Average highest hint level",
    notMeasured: "Not yet measured",
    avgHintLevelDesc:
      "On the 0 to 7 hint ladder. A higher number means students needed more guidance.",
    reportedIssues: "AI answers reported as incorrect",
    reportedIssuesDesc: "Open reports awaiting review.",
    howToRead: "How to read these numbers",
    howToReadDesc:
      "These figures describe learning behavior, not achievement. They are not grades, and a low number is a prompt to look closer.",
  },
  settings: {
    accountSettings: "Account Settings",
    applyToEverySession:
      "These apply to every new session, so the tutor matches your level and language.",
    language: "Language",
    languageTutorDesc: "The tutor will explain in this language.",
    grade: "Grade",
    gradeDesc: "Used to pitch explanations at the right level.",
    helpAmount: "How much help do you want?",
    helpAmountDesc: "Your teacher can override this for assignments.",
    supportive: "Supportive",
    supportiveDesc: "More scaffolding earlier when you get stuck.",
    balanced: "Balanced",
    balancedDesc: "The default. Hints step up gradually as you work.",
    independence: "Independence",
    independenceDesc:
      "Fewer hints. You are pushed to try more on your own first.",
    couldNotSave: "Could not save your settings. Please try again.",
  },
  guide: {
    studentTitle: "Student Guide",
    teacherTitle: "Teacher Guide",
  },
  joinClassroom: {
    back: "Back",
    title: "Join a classroom",
    desc: "Enter the code your teacher shared with you.",
    codeLabel: "Join code",
    codePlaceholder: "ABC123",
    joining: "Joining...",
    joinBtn: "Join classroom",
    emptyError: "Enter the join code your teacher gave you.",
    error: "Could not join the classroom. Please try again.",
  },
  onboarding: {
    welcome: "Welcome to ThinkFirst",
    error: "Failed to create profile. Please try again.",
    roleQuestion: "Are you a student or a teacher?",
    student: "Student",
    studentDesc: "I want to practice and learn",
    teacher: "Teacher",
    teacherDesc: "I want to manage a classroom",
    continue: "Continue",
    gradeQuestion: "What is your grade level?",
    grade: "Grade {{grade}}",
    langQuestion: "Preferred Language",
    back: "Back",
    creating: "Creating...",
    complete: "Complete Setup",
  },

  domain: {
    subjects: {
      mathematics: "Mathematics",
      science: "Science",
      other: "Other",
    },
    modes: {
      learn: "Learn",
      practice: "Practice",
      assignment: "Assignment",
      verify: "Verify",
    },
    strictness: {
      supportive: "Supportive",
      balanced: "Balanced",
      independence: "Independence",
      assessment_safe: "Assessment Safe",
    },
    sessionStatus: {
      active: "Active",
      completed: "Completed",
      abandoned: "Abandoned",
    },
    hintLevels: {
      0: "Attempt",
      1: "Verify",
      2: "Clarify",
      3: "Investigate",
      4: "Sub-goal",
      5: "Guided execution",
      6: "Final step",
      7: "Full solution",
    },
  },
  mySessions: {
    title: "My sessions",
    subtitle: "Pick up where you left off, or start something new.",
    startSession: "Start a session",
    loading: "Loading your sessions",
    sessionExpired: "Your sign-in has expired. Reload the page to continue.",
    tryAgain: "Try again",
    noSessionsTitle: "No sessions yet",
    noSessionsDesc:
      "Start a session with a problem you are working on, and your conversation will be saved here so you can come back to it.",
    startFirst: "Start your first session",
    untitledProblem: "Untitled problem",
    hintLevel: "Hint level {{current}} / {{max}}",
  },
  sessionActions: {
    checkStep: "Check my step",
    stuck: "I'm stuck",
    explainConcept: "Explain concept",
    smallerHint: "Smaller hint",
    explainDifferently: "Explain differently",
    reportIssue: "Report an issue",
  },
  activeSession: {
    messages_one: "1 message",
    messages_other: "{{count}} messages",
    problem: "Problem",
    scratchpad: "Scratchpad",
    scratchpadPlaceholder: "Work out your steps here. Only you can see this.",
    composerPlaceholder: "Explain your step or ask a question...",
    send: "Send",
    hintLevel: "Hint level",
    hintLevelDisplay: "Hint level {{current}} of {{max}}: {{rung}}",
  },

  progress: {
    evidence: {
      NOT_RECORDED:
        "This was not recorded yet, so it is not counted either way.",
      NOT_ENOUGH_EVIDENCE: "Not enough evidence yet.",
      STARTING_THE_PROBLEM_YOURSELF:
        "Starting the problem yourself did not apply in this session.",
      NO_FIRST_ATTEMPT_WAS_RECORDED:
        "No first attempt was recorded, so this could not be measured.",
      ASKED_FOR_THE_ANSWER_SEVERAL_T:
        "Asked for the answer several times before trying a step.",
      STARTED_WITH_A_MEANINGFUL_ATTE: "Started with a meaningful attempt.",
      STARTED_WITH_A_PARTIAL_ATTEMPT: "Started with a partial attempt.",
      STARTED_WITH_A_MINIMAL_ATTEMPT: "Started with a minimal attempt.",
      ASKED_FOR_HELP_BEFORE_TRYING_A:
        "Asked for help before trying a first step.",
      HINTS_DID_NOT_COME_UP_IN_THIS: "Hints did not come up in this session.",
      HINT_LEVELS_WERE_NOT_RECORDED:
        "Hint levels were not recorded for this session, so this is not counted.",
      WORKED_WITHOUT_HINT:
        "Worked without asking for a hint, with level {{ceiling}} available.",
      NEEDED_HINTS:
        "Needed hints up to level {{effectiveHint}} of {{ceiling}} available.",
      EXPLAINING_REASONING_DID_NOT_A:
        "Explaining reasoning did not apply in this session.",
      WAS_ASKED_TO_EXPLAIN_THE_REASO:
        "Was asked to explain the reasoning and did not.",
      THE_EXPLANATION_RUBRIC_WAS_NOT:
        "The explanation rubric was not evaluated for this session.",
      DID_NOT_EXPLAIN: "Did not explain the thinking behind the steps.",
      MET_EXPLANATION_CRITERIA: "Met {{met}} of 4 explanation criteria.",
      NO_TRANSFER_PROBLEM_WAS_OFFERE:
        "No transfer problem was offered in this session.",
      A_TRANSFER_PROBLEM_WAS_OFFERED:
        "A transfer problem was offered and not attempted.",
      WHETHER_THE_TRANSFER_ANSWER_WA:
        "Whether the transfer answer was correct could not be established.",
      SOLVED_A_SIMILAR_PROBLEM_INDEP: "Solved a similar problem independently.",
      SOLVED_A_SIMILAR_PROBLEM_AFTER_NUDGE:
        "Solved a similar problem after a small nudge.",
      SOLVED_A_SIMILAR_PROBLEM_AFTER_HINT:
        "Solved a similar problem after one concept hint.",
      MADE_PARTIAL_PROGRESS_ON_A_SIM:
        "Made partial progress on a similar problem.",
      ATTEMPTED_A_SIMILAR_PROBLEM_AN:
        "Attempted a similar problem and did not reach a correct answer.",
      COULD_NOT_START_THE_SIMILAR_PR:
        "Could not start the similar problem yet.",
      CHECKING_THE_ANSWER_DID_NOT_CO:
        "Checking the answer did not come up in this session.",
      WAS_ASKED_TO_CHECK_THE_RESULT:
        "Was asked to check the result and did not.",
      VERIFICATION_BEHAVIOR_WAS_NOT:
        "Verification behavior was not evaluated for this session.",
      DID_NOT_CHECK: "Did not check the result.",
      MET_CHECKING_CRITERIA: "Met {{met}} of 4 checking criteria.",
    },
    recommendations: {
      KEEP_GOING:
        "Keep going the way you are. Try a harder problem to stretch yourself.",
      TRY_BEFORE_HELP:
        "Before asking for help, write down one thing you notice about the problem. Even a wrong start counts.",
      TRY_ANOTHER_STEP:
        "After each hint, try one more step on your own before asking for the next one.",
      EXPLAIN_WHY:
        "Say why you chose a step, not just what you did. Explaining it makes it stick.",
      DO_SIMILAR:
        "When you finish a problem, try the similar one offered at the end. That is where learning shows.",
      CHECK_ANSWER:
        "Check your answer by substituting it back into the original problem.",
    },
    title: "Your Progress",
    desc: "This describes how you learn, not how smart you are. It is never shown as a grade or a ranking.",
    noDataTitle: "No progress data yet",
    noDataDesc:
      "Your Independence Score appears once you have worked through a session. It is built from what you do while solving, not from right answers alone.",
    startSession: "Start a session",
    score: "Independence Score",
    suppressedDesc: "Not enough practice yet to estimate this.",
    sessionsScored:
      "You have {{count}} scored session(s). A score appears once there is enough evidence for it to mean something.",
    scoredSessions: "{{count}} scored session(s)",
    trendUp: "▲ {{points}} points vs earlier sessions",
    trendDown: "▼ {{points}} points vs earlier sessions",
    excluded: "{{count}} not scored because something went wrong on our side",
    tryNext: "One thing to try next",
    whatMakesUpScore: "What makes up your score",
    whatMakesUpScoreDesc:
      "Each part is measured only when a session gives evidence for it. Parts that did not come up are not counted against you.",
    measuredWithConfidence: "Measured with {{confidence}}% confidence.",
    weights:
      "Weights: first attempt {{firstAttempt}}, hint efficiency {{hintEfficiency}}, reasoning {{reasoningExplanation}}, transfer {{transferPerformance}}, verification {{verificationBehavior}}. Scoring version {{scoringVersion}}.",
    recentSessions: "Recent sessions",
    notScoredError: "Not scored: something went wrong on our side",
    notScoredSuppressed: "Not enough activity to score",
    covered: "Covered {{coverage}}% of what we look at",
    notApplicable: "did not come up",
    declined: "offered, not taken",
    unavailable: "not recorded",
    infoBtn: "Learn about Independence Score",
  },
  session: {
    thisSession: "This session",
    nothingRecorded: "nothing recorded yet",
    behaviorsShown: "{{count}} of 5 behaviors shown",
    notScored: "Not scored: something went wrong on our side",
    keepGoing: "Keep going to see your score",
    soFar: " / 100 so far",
    infoBtn: "Learn about session behaviors",
    firstTry: "First try",
    hintUse: "Hint use",
    explaining: "Explaining",
    transfer: "Transfer",
    checking: "Checking",
  },
  modals: {
    sessionBehaviors: {
      title: "How this session is measured",
      desc1: "ThinkFirst looks for five learning behaviors while you work.",
      desc2: "They help show how independently you worked through the problem.",
      firstTryTitle: "1. First try",
      firstTryDesc:
        "Shows whether you made a meaningful attempt before receiving substantial help. It does not need to be correct — trying a reasonable first step still matters.",
      hintUseTitle: "2. Hint use",
      hintUseDesc:
        "Hints are there when you need them. ThinkFirst looks at how much help you needed and whether you continued the reasoning yourself afterward.",
      explainingTitle: "3. Explaining",
      explainingDesc:
        "Explaining your reasoning helps show that you truly understand the concepts, rather than just entering a final answer.",
      transferTitle: "4. Transfer",
      transferDesc:
        "A related problem checks whether you can apply what you just learned independently, showing that the idea was actually learned.",
      checkingTitle: "5. Checking",
      checkingDesc:
        "Reviewing your work helps verify your calculations, assumptions, or reasoning before submitting a final answer.",
      gotIt: "Got it",
    },
    independenceScore: {
      title: "About the Independence Score",
      desc: "The Independence Score represents your ability to solve problems on your own. It is built from your learning behaviors, not just whether your final answers are correct.",
      notGrade:
        "This is not an official grade, an intelligence score, or a ranking against other students.",
      evidence:
        "A score only appears when there is enough evidence for it to mean something. It changes over time as you continue to practice and learn.",
      gotIt: "Got it",
    },
  },
};
