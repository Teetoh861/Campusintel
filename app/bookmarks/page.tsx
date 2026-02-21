'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { courses } from '@/lib/data/courses'
import { CourseCard } from '@/components/courses/CourseCard'
import { Bookmark, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function BookmarksPage() {
  const [bookmarkedCourseIds, setBookmarkedCourseIds] = useState<string[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const bookmarks = localStorage.getItem('bookmarks')
    if (bookmarks) {
      setBookmarkedCourseIds(JSON.parse(bookmarks))
    }
    setIsLoaded(true)
  }, [])

  const bookmarkedCourses = courses.filter((course) => bookmarkedCourseIds.includes(course.id))

  const handleRemoveBookmark = (courseId: string) => {
    const updated = bookmarkedCourseIds.filter((id) => id !== courseId)
    setBookmarkedCourseIds(updated)
    localStorage.setItem('bookmarks', JSON.stringify(updated))
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-600">Loading...</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-900 rounded-lg flex items-center justify-center">
              <Bookmark className="w-6 h-6 text-white fill-current" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-blue-900">My Bookmarks</h1>
          </div>
          <p className="text-slate-600">
            Your saved courses for quick access
          </p>
        </div>

        {bookmarkedCourses.length > 0 ? (
          <>
            <p className="text-sm text-slate-600 mb-6">
              {bookmarkedCourses.length} bookmark{bookmarkedCourses.length !== 1 ? 's' : ''}
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {bookmarkedCourses.map((course) => (
                <div key={course.id} className="relative group">
                  <CourseCard course={course} />
                  <button
                    onClick={() => handleRemoveBookmark(course.id)}
                    className="absolute top-3 right-3 p-2 bg-white rounded-lg border border-slate-200 opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:border-red-500 hover:text-red-600"
                    title="Remove bookmark"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 bg-white rounded-lg border border-slate-200">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Bookmark className="w-8 h-8 text-blue-900" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">No Bookmarks Yet</h2>
            <p className="text-slate-600 mb-8 max-w-md mx-auto">
              Start bookmarking courses to save them for later. Visit the course pages and click the
              bookmark button to add them here.
            </p>
            <Link href="/courses">
              <Button className="bg-blue-900 hover:bg-blue-800 text-white gap-2">
                Explore Courses
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
