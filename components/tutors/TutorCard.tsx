'use client'

import Link from 'next/link'
import { Tutor } from '@/lib/tutor-types'
import { Star, Clock, CheckCircle, MessageCircle } from 'lucide-react'

interface TutorCardProps {
  tutor: Tutor
}

export function TutorCard({ tutor }: TutorCardProps) {
  const availabilityColor = {
    available: 'bg-green-100 text-green-700',
    busy: 'bg-yellow-100 text-yellow-700',
    unavailable: 'bg-red-100 text-red-700',
  }

  const availabilityText = {
    available: 'Available',
    busy: 'Busy',
    unavailable: 'Unavailable',
  }

  return (
    <Link href={`/tutors/${tutor.slug}`}>
      <div className="bg-white rounded-lg border border-slate-200 p-5 hover:border-blue-900 hover:shadow-md transition-all cursor-pointer h-full flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-900 font-bold text-xl flex-shrink-0">
            {tutor.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-slate-900 truncate">{tutor.name}</h3>
              {tutor.verified && (
                <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
              )}
            </div>
            <p className="text-sm text-slate-500">{tutor.level === 500 ? 'Graduate' : `${tutor.level} Level`} - {tutor.department}</p>
          </div>
        </div>

        {/* Rating & Availability */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-1">
            <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
            <span className="text-sm font-semibold text-slate-900">{tutor.rating}</span>
            <span className="text-sm text-slate-500">({tutor.reviewCount})</span>
          </div>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${availabilityColor[tutor.availability]}`}>
            {availabilityText[tutor.availability]}
          </span>
        </div>

        {/* Subjects */}
        <div className="flex flex-wrap gap-2 mb-4">
          {tutor.subjects.slice(0, 3).map((subject) => (
            <span key={subject} className="text-xs font-medium text-blue-900 bg-blue-50 px-2 py-1 rounded">
              {subject}
            </span>
          ))}
          {tutor.subjects.length > 3 && (
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">
              +{tutor.subjects.length - 3} more
            </span>
          )}
        </div>

        {/* Bio Preview */}
        <p className="text-sm text-slate-600 line-clamp-2 mb-4 flex-grow">{tutor.bio}</p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-auto">
          <div className="flex items-center gap-1 text-sm text-slate-500">
            <Clock className="w-4 h-4" />
            <span>{tutor.sessionsCompleted} sessions</span>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-blue-900">₦{tutor.hourlyRate.toLocaleString()}</p>
            <p className="text-xs text-slate-500">per hour</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
