import { Course } from '@/lib/types'
import Link from 'next/link'
import { BookOpen, FileText, Zap } from 'lucide-react'

interface CourseCardProps {
  course: Course
}

export function CourseCard({ course }: CourseCardProps) {
  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Easy':
        return 'text-green-600'
      case 'Medium':
        return 'text-yellow-600'
      case 'Hard':
        return 'text-orange-600'
      case 'Very High':
        return 'text-red-600'
      default:
        return 'text-slate-600'
    }
  }

  return (
    <Link href={`/courses/${course.slug}`}>
      <div className="h-full border border-slate-200 rounded-lg p-5 hover:border-blue-900 hover:shadow-lg transition-all bg-white">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-1">
              {course.code}
            </p>
            <h3 className="text-lg font-bold text-slate-900 line-clamp-2">{course.title}</h3>
          </div>
          <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-blue-900" />
          </div>
        </div>

        <p className="text-sm text-slate-600 line-clamp-2 mb-4">{course.overview}</p>

        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1">
                <FileText className="w-4 h-4" />
                <span>{course.resources.length} resources</span>
              </div>
              <span>{course.credits} credits</span>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className={`w-4 h-4 ${getDifficultyColor(course.difficulty)}`} />
              <span className={`text-xs font-semibold ${getDifficultyColor(course.difficulty)}`}>
                {course.difficulty}
              </span>
            </div>
            <span className="text-xs font-semibold text-blue-900 bg-blue-50 px-2 py-1 rounded">
              Level {course.level}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
