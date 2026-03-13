'use client'

import { useState, useMemo } from 'react'
import { tutors } from '@/lib/data/tutors'
import { TutorCard } from '@/components/tutors/TutorCard'
import { Search, Users, GraduationCap, MessageCircle, Sparkles } from 'lucide-react'
import Link from 'next/link'

export default function TutorsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState<string>('all')

  // Get unique subjects from all tutors
  const allSubjects = useMemo(() => {
    const subjects = new Set<string>()
    tutors.forEach(tutor => tutor.subjects.forEach(s => subjects.add(s)))
    return Array.from(subjects).sort()
  }, [])

  const filteredTutors = useMemo(() => {
    return tutors.filter((tutor) => {
      const matchesSearch =
        tutor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tutor.subjects.some(s => s.toLowerCase().includes(searchQuery.toLowerCase())) ||
        tutor.bio.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesSubject = subjectFilter === 'all' || tutor.subjects.includes(subjectFilter)

      return matchesSearch && matchesSubject
    })
  }, [searchQuery, subjectFilter])

  const availableTutors = filteredTutors.filter(t => t.availability === 'available')

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-8 h-8 text-blue-900" />
            <span className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">Beta</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-blue-900 mb-2">
            Find a Tutor
          </h1>
          <p className="text-slate-600 max-w-2xl">
            Connect with top-performing students who can help you master difficult courses. All tutors are verified UNILAG students with proven track records.
          </p>
        </div>

        {/* Stats Banner */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-blue-900">{tutors.length}</p>
            <p className="text-sm text-slate-500">Active Tutors</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{availableTutors.length}</p>
            <p className="text-sm text-slate-500">Available Now</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-blue-900">{allSubjects.length}</p>
            <p className="text-sm text-slate-500">Subjects Covered</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-blue-900">
              {tutors.reduce((acc, t) => acc + t.sessionsCompleted, 0)}+
            </p>
            <p className="text-sm text-slate-500">Sessions Completed</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, subject, or keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-lg border border-slate-200 bg-white focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
            />
          </div>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="px-4 py-3 rounded-lg border border-slate-200 bg-white focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base min-w-[160px]"
          >
            <option value="all">All Subjects</option>
            {allSubjects.map((subject) => (
              <option key={subject} value={subject}>{subject}</option>
            ))}
          </select>
        </div>

        {/* Clear Filters */}
        {(searchQuery || subjectFilter !== 'all') && (
          <div className="flex flex-wrap gap-2 mb-8">
            <button
              onClick={() => {
                setSearchQuery('')
                setSubjectFilter('all')
              }}
              className="px-5 py-2.5 rounded-full text-sm font-semibold text-red-600 bg-red-50 border border-red-200 min-h-[44px]"
            >
              Clear Filters
            </button>
          </div>
        )}

        {/* Tutors Grid */}
        {filteredTutors.length > 0 ? (
          <>
            <p className="text-sm text-slate-500 mb-4">
              Showing {filteredTutors.length} tutor{filteredTutors.length !== 1 ? 's' : ''}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {filteredTutors.map((tutor) => (
                <TutorCard key={tutor.id} tutor={tutor} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 bg-white rounded-lg border border-slate-200 mb-12">
            <p className="text-lg text-slate-700 font-semibold mb-2">
              No tutors found
            </p>
            <p className="text-slate-500 text-sm mb-6">
              Try adjusting your search or filter
            </p>
            <a
              href="https://wa.me/2349018750976?text=I%20am%20looking%20for%20a%20tutor%20on%20CampusIntel"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-green-600 hover:text-green-700 bg-green-50 px-4 py-3 rounded-lg min-h-[44px]"
            >
              <MessageCircle className="w-5 h-5" />
              Ask us on WhatsApp
            </a>
          </div>
        )}

        {/* Become a Tutor CTA */}
        <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-lg p-6 md:p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Are You a Top Student?
          </h2>
          <p className="text-blue-100 mb-6 max-w-xl mx-auto">
            Earn money by helping your juniors succeed. Set your own rates, choose your subjects, and build your reputation as a tutor.
          </p>
          <Link
            href="/become-a-tutor"
            className="inline-flex items-center gap-2 bg-white text-blue-900 hover:bg-blue-50 font-semibold px-6 py-3 rounded-lg transition min-h-[48px]"
          >
            <Sparkles className="w-5 h-5" />
            Become a Tutor
          </Link>
        </div>
      </div>
    </div>
  )
}
