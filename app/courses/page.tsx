'use client'

import { useState, useMemo } from 'react'
import { courses } from '@/lib/data/courses'
import { CourseCard } from '@/components/courses/CourseCard'
import { Search, MessageCircle } from 'lucide-react'

export default function CoursesPage() {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredCourses = useMemo(() => {
    return courses.filter((course) => {
      const matchesSearch =
        course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.code.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesSearch
    })
  }, [searchQuery])

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-blue-900 mb-2">
            Course Directory
          </h1>
          <p className="text-slate-600">
            200 Level, First Semester -- Department of Business Administration, UNILAG
          </p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search courses by title or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-lg border border-slate-200 bg-white focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
            />
          </div>
        </div>

        {/* Search Controls */}
        {searchQuery && (
          <div className="flex flex-wrap gap-2 mb-8">
            <button
              onClick={() => setSearchQuery('')}
              className="px-5 py-2.5 rounded-full text-sm font-semibold text-red-600 bg-red-50 border border-red-200 min-h-[44px]"
            >
              Clear Search
            </button>
          </div>
        )}

        {/* Courses Grid */}
        {filteredCourses.length > 0 ? (
          <>
            <p className="text-sm text-slate-500 mb-4">
              Showing {filteredCourses.length} course
              {filteredCourses.length !== 1 ? 's' : ''}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredCourses.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 bg-white rounded-lg border border-slate-200">
            <p className="text-lg text-slate-700 font-semibold mb-2">
              No courses found
            </p>
            <p className="text-slate-500 text-sm mb-6">
              Try adjusting your search or filter
            </p>
            <a
              href="https://wa.me/2349018750976?text=I%20am%20looking%20for%20a%20course%20on%20CampusIntel"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-green-600 hover:text-green-700 bg-green-50 px-4 py-3 rounded-lg min-h-[44px]"
            >
              <MessageCircle className="w-5 h-5" />
              Ask us on WhatsApp
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
