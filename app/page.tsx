'use client'

import Link from 'next/link'
import { ArrowRight, BookOpen, GraduationCap, MessageCircle, Users } from 'lucide-react'
import { courses } from '@/lib/data/courses'

export default function HomePage() {
  return (
    <div>
      {/* Hero Section */}
      <section className="bg-blue-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center space-y-6">
            <div className="w-16 h-16 bg-white/10 rounded-xl flex items-center justify-center mx-auto">
              <BookOpen className="w-8 h-8 text-white" />
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-balance">
              CampusIntel
            </h1>
            <p className="text-xl text-blue-100 font-medium">
              Your Academic Intelligence Hub
            </p>

            <p className="text-blue-200 max-w-2xl mx-auto text-balance leading-relaxed">
              Access course materials, textbooks, lecture notes, quizzes, and past exam questions for Department of Business Administration, University of Lagos -- 200 Level, First Semester.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link
                href="/courses"
                className="inline-flex items-center justify-center gap-2 bg-white text-blue-900 hover:bg-blue-50 h-14 px-8 text-base font-semibold rounded-md transition-colors min-h-[56px]"
              >
                Explore All Courses
                <ArrowRight className="w-5 h-5" />
              </Link>

              <a
                href="https://wa.me/2349018750976?text=Hello%2C%20I%20need%20help%20with%20CampusIntel"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white hover:bg-white/10 h-14 px-8 text-base font-semibold rounded-md transition-colors min-h-[56px]"
              >
                <MessageCircle className="w-5 h-5" />
                WhatsApp Us
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold text-blue-900">{courses.length}</p>
              <p className="text-sm text-slate-500 mt-1">Courses</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-900">
                {courses.reduce((sum, c) => sum + c.resources.length, 0)}
              </p>
              <p className="text-sm text-slate-500 mt-1">Resources</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-900">
                {courses.reduce((sum, c) => sum + c.textbooks.length, 0)}
              </p>
              <p className="text-sm text-slate-500 mt-1">Textbooks</p>
            </div>
          </div>
        </div>
      </section>

      {/* Browse Section */}
      <section className="bg-slate-50 py-12 md:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-blue-900 mb-2">
            Find Your Resources
          </h2>
          <p className="text-slate-500 mb-8">200 Level, First Semester -- Department of Business Administration</p>

          <Link
            href="/courses"
            className="flex items-center justify-center gap-2 w-full bg-blue-900 hover:bg-blue-800 text-white h-14 text-base font-semibold rounded-md transition-colors"
          >
            View All {courses.length} Courses
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Course Preview */}
      <section className="bg-white py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-blue-900 mb-8 text-center">
            Available Courses
          </h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map((course) => (
              <Link key={course.id} href={`/courses/${course.slug}`} className="block">
                <div className="border border-slate-200 rounded-lg p-5 hover:border-blue-900 hover:shadow-md transition-all bg-white h-full">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-bold text-blue-900 bg-blue-50 px-2 py-1 rounded">
                      {course.code}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${
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
                  <h3 className="font-bold text-slate-900 mb-1">{course.title}</h3>
                  <p className="text-sm text-slate-500">
                    {course.credits} credits &middot; {course.resources.length} resources
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-slate-50 py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-blue-900 mb-12 text-center">Why CampusIntel?</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="font-bold text-slate-900 mb-2">Complete Resources</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Textbooks, lecture notes, past exam questions -- all organized by course.
              </p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                <GraduationCap className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="font-bold text-slate-900 mb-2">Exam Focus Areas</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Know exactly what to study with curated exam focus topics for each course.
              </p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Users className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="font-bold text-slate-900 mb-2">Student Contributions</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Upload and share materials with fellow students via WhatsApp.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-blue-900 text-white py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-bold text-balance">Ready to Excel?</h2>
          <p className="text-blue-200 text-lg max-w-2xl mx-auto">
            Start exploring courses and resources. Need help? Reach out on WhatsApp.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/courses"
              className="inline-flex items-center justify-center bg-white text-blue-900 hover:bg-blue-50 h-14 px-8 text-base font-semibold rounded-md transition-colors min-h-[56px]"
            >
              Browse All Courses
            </Link>

            <a
              href="https://wa.me/2349018750976"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white hover:bg-white/10 h-14 px-8 text-base font-semibold rounded-md transition-colors min-h-[56px]"
            >
              <MessageCircle className="w-5 h-5" />
              Message Us
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
