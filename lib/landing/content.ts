// lib/landing/content.ts — Every word on the public landing page, typed so sections stay copy-free.

export type LandingAnchor = 'features' | 'try' | 'how' | 'faq'
export type TextLink = { label: string; href: string }
export type IconName =
  | 'past-questions' | 'notes' | 'gst-free' | 'upload' | 'theory' | 'exam' | 'tutors'
  | 'faculty' | 'vetted' | 'organised' | 'free-trial' | 'quiz-ready'

export type LandingImage = { src: string; width: number; height: number; alt: string }

export type Feature = { icon: IconName; title: string; text: string; highlight?: boolean; badge?: string; campusBot?: boolean }
export type ShowcaseRow = {
  eyebrow: string
  title: string
  text: string
  ticks: string[]
  phones: LandingImage[]
  chip?: { icon: IconName; label: string }
  flip?: boolean
}
export type SampleQuestion = {
  /** The bank's own question ID, so a test can prove the item is copied unchanged. */
  questionId: string
  course: string
  question: string
  options: string[]
  answer: number
  explanation: string
}
export type FaqItem = { question: string; answer: string }

// Catalogue figures. The faculty catalogue lives in the database, not in code, so these are the page's only source.
const DEPARTMENT_COUNT = 8
const LEVEL_RANGE = '100L–300L'

const REGISTER = '/register'
const LOGIN = '/login'

