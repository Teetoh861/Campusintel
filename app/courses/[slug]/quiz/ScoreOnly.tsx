import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { ANSWERS_ACCESS_LINE } from '@/lib/practice/result-copy'
import type { GradedAttempt } from '@/lib/practice/contract'

/** Scores remain available when the database withholds the answer review. */
export function ScoreOnly({ attempt }: { attempt: GradedAttempt }) {
  return <StudentPage band={<PageBand title={`${attempt.result.score} of ${attempt.result.total} correct`} />}>
    <p>{ANSWERS_ACCESS_LINE}</p>
  </StudentPage>
}
