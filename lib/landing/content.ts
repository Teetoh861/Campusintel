// lib/landing/content.ts — Every word on the public landing page, typed so sections stay copy-free.
import { LANDING_FIGURES } from './figures'

export type LandingAnchor = 'try' | 'features' | 'faq'
export type TextLink = { label: string; href: string }
export type IconName = 'past-questions' | 'notes' | 'exam' | 'upload'

export type LandingImage = { src: string; width: number; height: number; alt: string }

export type Feature = { icon: IconName; title: string; text: string; highlight?: boolean }
export type ShowcaseRow = {
  eyebrow: string
  title: string
  text: string
  ticks: string[]
  /** Real app screens, each 350 CSS px wide at 2x. */
  shots: LandingImage[]
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

const REGISTER = '/register'
const LOGIN = '/login'
const NUMBER = new Intl.NumberFormat('en-GB')

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
      { label: 'Try a question', href: '#try' },
      { label: 'FAQ', href: '#faq' },
    ] satisfies TextLink[],
    login: { label: 'Log in', href: LOGIN },
    register: { label: 'Create account', href: REGISTER },
  },
  hero: {
    titleLead: 'Walk into every exam already',
    titleEmphasis: 'prepared.',
    lead: 'Verified past questions, study guides and timed exam practice for UNILAG Management Sciences students.',
    primary: { label: 'Start for free', href: REGISTER },
    secondary: { label: 'Try a real question', href: '#try' },
    earlyAccess: 'Before launch: join Early Access for a free month',
  },
  tryQuestion: {
    id: 'try' satisfies LandingAnchor,
    eyebrow: 'Try it now',
    title: 'Answer a real question. No sign-up.',
    text: 'These come straight from our GST 111 question bank.',
    cardLabel: 'Live practice question',
    modeSwitch: 'Exam mode',
    modeInstant: 'Each answer is explained as you go.',
    modeExam: 'Your results come at the end.',
    labelPractice: 'Practice',
    labelExam: 'Exam mode',
    progress: 'Question {current} of {total}',
    savedExam: 'Answer saved. You will see the result at the end.',
    correct: 'Correct',
    correctAnswer: 'Correct answer',
    yourAnswer: 'Your answer',
    explanationLabel: 'Why:',
    next: 'Next question',
    finish: 'See your score',
    bubble: {
      start: 'Ready when you are.',
      right: 'Correct! Nice one.',
      wrong: "Not quite. Here's why.",
      saved: 'Saved. Results at the end.',
      perfect: 'Nice work!',
      other: 'Practice makes perfect.',
    },
    score: '{right}/{total}',
    scoreLabel: 'You got {right} out of {total}.',
    endPerfect: 'Perfect score.',
    endSome: 'Good start.',
    endNone: 'Now you know why.',
    endText: 'Practise real questions like these for your courses.',
    cta: { label: 'Get the full question bank', href: REGISTER },
    again: 'Play again',
    // GST 111 is free. Copied word for word from the official GST111 bank (GST111_Platform.json), by bank ID.
    questions: [
      {
        questionId: 'G111N1-016',
        course: 'GST 111 · Communication in English',
        question: 'How many consonant phonemes does English have?',
        options: ['24', '12', '44', '20'],
        answer: 0,
        explanation: 'Of the 44 English phonemes, 24 are consonants and 20 are vowels. The figure 44 is the total of all sounds, not the consonants alone.',
      },
      {
        questionId: 'G111N1-098',
        course: 'GST 111 · Communication in English',
        question: 'Which type of memory is described as permanent, large and limitless?',
        options: ['Working memory', 'Long-term memory', 'Sensory memory', 'Short-term memory'],
        answer: 1,
        explanation: 'Long-term memory is permanent, large and limitless. Short-term memory keeps information only for a short time before filtering it.',
      },
    ] satisfies SampleQuestion[],
  },
  features: {
    id: 'features' satisfies LandingAnchor,
    eyebrow: 'What you get',
    title: 'Practice built around your courses.',
    items: [
      { icon: 'past-questions', highlight: true, title: 'Verified past questions',
        text: 'Past questions and new questions for your course, each one vetted by our team.' },
      { icon: 'notes', title: 'Study guides by topic',
        text: 'Notes that follow your course outline, one topic at a time.' },
      { icon: 'exam', title: 'Exam mode',
        text: 'Timed practice that holds your results until the end.' },
      { icon: 'upload', title: 'Campus Bot practice from your notes',
        text: 'When a course has no study materials yet, Campus Bot builds practice questions from your notes.' },
    ] satisfies Feature[],
  },
  // The only place that explains Campus Bot practice and theory practice.
  showcase: [
    {
      eyebrow: 'From your notes',
      title: 'Practice questions from your own notes.',
      text: 'For a course with no study materials yet, Campus Bot builds practice questions from the notes you upload.',
      ticks: ['PDF, Word and text files', 'An explanation and a quote from your notes with each answer'],
      shots: [
        { src: '/landing/upload-notes.webp', width: 700, height: 696, alt: 'The card for uploading notes on the Practise from your notes screen' },
        { src: '/landing/campus-bot-question.webp', width: 700, height: 1542, alt: 'A Campus Bot question, answered, with its explanation and a quote from the notes' },
      ],
    },
    {
      eyebrow: 'Theory questions',
      title: 'Theory questions with suggested answers.',
      text: 'Practise theory questions and see a suggested answer for each one.',
      ticks: [],
      shots: [
        { src: '/landing/theory-answer.webp', width: 700, height: 1228, alt: 'A theory question with a typed answer and the suggested answer' },
      ],
      flip: true,
    },
  ] satisfies ShowcaseRow[],
  // Counted from the repository's content when the site is built (scripts/landing/figures.cjs).
  courses: {
    label: 'Courses on CampusIntell',
    figures: [
      { value: NUMBER.format(LANDING_FIGURES.courses), label: 'courses ready to practise' },
      { value: NUMBER.format(LANDING_FIGURES.questions), label: 'questions' },
      { value: NUMBER.format(LANDING_FIGURES.departments), label: 'departments' },
    ],
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
        answer: `Courses for the ${LANDING_FIGURES.departments} departments of the Faculty of Management Sciences at UNILAG, added course by course.` },
      { question: 'Where do the questions come from?',
        answer: 'From past papers, class tests, course outlines and class notes, and our team vets every question.' },
      { question: 'What if my course has no material yet?',
        answer: 'Campus Bot builds practice questions from the notes you upload for that course.' },
      { question: 'Can I try it before paying?',
        answer: 'Yes: GST courses are free for every UNILAG student, and a new account can start a free pass for its department courses.' },
    ] satisfies FaqItem[],
  },
  finalCta: {
    title: 'Your next exam is closer than you think.',
    text: 'Create your account and start practising today.',
    primary: { label: 'Start for free', href: REGISTER },
    secondary: { label: 'Log in', href: LOGIN },
    community: 'Join the WhatsApp community',
    facultyLead: 'Faculty not listed?',
    waitlist: 'Join the waitlist on WhatsApp',
    waitlistMessage: "I'd like to join the waitlist for my faculty.",
  },
  footer: {
    text: 'Verified past questions, study guides and timed exam practice for UNILAG students.',
    productHeading: 'Product',
    product: [
      { label: 'Try a question', href: '#try' },
      { label: 'What you get', href: '#features' },
      { label: 'FAQ', href: '#faq' },
    ] satisfies TextLink[],
    contactHeading: 'Contact',
    whatsApp: 'WhatsApp us',
    followHeading: 'Follow',
    instagram: 'Instagram',
    x: 'X (Twitter)',
    communityHeading: 'Community',
    copyright: '© {year} CampusIntell',
  },
  newTab: '(opens in a new tab)',
}
