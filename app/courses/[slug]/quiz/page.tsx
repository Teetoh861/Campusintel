// Quiz route (/courses/[slug]/quiz). Server entry: loads the course +
// matching quiz, then hands the full bank to the client orchestrator. The
// attempt is sampled only when the student starts. quiz.css is scoped to this
// route segment so other pages don't pay for it.
import { notFound } from 'next/navigation'
import { courses, getCourseBySlug } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
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

  return (
    <QuizClient
      courseCode={course.code}
      courseTitle={course.title}
      courseSlug={course.slug}
      sections={quiz.sections}
      questions={quiz.questions}
      timerSeconds={quiz.quizDurationMinutes * 60}
      maxQuestions={quiz.maxQuizQuestions}
      totalInBank={quiz.totalQuestions}
    />
  )
}
