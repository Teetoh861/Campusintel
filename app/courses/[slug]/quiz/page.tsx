'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { getQuizByCourseSlug } from '@/lib/data/quizzes'
import { getCourseBySlug } from '@/lib/data/courses'
import {
  ArrowLeft,
  Check,
  X,
  RotateCcw,
  Trophy,
  Clock,
  ChevronLeft,
  ChevronRight,
  Timer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

type QuizState = 'intro' | 'active' | 'review'

export default function QuizPage() {
  const params = useParams()
  const slug = params.slug as string

  const quiz = getQuizByCourseSlug(slug)
  const course = getCourseBySlug(slug)

  const [quizState, setQuizState] = useState<QuizState>('intro')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [showResult, setShowResult] = useState(false)
  const [shuffleKey, setShuffleKey] = useState(0)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [timerExpired, setTimerExpired] = useState(false)

  // Shuffle and select limited questions for each attempt
  const shuffledQuestions = useMemo(() => {
    if (!quiz) return []
    const arr = [...quiz.questions]
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    // Limit to maxQuizQuestions if specified
    const maxQuestions = quiz.maxQuizQuestions || quiz.questions.length
    return arr.slice(0, maxQuestions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, shuffleKey])

  // Auto-submit when timer expires
  const handleAutoSubmit = useCallback(() => {
    setTimerExpired(true)
    setQuizState('review')
    setCurrentQuestion(0)
    setShowResult(true)
  }, [])

  // Timer effect
  useEffect(() => {
    if (quizState === 'active' && quiz?.quizDurationMinutes) {
      if (timeRemaining === 0) {
        setTimeRemaining(quiz.quizDurationMinutes * 60)
      }

      const timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            handleAutoSubmit()
            return 0
          }
          return prev - 1
        })
      }, 1000)

      return () => clearInterval(timer)
    }
  }, [quizState, quiz, timeRemaining, handleAutoSubmit])

  // Format timer display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Get timer color based on remaining time
  const getTimerColor = () => {
    if (!quiz?.quizDurationMinutes) return 'text-slate-700'
    const percentage = (timeRemaining / (quiz.quizDurationMinutes * 60)) * 100
    if (percentage > 50) return 'text-green-600'
    if (percentage > 25) return 'text-yellow-600'
    return 'text-red-600'
  }

  if (!quiz || !course) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center px-4">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Quiz Not Available</h1>
          <p className="text-slate-600 mb-6">No quiz has been added for this course yet.</p>
          <Link
            href={`/courses/${slug}`}
            className="inline-flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 text-white h-12 px-6 rounded-md text-sm font-medium transition-colors min-h-[48px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Course
          </Link>
        </div>
      </div>
    )
  }

  const totalQuestions = shuffledQuestions.length
  const answeredCount = Object.keys(answers).length
  const currentQ = shuffledQuestions[currentQuestion]

  const calculateScore = () => {
    let correct = 0
    shuffledQuestions.forEach((q, idx) => {
      if (answers[idx] === q.correctAnswer) correct++
    })
    return correct
  }

  const score = quizState === 'review' ? calculateScore() : 0
  const percentage = quizState === 'review' ? Math.round((score / totalQuestions) * 100) : 0

  const getGrade = () => {
    if (percentage >= 70) return { label: 'Excellent', color: 'text-green-600' }
    if (percentage >= 60) return { label: 'Good', color: 'text-blue-600' }
    if (percentage >= 50) return { label: 'Average', color: 'text-yellow-600' }
    return { label: 'Needs Improvement', color: 'text-red-600' }
  }

  const handleSelectAnswer = (optionIndex: number) => {
    if (quizState !== 'active') return
    setAnswers((prev) => ({ ...prev, [currentQuestion]: optionIndex }))
  }

  const handleNext = () => {
    if (currentQuestion < totalQuestions - 1) {
      setCurrentQuestion((prev) => prev + 1)
    }
  }

  const handlePrev = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion((prev) => prev - 1)
    }
  }

  const handleSubmit = () => {
    setQuizState('review')
    setCurrentQuestion(0)
    setShowResult(true)
  }

  const handleRestart = () => {
    setQuizState('intro')
    setCurrentQuestion(0)
    setAnswers({})
    setShowResult(false)
    setShuffleKey((prev) => prev + 1) // triggers re-shuffle
    setTimeRemaining(0)
    setTimerExpired(false)
  }

  const handleStart = () => {
    setQuizState('active')
    setCurrentQuestion(0)
    setAnswers({})
    setShowResult(false)
    setTimeRemaining(quiz?.quizDurationMinutes ? quiz.quizDurationMinutes * 60 : 0)
    setTimerExpired(false)
  }

  // INTRO SCREEN
  if (quizState === 'intro') {
    return (
      <div className="bg-slate-50 min-h-screen py-8 pb-24">
        <div className="max-w-2xl mx-auto px-4">
          <Link
            href={`/courses/${slug}`}
            className="inline-flex items-center gap-2 text-blue-900 hover:text-blue-800 mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back to {course.code}</span>
          </Link>

          <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-10 text-center">
            <div className="w-16 h-16 bg-blue-900 rounded-xl flex items-center justify-center mx-auto mb-6">
              <Trophy className="w-8 h-8 text-white" />
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 text-balance">
              {course.code} CBT Quiz
            </h1>
            <p className="text-slate-600 mb-8">{course.title}</p>

            <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-2xl font-bold text-blue-900">{totalQuestions}</p>
                <p className="text-xs text-slate-500 mt-1">Questions</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                {quiz.quizDurationMinutes ? (
                  <>
                    <p className="text-2xl font-bold text-blue-900">{quiz.quizDurationMinutes} min</p>
                    <p className="text-xs text-slate-500 mt-1">Time Limit</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-blue-900">{quiz.sections.length}</p>
                    <p className="text-xs text-slate-500 mt-1">Sections</p>
                  </>
                )}
              </div>
            </div>

            <div className="text-left bg-blue-50 rounded-lg p-5 mb-8">
              <h3 className="font-semibold text-slate-900 mb-3">Sections covered:</h3>
              <ul className="space-y-2">
                {quiz.sections.map((section, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-blue-900 font-bold mt-0.5">{idx + 1}.</span>
                    {section}
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-left bg-slate-50 rounded-lg p-5 mb-8">
              <h3 className="font-semibold text-slate-900 mb-2">Instructions:</h3>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <li>- Select one answer per question</li>
                <li>- You can navigate back and forth between questions</li>
                <li>- Questions are shuffled randomly for each attempt</li>
                {quiz.maxQuizQuestions && quiz.maxQuizQuestions < quiz.questions.length && (
                  <li className="font-medium text-blue-900">
                    - {totalQuestions} questions will be selected randomly from a bank of {quiz.questions.length} questions
                  </li>
                )}
                {quiz.quizDurationMinutes && (
                  <li className="font-medium text-red-600">
                    - Time limit: {quiz.quizDurationMinutes} minutes (Quiz auto-submits when time expires)
                  </li>
                )}
                <li>- Submit when you are ready to see your score</li>
                <li>- No data is saved -- your score is shown once and not stored</li>
                <li>- You can retake the quiz as many times as you want</li>
              </ul>
            </div>

            <Button
              onClick={handleStart}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white h-14 text-lg font-semibold rounded-xl"
            >
              Start Quiz
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // RESULT SUMMARY (shown at top during review)
  if (quizState === 'review' && showResult) {
    return (
      <div className="bg-slate-50 min-h-screen py-8 pb-24">
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-10 text-center mb-8">
            <div
              className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
                percentage >= 50 ? 'bg-green-100' : 'bg-red-100'
              }`}
            >
              {percentage >= 50 ? (
                <Trophy className={`w-10 h-10 ${percentage >= 70 ? 'text-green-600' : 'text-yellow-600'}`} />
              ) : (
                <X className="w-10 h-10 text-red-600" />
              )}
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-1">
              {timerExpired ? 'Time Up!' : 'Quiz Complete'}
            </h1>
            {timerExpired && (
              <p className="text-sm text-orange-600 font-medium mb-2">
                Quiz automatically submitted when timer expired
              </p>
            )}
            <p className={`text-lg font-semibold ${getGrade().color} mb-6`}>{getGrade().label}</p>

            <div className="grid grid-cols-3 gap-4 max-w-md mx-auto mb-8">
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-3xl font-bold text-blue-900">{score}</p>
                <p className="text-xs text-slate-500 mt-1">Correct</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-3xl font-bold text-red-500">{totalQuestions - score}</p>
                <p className="text-xs text-slate-500 mt-1">Wrong</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-3xl font-bold text-slate-900">{percentage}%</p>
                <p className="text-xs text-slate-500 mt-1">Score</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-200 rounded-full h-3 mb-8 max-w-md mx-auto">
              <div
                className={`h-3 rounded-full transition-all ${
                  percentage >= 70 ? 'bg-green-500' : percentage >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => setShowResult(false)}
                className="bg-blue-900 hover:bg-blue-800 text-white h-12 gap-2"
              >
                <Check className="w-4 h-4" />
                Review Answers
              </Button>
              <Button
                onClick={handleRestart}
                variant="outline"
                className="border-2 border-blue-900 text-blue-900 hover:bg-blue-50 h-12 gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Retake Quiz
              </Button>
              <Link
                href={`/courses/${slug}`}
                className="inline-flex items-center justify-center w-full h-12 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md text-sm font-medium transition-colors"
              >
                Back to Course
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ACTIVE QUIZ / REVIEW MODE
  return (
    <div className="bg-slate-50 min-h-screen py-6 pb-24">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          {quizState === 'active' ? (
            <Link
              href={`/courses/${slug}`}
              className="inline-flex items-center gap-2 text-blue-900 hover:text-blue-800"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Exit</span>
            </Link>
          ) : (
            <button
              onClick={() => setShowResult(true)}
              className="inline-flex items-center gap-2 text-blue-900 hover:text-blue-800"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Back to Results</span>
            </button>
          )}

          <div className="flex items-center gap-4">
            {quiz.quizDurationMinutes && quizState === 'active' && (
              <div className={`flex items-center gap-2 text-sm font-bold ${getTimerColor()}`}>
                <Timer className="w-4 h-4" />
                <span>{formatTime(timeRemaining)}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-700">
                {answeredCount}/{totalQuestions}
              </span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-200 rounded-full h-2 mb-6">
          <div
            className="h-2 rounded-full bg-blue-900 transition-all"
            style={{ width: `${((currentQuestion + 1) / totalQuestions) * 100}%` }}
          />
        </div>

        {/* Question Card */}
        {currentQ && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 mb-6">
            <span className="inline-block text-xs font-semibold text-blue-900 bg-blue-50 px-3 py-1 rounded-full mb-4">
              {currentQ.section}
            </span>

            <p className="text-sm text-slate-500 mb-2">
              Question {currentQuestion + 1} of {totalQuestions}
            </p>

            <h2 className="text-lg md:text-xl font-bold text-slate-900 mb-6 leading-relaxed">
              {currentQ.question}
            </h2>

            {/* Options */}
            <div className="space-y-3">
              {currentQ.options.map((option, idx) => {
                const isSelected = answers[currentQuestion] === idx
                const isCorrect = idx === currentQ.correctAnswer
                const isReview = quizState === 'review'
                const wasChosen = answers[currentQuestion] === idx
                const wasWrong = isReview && wasChosen && !isCorrect

                let borderColor = 'border-slate-200'
                let bgColor = 'bg-white'
                let textColor = 'text-slate-700'
                let indicator = null

                if (isReview) {
                  if (isCorrect) {
                    borderColor = 'border-green-500'
                    bgColor = 'bg-green-50'
                    textColor = 'text-green-900'
                    indicator = <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                  } else if (wasWrong) {
                    borderColor = 'border-red-500'
                    bgColor = 'bg-red-50'
                    textColor = 'text-red-900'
                    indicator = <X className="w-5 h-5 text-red-600 flex-shrink-0" />
                  }
                } else if (isSelected) {
                  borderColor = 'border-blue-900'
                  bgColor = 'bg-blue-50'
                  textColor = 'text-blue-900'
                }

                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectAnswer(idx)}
                    disabled={isReview}
                    className={`w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all text-left min-h-[52px] ${borderColor} ${bgColor} ${
                      !isReview ? 'hover:border-blue-300 active:scale-[0.99]' : ''
                    } ${isReview ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                        isReview && isCorrect
                          ? 'border-green-500 bg-green-500 text-white'
                          : isReview && wasWrong
                            ? 'border-red-500 bg-red-500 text-white'
                            : isSelected && !isReview
                              ? 'border-blue-900 bg-blue-900 text-white'
                              : 'border-slate-300 text-slate-500'
                      }`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className={`flex-1 text-sm font-medium ${textColor}`}>{option}</span>
                    {indicator}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4">
          <Button
            onClick={handlePrev}
            disabled={currentQuestion === 0}
            variant="outline"
            className="h-12 gap-2 border-slate-300 text-slate-700 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </Button>

          {/* Question dots */}
          <div className="flex-1 flex flex-wrap justify-center gap-1.5 max-w-[240px]">
            {shuffledQuestions.map((_, idx) => {
              const isAnswered = answers[idx] !== undefined
              const isCurrent = idx === currentQuestion
              let dotColor = 'bg-slate-200'
              if (quizState === 'review') {
                const isCorrectAnswer = answers[idx] === shuffledQuestions[idx].correctAnswer
                if (isAnswered && isCorrectAnswer) dotColor = 'bg-green-500'
                else if (isAnswered && !isCorrectAnswer) dotColor = 'bg-red-500'
                else dotColor = 'bg-slate-300'
              } else if (isAnswered) {
                dotColor = 'bg-blue-900'
              }

              return (
                <button
                  key={idx}
                  onClick={() => setCurrentQuestion(idx)}
                  className={`w-3 h-3 rounded-full transition-all ${dotColor} ${
                    isCurrent ? 'ring-2 ring-blue-400 ring-offset-1' : ''
                  }`}
                  aria-label={`Go to question ${idx + 1}`}
                />
              )
            })}
          </div>

          {currentQuestion === totalQuestions - 1 ? (
            quizState === 'active' ? (
              <Button
                onClick={handleSubmit}
                disabled={answeredCount < totalQuestions}
                className="h-12 bg-green-600 hover:bg-green-700 text-white gap-2 disabled:opacity-40"
              >
                Submit
                <Check className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={handleRestart}
                className="h-12 bg-blue-900 hover:bg-blue-800 text-white gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Retake
              </Button>
            )
          ) : (
            <Button
              onClick={handleNext}
              variant="outline"
              className="h-12 gap-2 border-slate-300 text-slate-700"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Submit hint */}
        {quizState === 'active' && answeredCount < totalQuestions && (
          <p className="text-center text-xs text-slate-500 mt-4">
            Answer all {totalQuestions} questions to submit ({totalQuestions - answeredCount} remaining)
          </p>
        )}
      </div>
    </div>
  )
}
