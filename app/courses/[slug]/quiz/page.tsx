// Quiz route (/courses/[slug]/quiz). Server entry: loads the course +
// matching quiz, slices the attempt set to maxQuizQuestions, then hands the
// stable arrays to the client orchestrator. quiz.css is scoped to this
// route segment so other pages don't pay for it.
import { notFound } from 'next/navigation'
import { courses, getCourseBySlug } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import '../../../../styles/quiz.css'
import { QuizClient } from './QuizClient'

type PageProps = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return courses.map((c) => ({ slug: c.slug }))
}

export default async function QuizPage({ params }: PageProps) {
  const { slug } = await params
  const course = getCourseBySlug(slug)
  if (!course) notFound()
  const quiz = getQuizByCourseSlug(slug)
  if (!quiz) notFound()

  // Stable attempt slice: if the bank exceeds the per-attempt cap, take the
  // first N; otherwise the whole bank. Deterministic so retake hits the same
  // set and per-question state stays valid.
  const attempt = quiz.questions.slice(0, quiz.maxQuizQuestions)

  return (
    <QuizClient
      courseCode={course.code}
      courseTitle={course.title}
      courseSlug={course.slug}
      sections={quiz.sections}
      questions={attempt}
      timerSeconds={quiz.quizDurationMinutes * 60}
      maxQuestions={quiz.maxQuizQuestions}
      totalInBank={quiz.totalQuestions}
    />
  )
}
