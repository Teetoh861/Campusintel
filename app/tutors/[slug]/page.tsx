'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getTutorBySlug, getTutorReviews } from '@/lib/data/tutors'
import { ArrowLeft, Star, Clock, CheckCircle, MessageCircle, Award, Calendar, Shield } from 'lucide-react'

export default function TutorProfilePage() {
  const params = useParams()
  const slug = params.slug as string

  const tutor = getTutorBySlug(slug)
  const reviews = tutor ? getTutorReviews(tutor.id) : []

  if (!tutor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center px-4">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Tutor Not Found</h1>
          <p className="text-slate-600 mb-6">The tutor you are looking for does not exist.</p>
          <Link
            href="/tutors"
            className="inline-flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 text-white h-12 px-6 rounded-md text-sm font-medium transition-colors min-h-[48px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Tutors
          </Link>
        </div>
      </div>
    )
  }

  const availabilityColor = {
    available: 'bg-green-100 text-green-700 border-green-200',
    busy: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    unavailable: 'bg-red-100 text-red-700 border-red-200',
  }

  const availabilityText = {
    available: 'Available for Sessions',
    busy: 'Currently Busy',
    unavailable: 'Not Available',
  }

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12 pb-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <Link href="/tutors" className="inline-flex items-center gap-2 text-blue-900 hover:text-blue-800 mb-6">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back to Tutors</span>
        </Link>

        {/* Profile Header */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 md:p-8 mb-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-blue-100 flex items-center justify-center text-blue-900 font-bold text-3xl md:text-4xl mx-auto md:mx-0">
                {tutor.name.split(' ').map(n => n[0]).join('')}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 text-center md:text-left">
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-2">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{tutor.name}</h1>
                {tutor.verified && (
                  <div className="flex items-center gap-1 text-blue-600">
                    <CheckCircle className="w-5 h-5" />
                    <span className="text-sm font-medium">Verified</span>
                  </div>
                )}
              </div>
              <p className="text-slate-600 mb-3">
                {tutor.level === 500 ? 'Graduate Student' : `${tutor.level} Level`} - {tutor.department}
              </p>

              {/* Rating & Stats */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-4">
                <div className="flex items-center gap-1">
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  <span className="font-bold text-slate-900">{tutor.rating}</span>
                  <span className="text-slate-500">({tutor.reviewCount} reviews)</span>
                </div>
                <div className="flex items-center gap-1 text-slate-500">
                  <Calendar className="w-4 h-4" />
                  <span>{tutor.sessionsCompleted} sessions</span>
                </div>
              </div>

              {/* Availability Badge */}
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${availabilityColor[tutor.availability]}`}>
                <div className={`w-2 h-2 rounded-full ${tutor.availability === 'available' ? 'bg-green-500' : tutor.availability === 'busy' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                <span className="text-sm font-semibold">{availabilityText[tutor.availability]}</span>
              </div>
            </div>

            {/* Price Card */}
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 text-center md:text-right flex-shrink-0">
              <p className="text-sm text-slate-500 mb-1">Hourly Rate</p>
              <p className="text-3xl font-bold text-blue-900 mb-1">₦{tutor.hourlyRate.toLocaleString()}</p>
              <p className="text-xs text-slate-500">per hour</p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* About */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">About</h2>
              <p className="text-slate-600 leading-relaxed">{tutor.bio}</p>
            </div>

            {/* Subjects */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Subjects I Tutor</h2>
              <div className="flex flex-wrap gap-2">
                {tutor.subjects.map((subject) => (
                  <span key={subject} className="text-sm font-medium text-blue-900 bg-blue-50 px-4 py-2 rounded-lg border border-blue-200">
                    {subject}
                  </span>
                ))}
              </div>
            </div>

            {/* Achievements */}
            {tutor.achievements && tutor.achievements.length > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 p-6">
                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Award className="w-5 h-5 text-yellow-500" />
                  Achievements
                </h2>
                <div className="flex flex-wrap gap-2">
                  {tutor.achievements.map((achievement, idx) => (
                    <span key={idx} className="text-sm font-medium text-slate-700 bg-yellow-50 px-3 py-2 rounded-lg border border-yellow-200">
                      {achievement}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Student Reviews</h2>
              {reviews.length > 0 ? (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div key={review.id} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex">
                            {[...Array(5)].map((_, i) => (
                              <Star
                                key={i}
                                className={`w-4 h-4 ${i < review.rating ? 'text-yellow-500 fill-yellow-500' : 'text-slate-200'}`}
                              />
                            ))}
                          </div>
                          <span className="text-sm font-medium text-blue-900 bg-blue-50 px-2 py-0.5 rounded">
                            {review.courseCode}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">{review.date}</span>
                      </div>
                      <p className="text-sm text-slate-600">{review.comment}</p>
                      <p className="text-xs text-slate-400 mt-2">- {review.studentName}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No reviews yet. Be the first to work with this tutor!</p>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Contact Card */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-4">Contact This Tutor</h3>
              
              <a
                href={`https://wa.me/2349018750976?text=Hi%2C%20I%20found%20${encodeURIComponent(tutor.name)}%20on%20CampusIntel%20and%20I%20would%20like%20to%20book%20a%20tutoring%20session%20for%20${encodeURIComponent(tutor.subjects.join(' or '))}.`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white h-12 rounded-md text-sm font-medium transition-colors min-h-[48px] mb-3"
              >
                <MessageCircle className="w-5 h-5" />
                Contact via WhatsApp
              </a>

              <p className="text-xs text-slate-500 text-center">
                We will connect you with the tutor
              </p>
            </div>

            {/* Quick Info */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-4">Quick Info</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Response Time</p>
                    <p className="text-sm text-slate-500">{tutor.responseTime}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Sessions Completed</p>
                    <p className="text-sm text-slate-500">{tutor.sessionsCompleted} sessions</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Verification</p>
                    <p className="text-sm text-slate-500">{tutor.verified ? 'Verified UNILAG Student' : 'Pending Verification'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Trust Badge */}
            <div className="bg-blue-50 rounded-lg border border-blue-200 p-5">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-blue-900 mb-1">CampusIntel Verified</h4>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    This tutor has been verified as a current UNILAG student with strong academic performance in the subjects they tutor.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