export const landingContent = {
  brand: {
    name: 'CampusIntell',
    tagline: 'Study Hard. Study Smart...',
    logo: { src: '/landing/logo-full.png', width: 640, height: 184, alt: 'CampusIntell' },
    homeLabel: 'CampusIntell home',
  },
  images: {
    hero: { src: '/landing/hero.webp', width: 900, height: 975, alt: '' },
    campusBot: { src: '/landing/campus-bot.png', width: 420, height: 400, alt: '' },
  },
  header: {
    navLabel: 'Primary',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Try a question', href: '#try' },
      { label: 'How it works', href: '#how' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Browse courses', href: '/courses' },
    ] satisfies TextLink[],
    login: { label: 'Log in', href: LOGIN },
    register: { label: 'Create account', href: REGISTER },
    menuLabel: 'Menu',
    menuOpen: 'Open menu',
    menuClose: 'Close menu',
  },
  hero: {
    chipStrong: 'Free',
    chipText: 'to start · GST courses free for every faculty',
    tagline: 'Study Hard. Study Smart...',
    titleLead: 'Walk into every exam already',
    titleEmphasis: 'prepared.',
    lead: 'Verified past questions, notes that follow your course outline, and model answers for theory. Everything for your exact courses, in one place.',
    primary: { label: 'Start for free', href: REGISTER },
    secondary: { label: 'Try a real question', href: '#try' },
    earlyAccess: 'Before launch: join Early Access for a free month',
    trust: [`${DEPARTMENT_COUNT} management science departments`, '100L to 300L'],
    chips: [
      { icon: 'past-questions', title: 'Past questions', note: 'Verified answers' },
      { icon: 'exam', title: 'Exam mode', note: 'Timed, like the real hall' },
    ] satisfies Array<{ icon: IconName; title: string; note: string }>,
  },
  strip: {
    label: 'Courses on CampusIntell',
    heading: "Practice for the courses you're actually taking",
    freeSuffix: 'free',
    courses: ['ACC 101', 'AMS 101', 'BUA 102', 'ECO 101', 'FIN 101', 'INS 102', 'SOC 101', 'GST 112', 'LAG-BUA 111',
      'LAG-BUA 125', 'ACS 101', 'PUL 101', 'ACC-CM 201', 'ACC-CM 204', 'ACS 209', 'BUA 201', 'BUA 204', 'BUA 205',
      'BUA 216', 'ECO 203', 'ENT 211', 'FIN-CM 209', 'FIN 216', 'TAX-CM 223', 'GST 212'],
  },
  features: {
    id: 'features' satisfies LandingAnchor,
    eyebrow: 'What you get',
    title: 'Built from your class notes.',
    text: 'Class notes, past questions and course outlines go in. Study guides and practice questions come out.',
    items: [
      { icon: 'past-questions', highlight: true, title: 'Past questions, verified',
        text: 'Old past questions plus new questions drawn from your own course, turned into practice sets. Every answer is checked before it goes live.' },
      { icon: 'notes', title: 'Notes that follow your outline',
        text: 'Study guides compiled from class notes and recommended textbooks, explained topic by topic in the order your course is taught.' },
      { icon: 'upload', campusBot: true, title: 'Upload notes, get a quiz',
        text: 'No material for your course yet? Upload what you have and Campus Bot turns it into practice questions.' },
      { icon: 'theory', title: 'Theory answers, model answers',
        text: "Write your answer, then compare it with the model answer and note what you'd improve." },
      { icon: 'exam', title: 'Exam mode',
        text: "Timed practice that holds your results until the end, so exam day feels like something you've done before." },
      { icon: 'tutors', badge: 'Coming soon', title: 'Peer Tutors',
        text: "Book a session with alumni and senior students who've already passed your course." },
    ] satisfies Feature[],
  },
  showcase: [
    {
      eyebrow: 'From your notes',
      title: 'Upload your notes. Get a quiz in seconds.',
      text: 'Upload handouts or your own notes. Campus Bot reads them and builds practice questions from exactly what you were taught.',
      ticks: ['Works with PDF, Word and text files', 'Questions come with explanations'],
      phones: [
        { src: '/landing/upload.jpg', width: 432, height: 896, alt: 'CampusIntell upload screen' },
        { src: '/landing/question.jpg', width: 432, height: 896, alt: 'A practice question generated from notes' },
      ],
      chip: { icon: 'quiz-ready', label: 'Quiz ready' },
    },
    {
      eyebrow: 'Theory questions',
      title: 'Write your answer. Compare and improve.',
      text: 'Theory is where marks are won and lost. Type your answer, then compare it with the model answer.',
      ticks: ['Compare your answer with a model answer', "Note what you'd improve", 'Rewrite and try again until it sticks'],
      phones: [
        { src: '/landing/theory.webp', width: 432, height: 896, alt: 'A theory answer beside the model answer' },
      ],
      flip: true,
    },
  ] satisfies ShowcaseRow[],
  tryQuestion: {
    id: 'try' satisfies LandingAnchor,
    eyebrow: 'Try it now',
    title: 'Answer a real question. No sign-up.',
    text: 'These come straight from our question banks. Tap an option and see the explanation, just like inside the app.',
    cardLabel: 'Live practice question',
    modeSwitch: 'Exam mode',
    modeInstant: 'Instant feedback',
    modeExam: 'Exam mode: timed, results at the end',
    labelPractice: 'Practice',
    labelExam: 'Exam mode',
    progress: 'Question {current} of {total}',
    promptInstant: 'Pick an answer to see why it is right.',
    promptExam: 'Exam mode: answers are revealed at the end.',
    savedExam: 'Answer saved. You will see the result at the end.',
    correct: 'Correct',
    correctAnswer: 'Correct answer',
    yourAnswer: 'Your answer',
    explanationLabel: 'Why:',
    next: 'Next question',
    finish: 'See your score',
    bubble: {
      start: 'Try me. Tap an answer!',
      right: 'Correct! Nice one.',
      wrong: 'Not quite. Read why below.',
      saved: 'Saved. Results at the end.',
      perfect: 'You are exam ready!',
      other: 'Practice makes perfect.',
    },
    score: '{right}/{total}',
    scoreLabel: 'You got {right} out of {total}.',
    endPerfect: 'Perfect score.',
    endSome: 'Good start.',
    endNone: 'Now you know why.',
    endText: 'Practise real questions like these for your exact courses.',
    cta: { label: 'Get the full question bank', href: REGISTER },
    again: 'Play again',
    // BUA 201 bank (lib/data/quizzes.ts) questions 6 and 7. Explanations restate the BUA 201 notes only.
    questions: [
      {
        questionId: 'e63c851d-e798-4f45-a83f-7b5babab3bf8',
        course: 'BUA 201 · Principles of Business Administration I',
        question: 'Who is associated with Scientific Management and time/motion studies?',
        options: ['Henri Fayol', 'Frederick Taylor', 'Elton Mayo', 'Max Weber'],
        answer: 1,
        explanation: 'Taylor founded Scientific Management, built on time and motion studies. Fayol is linked to the 14 principles, Weber to bureaucracy and Mayo to human relations.',
      },
      {
        questionId: '4af15497-6d85-4291-a672-c94275a3664c',
        course: 'BUA 201 · Principles of Business Administration I',
        question: 'Henri Fayol introduced how many principles of management?',
        options: ['10', '14', '20', '5'],
        answer: 1,
        explanation: "Fayol's administrative management sets out 14 principles, including scalar chain, esprit de corps and unity of command.",
      },
    ] satisfies SampleQuestion[],
  },
  how: {
    id: 'how' satisfies LandingAnchor,
    eyebrow: 'How it works',
    title: 'Your semester, set up in a minute.',
    text: 'Choose your courses once. Everything is arranged around them.',
    steps: [
      { title: 'Pick your path',
        text: "Department, level, semester. We show your shared courses and your department's own courses." },
      { title: 'Practise two ways',
        text: 'Instant feedback explains each answer as you go. Exam mode times you and saves results for the end.' },
      { title: 'Close the gaps',
        text: 'See the right answer and where you went wrong, so you learn the topic, not just the question.' },
    ],
  },
  why: {
    eyebrow: 'Why CampusIntell',
    title: 'Not another generic study platform.',
    cards: [
      { icon: 'faculty', title: 'Made for your faculty',
        text: "Built around the actual courses in your faculty, not a one-size-fits-all syllabus. We're starting with Management Sciences and expanding to more faculties." },
      { icon: 'vetted', title: 'Every question vetted',
        text: "Every question is vetted by our team before it goes up. Spot something off? Tap the flag button and we'll review it." },
      { icon: 'organised', title: 'Nothing gets lost',
        text: 'Notes get scattered across group chats and disappear every semester. Here they stay organised by course and topic.' },
      { icon: 'free-trial', title: 'Try before you pay',
        text: 'Start a free 72-hour Discovery Pass to try your department courses. GST courses are always free.' },
    ] satisfies Array<{ icon: IconName; title: string; text: string }>,
    figures: [
      { value: String(DEPARTMENT_COUNT), label: 'management science departments' },
      { value: LEVEL_RANGE, label: 'both semesters at every level' },
      { value: 'GST free', label: 'for UNILAG students in every faculty' },
    ],
  },
  otherFaculties: {
    eyebrow: 'Other faculties',
    title: 'Your faculty not here yet?',
    text: "You can still sign up today. We're adding more faculties, and you'll be first to know when yours goes live.",
    signUp: { label: 'Sign up free', href: REGISTER },
    waitlist: 'Join the waitlist',
    waitlistMessage: "I'd like to join the waitlist for my faculty.",
    items: [
      { icon: 'gst-free', title: 'GST courses, free', text: 'Free for every UNILAG student, in every faculty.' },
      { icon: 'upload', title: 'Quiz yourself from your own PDFs', text: 'Upload your notes and generate practice questions.' },
      { icon: 'campus-bot', title: 'An AI tutor that teaches you', text: "Ask Campus Bot to explain anything you don't understand." },
    ] satisfies Array<{ icon: IconName | 'campus-bot'; title: string; text: string }>,
  },
  faq: {
    id: 'faq' satisfies LandingAnchor,
    eyebrow: 'FAQ',
    title: 'Questions students ask.',
    helpLead: 'Still unsure? Message us on',
    helpInstagram: 'Instagram',
    helpJoin: 'or email',
    items: [
      { question: 'Which courses are available?',
        answer: `Every course across the ${DEPARTMENT_COUNT} departments of the Faculty of Management Sciences, from 100 to 300 level. Material is added course by course, and you can request what's missing. General Studies (GST) courses are free for students in every faculty at UNILAG.` },
      { question: 'Where do the questions come from?',
        answer: 'From real past papers, class tests, the course outline and class notes. We also generate new questions from your course materials. Every question is vetted by our team and can be practised in exam mode.' },
      { question: 'What if my course has no material yet?',
        answer: "Upload your own notes and Campus Bot will generate practice from them. You can also request the course in the WhatsApp community, and if anyone has material for it, we'll share it there." },
      { question: 'How does theory practice work?',
        answer: "You type your answer, then compare it with the model answer, note what you'd improve and try again." },
      { question: 'Can I try it before paying?',
        answer: 'Yes. Start a free 72-hour Discovery Pass to try your department courses. GST courses are always free.' },
    ] satisfies FaqItem[],
  },
  finalCta: {
    title: 'Your next exam is closer than you think.',
    text: "Set up your semester in a minute and start practising today. It's free to start.",
    primary: { label: 'Start for free', href: REGISTER },
    secondary: { label: 'Log in', href: LOGIN },
    community: 'Join the WhatsApp community',
  },
  footer: {
    text: 'Structured notes, verified past questions and timed practice for your exact courses.',
    productHeading: 'Product',
    product: [
      { label: 'Features', href: '#features' },
      { label: 'Try a question', href: '#try' },
      { label: 'How it works', href: '#how' },
      { label: 'FAQ', href: '#faq' },
    ] satisfies TextLink[],
    contactHeading: 'Contact',
    whatsApp: 'WhatsApp us',
    followHeading: 'Follow',
    instagram: 'Instagram',
    x: 'X (Twitter)',
    communityHeading: 'Community',
    newsletter: 'Newsletter coming soon.',
    copyright: '© {year} CampusIntell',
  },
  newTab: '(opens in a new tab)',
}
