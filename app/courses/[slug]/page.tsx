'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { getCourseBySlug } from '@/lib/data/courses'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import { getTopicNotesByCourseSlug } from '@/lib/data/topic-notes'
import { ResourceCard } from '@/components/resources/ResourceCard'
import { ArrowLeft, Bookmark, Share2, BookOpen, Target, Zap, Upload, BarChart3, MessageCircle, GraduationCap, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CoursePage() {
  const params = useParams()
  const slug = params.slug as string

  const [isBookmarked, setIsBookmarked] = useState(false)
  const [expandedTopics, setExpandedTopics] = useState<Record<number, boolean>>({})

  const course = getCourseBySlug(slug)
  const quiz = getQuizByCourseSlug(slug)
  const topicNotes = getTopicNotesByCourseSlug(slug)

  const toggleTopic = (idx: number) => {
    setExpandedTopics((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  useEffect(() => {
    if (!course) return
    try {
      const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]')
      setIsBookmarked(bookmarks.includes(course.id))
    } catch {
      // ignore
    }
  }, [course])

  if (!course) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center px-4">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Course Not Found</h1>
          <p className="text-slate-600 mb-6">The course you are looking for does not exist.</p>
          <Link
            href="/courses"
            className="inline-flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 text-white h-12 px-6 rounded-md text-sm font-medium transition-colors min-h-[48px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Courses
          </Link>
        </div>
      </div>
    )
  }

  const handleBookmark = () => {
    try {
      const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]')
      if (isBookmarked) {
        const updated = bookmarks.filter((id: string) => id !== course.id)
        localStorage.setItem('bookmarks', JSON.stringify(updated))
      } else {
        if (!bookmarks.includes(course.id)) {
          bookmarks.push(course.id)
          localStorage.setItem('bookmarks', JSON.stringify(bookmarks))
        }
      }
      setIsBookmarked(!isBookmarked)
    } catch {
      // ignore
    }
  }

  const handleShare = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: course.title, url })
      } else {
        await navigator.clipboard.writeText(url)
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <Link href="/courses" className="inline-flex items-center gap-2 text-blue-900 hover:text-blue-800 mb-6">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back to Courses</span>
        </Link>

        {/* Course Header */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 md:p-8 mb-8">
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="text-sm font-bold text-blue-900 bg-blue-50 px-3 py-1 rounded-full">
                {course.code}
              </span>
              <span className="text-sm font-semibold text-slate-500">Level {course.level}</span>
              <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
                course.difficulty === 'Easy'
                  ? 'bg-green-100 text-green-700'
                  : course.difficulty === 'Medium'
                    ? 'bg-yellow-100 text-yellow-700'
                    : course.difficulty === 'Hard'
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-red-100 text-red-700'
              }`}>
                {course.difficulty}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-3">{course.title}</h1>
            <p className="text-lg text-slate-600 leading-relaxed">{course.overview}</p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-6 border-t border-slate-200">
            {quiz && (
              <Link
                href={`/courses/${slug}/quiz`}
                className="inline-flex items-center justify-center gap-2 h-12 px-6 min-w-[44px] bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium transition-colors min-h-[48px]"
              >
                <GraduationCap className="w-4 h-4" />
                Take Quiz ({quiz.totalQuestions} Qs)
              </Link>
            )}

            <Button
              onClick={handleBookmark}
              className={`gap-2 h-12 min-w-[44px] ${
                isBookmarked
                  ? 'bg-blue-900 text-white hover:bg-blue-800'
                  : 'border-2 border-blue-900 text-blue-900 hover:bg-blue-50 bg-transparent'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-current' : ''}`} />
              {isBookmarked ? 'Bookmarked' : 'Bookmark'}
            </Button>

            <a
              href={`https://wa.me/2349018750976?text=I%20would%20like%20to%20upload%20materials%20for%20${encodeURIComponent(course.code + ' - ' + course.title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 h-12 px-4 min-w-[44px] border border-blue-900 text-blue-900 hover:bg-blue-50 rounded-md text-sm font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload Material
            </a>

            <Button onClick={handleShare} variant="outline" className="h-12 min-w-[44px] gap-2 border-slate-300 text-slate-700 hover:bg-slate-100">
              <Share2 className="w-4 h-4" />
              Share
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Textbooks */}
            {course.textbooks.length > 0 && (
              <section className="bg-white rounded-lg border border-slate-200 p-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <BookOpen className="w-6 h-6 text-blue-900" />
                  Recommended Textbooks
                </h2>
                <div className="space-y-4">
                  {course.textbooks.map((book, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg p-4 hover:border-blue-900 transition">
                      <h3 className="font-semibold text-slate-900 mb-2">{book.title}</h3>
                      <p className="text-sm text-slate-600">
                        {book.author} - {book.edition}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Topics with Expandable Notes */}
            {course.topics.length > 0 && (
              <section className="bg-white rounded-lg border border-slate-200 p-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">Key Topics</h2>
                <div className="space-y-3">
                  {course.topics.map((topic, idx) => {
                    const note = topicNotes?.topics[idx]
                    const isExpanded = expandedTopics[idx]

                    return (
                      <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => note && toggleTopic(idx)}
                          className={`w-full flex items-start gap-3 p-4 text-left transition-colors ${
                            note ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          <div className="w-1 self-stretch bg-blue-900 rounded-full flex-shrink-0" />
                          <div className="flex-1">
                            <p className="font-semibold text-slate-900">Chapter {topic.chapter}</p>
                            <p className="text-slate-600 text-sm mt-1">{topic.description}</p>
                          </div>
                          {note && (
                            <div className="flex-shrink-0 mt-1">
                              {isExpanded ? (
                                <ChevronUp className="w-5 h-5 text-blue-900" />
                              ) : (
                                <ChevronDown className="w-5 h-5 text-slate-400" />
                              )}
                            </div>
                          )}
                        </button>

                        {/* Expandable Notes */}
                        {note && isExpanded && (
                          <div className="px-4 pb-4 border-t border-slate-100">
                            <div className="pt-4 space-y-4">
                              <div>
                                <h4 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                                  <BookOpen className="w-4 h-4 text-blue-900" />
                                  Summary
                                </h4>
                                <p className="text-sm text-slate-600 leading-relaxed">{note.summary}</p>
                              </div>

                              <div>
                                <h4 className="text-sm font-semibold text-slate-900 mb-2">Key Points:</h4>
                                <ul className="space-y-2">
                                  {note.keyPoints.map((point, pIdx) => (
                                    <li key={pIdx} className="text-sm text-slate-600 flex items-start gap-2">
                                      <span className="text-blue-900 font-bold mt-0.5 flex-shrink-0">-</span>
                                      <span className="leading-relaxed">{point}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              {note.examTip && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
                                  <Lightbulb className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <p className="text-xs font-bold text-yellow-800 mb-1">EXAM TIP</p>
                                    <p className="text-sm text-yellow-800">{note.examTip}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Resources */}
            <section className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Course Resources</h2>
              {course.resources.length > 0 ? (
                <div className="space-y-4">
                  {course.resources.map((resource) => (
                    <ResourceCard key={resource.id} resource={resource} courseCode={course.code} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 px-4">
                  <div className="max-w-sm mx-auto">
                    <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">No Resources Available Yet</h3>
                    <p className="text-sm text-slate-600 mb-6">
                      We're currently working on adding study materials for this course. Have materials to share?
                    </p>
                    <a
                      href={`https://wa.me/2349018750976?text=I%20have%20materials%20for%20${encodeURIComponent(course.code + ' - ' + course.title)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 h-12 px-6 min-w-[44px] bg-blue-900 hover:bg-blue-800 text-white rounded-md text-sm font-medium transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      Share Materials
                    </a>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Quick Info */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-4">Course Information</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Code</p>
                  <p className="text-sm font-semibold text-slate-900">{course.code}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Level</p>
                  <p className="text-sm font-semibold text-slate-900">{course.level}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">Credits</p>
                  <p className="text-sm font-semibold text-slate-900">{course.credits}</p>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                  <p className="text-sm text-slate-500 flex items-center gap-1">
                    <Zap className="w-4 h-4" />
                    Difficulty
                  </p>
                  <p className={`text-sm font-bold ${
                    course.difficulty === 'Easy'
                      ? 'text-green-600'
                      : course.difficulty === 'Medium'
                        ? 'text-yellow-600'
                        : course.difficulty === 'Hard'
                          ? 'text-orange-600'
                          : 'text-red-600'
                  }`}>
                    {course.difficulty}
                  </p>
                </div>
              </div>
            </div>

            {/* Assessment Structure */}
            {course.assessmentStructure && (
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-6">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-slate-700" />
                  Assessment Breakdown
                </h3>
                <div className="space-y-3">
                  {course.assessmentStructure.assignment !== undefined && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-slate-700">Assignment</p>
                      <span className="text-sm font-semibold text-slate-900">{course.assessmentStructure.assignment}%</span>
                    </div>
                  )}
                  {course.assessmentStructure.test !== undefined && (
                    <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                      <p className="text-sm text-slate-700">Test</p>
                      <span className="text-sm font-semibold text-slate-900">{course.assessmentStructure.test}%</span>
                    </div>
                  )}
                  {course.assessmentStructure.exam !== undefined && (
                    <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                      <p className="text-sm text-slate-700">Exam</p>
                      <span className="text-sm font-semibold text-blue-900">{course.assessmentStructure.exam}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Exam Focus */}
            {course.examFocus.length > 0 && (
              <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-900" />
                  Exam Focus Areas
                </h3>
                <ul className="space-y-2">
                  {course.examFocus.map((focus, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                      <span className="text-blue-900 font-bold mt-0.5">-</span>
                      {focus}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* WhatsApp Support */}
            <div className="bg-green-50 rounded-lg border border-green-200 p-6 text-center">
              <p className="text-sm font-semibold text-slate-900 mb-2">Need help with this course?</p>
              <p className="text-xs text-slate-600 mb-4">Get study support or request materials</p>
              <a
                href={`https://wa.me/2349018750976?text=I%20need%20help%20with%20${encodeURIComponent(course.code + ' - ' + course.title)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white h-12 rounded-md text-sm font-medium transition-colors min-h-[48px]"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp Support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
