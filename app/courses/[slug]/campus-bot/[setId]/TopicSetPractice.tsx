'use client'
// app/courses/[slug]/campus-bot/[setId]/TopicSetPractice.tsx — A topic set on the Campus Bot set screen, with the
// topic's own label; Finish returns to the topic.
import { useRouter } from 'next/navigation'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import { PersonalPractice } from '../../../ai-practice/[courseId]/PersonalPractice'
import type { PracticeCopy } from '../../../ai-practice/[courseId]/PersonalPractice'
import type { PersonalSetView } from '@/lib/ai-practice/upload-contract'
import type { ReactElement } from 'react'

export const TOPIC_SET_COPY: PracticeCopy = { heading: CAMPUS_BOT_COPY.quiz.heading, headingHidden: true,
  label: CAMPUS_BOT_COPY.quiz.label, quoteLead: CAMPUS_BOT_COPY.quiz.fromNotes }

export function TopicSetPractice({ set, finishHref }: { set: PersonalSetView; finishHref: string }): ReactElement {
  const router = useRouter()
  return <PersonalPractice set={set} copy={TOPIC_SET_COPY} onClose={() => router.push(finishHref)} />
}
