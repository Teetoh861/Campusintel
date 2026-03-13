'use client'

import Link from 'next/link'
import { ArrowRight, BookOpen, GraduationCap, MessageCircle, Users, Sparkles, MapPin, Clock, Target, Rocket, Building, Bell } from 'lucide-react'
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold text-blue-900">{courses.length}</p>
              <p className="text-sm text-slate-500 mt-1">Courses</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-900">
                {courses.reduce((sum, c) => sum + c.textbooks.length, 0)}
              </p>
              <p className="text-sm text-slate-500 mt-1">Textbooks</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-900">50+</p>
              <p className="text-sm text-slate-500 mt-1">Quiz Qs / Course</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-amber-600">Soon</p>
              <p className="text-sm text-slate-500 mt-1">Peer Tutors</p>
            </div>
          </div>
        </div>
      </section>

      {/* Browse Section */}
      <section className="bg-slate-50 py-12 md:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-blue-900 mb-2">
            Start Practicing
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

      {/* Academic Support Section */}
      <section className="bg-white py-12 md:py-16 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Sparkles className="w-6 h-6 text-blue-900" />
              <span className="text-sm font-semibold text-amber-700 bg-amber-50 px-3 py-1 rounded-full">Coming Soon</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-blue-900 mb-2">
              Academic Support
            </h2>
            <p className="text-slate-600 max-w-xl mx-auto">
              Beyond study materials, we are building a way to connect you with top-performing students who can help you master difficult courses.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Find a Tutor Card */}
            <Link href="/tutors" className="block">
              <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-lg border border-blue-200 p-6 hover:border-blue-400 hover:shadow-md transition-all h-full">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Users className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-bold text-slate-900 text-lg">Find a Tutor</h3>
                      <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Coming Soon</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-4">
                      Connect with verified peer tutors who scored A grades in courses like Statistics, Mathematics, and Accounting.
                    </p>
                    <div className="flex items-center gap-2 text-sm">
                      <Bell className="w-4 h-4 text-blue-600" />
                      <span className="text-blue-600 font-medium">Join the waitlist</span>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-blue-900 flex-shrink-0" />
                </div>
              </div>
            </Link>

            {/* Become a Tutor Card */}
            <Link href="/become-a-tutor" className="block">
              <div className="bg-gradient-to-br from-green-50 to-slate-50 rounded-lg border border-green-200 p-6 hover:border-green-400 hover:shadow-md transition-all h-full">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-bold text-slate-900 text-lg">Become a Tutor</h3>
                      <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded">Apply Now</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-4">
                      Are you a 300L+ student with strong grades? Apply to earn money by helping juniors succeed.
                    </p>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-green-600 font-medium">Set your own rates</span>
                      <span className="text-slate-500">Flexible schedule</span>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-green-600 flex-shrink-0" />
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Course Preview */}
      <section className="bg-slate-50 py-12 md:py-16">
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
                  <p className="text-sm text-slate-500 mb-2">
                    {course.credits} credits
                  </p>
                  <p className="text-xs font-semibold text-blue-900 flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" />
                    Click to view notes, quizzes & study materials
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-white py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-blue-900 mb-12 text-center">Why CampusIntel?</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="font-bold text-slate-900 mb-2">Study Notes & Quizzes</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Topic-by-topic study notes with calculator tips, plus timed practice quizzes for each course.
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
              <h3 className="font-bold text-slate-900 mb-2">Peer Tutoring</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Coming soon: Get 1-on-1 help from verified top students who have mastered the courses.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Expansion Roadmap */}
      <section className="bg-slate-50 py-12 md:py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Rocket className="w-6 h-6 text-blue-900" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-blue-900 mb-2">
              Expansion Roadmap
            </h2>
            <p className="text-slate-600">
              CampusIntel is growing. Here is what is coming next.
            </p>
          </div>

          <div className="space-y-4">
            {/* Current Phase */}
            <div className="bg-white rounded-lg border-2 border-blue-900 p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                  <Target className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-slate-900">Phase 1: Business Admin 200L</h3>
                    <span className="text-xs font-semibold text-white bg-blue-900 px-2 py-0.5 rounded">Current</span>
                  </div>
                  <p className="text-sm text-slate-600">
                    Complete coverage of all first semester courses with quizzes, notes, and study materials.
                  </p>
                </div>
              </div>
            </div>

            {/* Coming Soon */}
            <div className="bg-white rounded-lg border border-slate-200 p-5 opacity-80">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-slate-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-slate-700">Phase 2: 200L Second Semester + Tutoring</h3>
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Q2 2026</span>
                  </div>
                  <p className="text-sm text-slate-500">
                    Adding second semester courses and launching peer tutoring marketplace.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-5 opacity-70">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0">
                  <Building className="w-5 h-5 text-slate-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-slate-700">Phase 3: More Departments</h3>
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Coming</span>
                  </div>
                  <p className="text-sm text-slate-500">
                    Expanding to Accounting, Economics, and other departments at UNILAG.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-5 opacity-60">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-slate-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-slate-700">Phase 4: More Universities</h3>
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Future</span>
                  </div>
                  <p className="text-sm text-slate-500">
                    Bringing CampusIntel to other Nigerian universities.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm text-slate-500 mb-4">Want us to cover your department or university sooner?</p>
            <a
              href="https://wa.me/2349018750976?text=I%20want%20CampusIntel%20to%20expand%20to%20my%20department%2Funiversity"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-green-600 hover:text-green-700 bg-green-50 px-4 py-3 rounded-lg min-h-[44px]"
            >
              <MessageCircle className="w-5 h-5" />
              Let us know on WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-blue-900 text-white py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-bold text-balance">Ready to Excel?</h2>
          <p className="text-blue-200 text-lg max-w-2xl mx-auto">
            Start exploring courses, study notes, and practice quizzes. Need help? Reach out on WhatsApp.
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
