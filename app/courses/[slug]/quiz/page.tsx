// Quiz route (/courses/[slug]/quiz). Server entry: loads the course +
// matching quiz, then hands the full bank to the client orchestrator. The
// attempt is sampled only when the student starts. quiz.css is scoped to this
// route segment so other pages don't pay for it.
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { getCourseBySlug } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import { getUsableCourseQuiz } from '@/lib/data/quiz-availability'
import { QuizClient } from './QuizClient'

type PageProps = { params: Promise<{ slug: string }> }

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

/** Cross the student account boundary before the quiz bank is read. */
export default async function QuizPage({ params }: PageProps) {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/quiz`}><Quiz slug={slug} /></StudentAccessGate>
}

function Quiz({ slug }: { slug: string }) {
  const course = getCourseBySlug(slug)
  if (!course) notFound()
  const usableQuiz = getUsableCourseQuiz(course, getQuizByCourseSlug(slug))
  if (!usableQuiz) notFound()
  const { quiz } = usableQuiz

  return (
    <QuizClient
      courseCode={course.code}
      courseTitle={course.title}
      courseSlug={course.slug}
      courseContentKey={course.contentKey}
      sections={quiz.sections}
      questions={quiz.questions}
      timerSeconds={usableQuiz.timerSeconds}
      maxQuestions={quiz.maxQuizQuestions}
      totalInBank={usableQuiz.bankSize}
    />
  )
}
