// Quiz route (/courses/[slug]/quiz). Server entry: loads the course +
// matching quiz, then hands the full bank to the client orchestrator. The
// attempt is sampled only when the student starts. quiz.css is scoped to this
// route segment so other pages don't pay for it.
import { notFound } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { Feedback } from '@/components/chrome/Feedback'
import { getCourseBySlug } from '@/lib/data/courses'
import { getStudentManagedQuiz } from '@/lib/managed-content/student-quiz'
import { QuizClient } from './QuizClient'

type PageProps = { params: Promise<{ slug: string }> }

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

/** Cross the student account boundary before the quiz bank is read. */
export default async function QuizPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  return <StudentAccessGate returnPath={`/courses/${slug}/quiz`}>
    {continuityToken => <Quiz slug={slug} continuityToken={continuityToken} />}
  </StudentAccessGate>
}

async function Quiz({ slug, continuityToken }: { slug: string; continuityToken: string }) {
  const course = getCourseBySlug(slug)
  if (!course) notFound()
  const result = await getStudentManagedQuiz(slug)
  if (result.status !== 'ready') return <Feedback message="The quiz is temporarily unavailable." tone="error" />
  const usableQuiz = result.quiz

  return (
    <QuizClient
      continuityToken={continuityToken}
      courseCode={course.code}
      courseTitle={course.title}
      courseSlug={course.slug}
      courseContentKey={course.contentKey}
      sections={usableQuiz.sections}
      questions={usableQuiz.questions}
      timerSeconds={usableQuiz.timerSeconds}
      maxQuestions={usableQuiz.maxQuestions}
      totalInBank={usableQuiz.bankSize}
    />
  )
}
