'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Users, GraduationCap, MessageCircle, Sparkles, Bell, CheckCircle, Clock, BookOpen } from 'lucide-react'

export default function TutorsPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [subjects, setSubjects] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Build WhatsApp message for waitlist
    const message = `*Tutor Waitlist - CampusIntel*

*I want to find a tutor!*

*Name:* ${name}
*Email:* ${email}
*Subjects I need help with:* ${subjects}

Please notify me when tutors are available.`

    const encodedMessage = encodeURIComponent(message)
    window.open(`https://wa.me/2349018750976?text=${encodedMessage}`, '_blank')
    setSubmitted(true)
  }

  const upcomingFeatures = [
    {
      icon: Users,
      title: 'Verified Peer Tutors',
      description: 'Connect with top-performing students (3.5+ CGPA) who excel in your courses.',
    },
    {
      icon: BookOpen,
      title: 'Subject Matching',
      description: 'Find tutors specifically for BUA203, ACC201, BUA210, and other courses.',
    },
    {
      icon: MessageCircle,
      title: 'Direct WhatsApp Contact',
      description: 'Message tutors directly to schedule sessions at your convenience.',
    },
    {
      icon: Clock,
      title: 'Flexible Scheduling',
      description: 'Book sessions that work around your class schedule.',
    },
  ]

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12 pb-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 px-4 py-2 rounded-full text-sm font-semibold mb-4">
            <Clock className="w-4 h-4" />
            Coming Soon
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-blue-900 mb-3">
            Find a Peer Tutor
          </h1>
          <p className="text-slate-600 max-w-xl mx-auto">
            We are building a marketplace to connect you with top-performing students who can help you master difficult courses. Join the waitlist to be notified when we launch!
          </p>
        </div>

        {/* Illustration / Visual */}
        <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-lg p-8 md:p-12 text-center mb-8">
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center">
              <Users className="w-12 h-12 text-white" />
            </div>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Peer Tutoring is Coming
          </h2>
          <p className="text-blue-100 max-w-lg mx-auto mb-6">
            Get one-on-one help from verified UNILAG students who have excelled in the courses you find challenging.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <span className="bg-white/10 text-white px-4 py-2 rounded-full text-sm">BUA203 - Statistics</span>
            <span className="bg-white/10 text-white px-4 py-2 rounded-full text-sm">ACC201 - Accounting</span>
            <span className="bg-white/10 text-white px-4 py-2 rounded-full text-sm">BUA210 - Math</span>
            <span className="bg-white/10 text-white px-4 py-2 rounded-full text-sm">+ More</span>
          </div>
        </div>

        {/* Upcoming Features */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          {upcomingFeatures.map((feature, idx) => (
            <div key={idx} className="bg-white rounded-lg border border-slate-200 p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-5 h-5 text-blue-900" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{feature.title}</h3>
                  <p className="text-sm text-slate-600">{feature.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Waitlist Form */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 md:p-8 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Bell className="w-5 h-5 text-blue-900" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Join the Waitlist</h2>
              <p className="text-sm text-slate-600">Be the first to know when tutors are available</p>
            </div>
          </div>

          {submitted ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">You are on the list!</h3>
              <p className="text-slate-600 text-sm mb-4">
                We will notify you via WhatsApp when peer tutors are available.
              </p>
              <button
                onClick={() => setSubmitted(false)}
                className="text-blue-600 text-sm font-medium hover:underline"
              >
                Submit another request
              </button>
            </div>
          ) : (
            <form onSubmit={handleWaitlistSubmit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
                    Your Name *
                  </label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                    placeholder="your.email@example.com"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="subjects" className="block text-sm font-medium text-slate-700 mb-2">
                  What subjects do you need help with? *
                </label>
                <input
                  type="text"
                  id="subjects"
                  required
                  value={subjects}
                  onChange={(e) => setSubjects(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                  placeholder="e.g. Business Statistics, Financial Accounting, Business Maths"
                />
              </div>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 text-white h-14 rounded-lg text-base font-semibold transition-colors min-h-[56px]"
              >
                <Bell className="w-5 h-5" />
                Join Waitlist via WhatsApp
              </button>
              <p className="text-xs text-slate-500 text-center">
                Your request will be sent via WhatsApp. We will reach out when tutors are available.
              </p>
            </form>
          )}
        </div>

        {/* Become a Tutor CTA */}
        <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-lg p-6 md:p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Are You a Top Student?
          </h2>
          <p className="text-green-100 mb-6 max-w-xl mx-auto">
            We are looking for tutors! If you have a 3.5+ CGPA and want to earn money helping juniors succeed, apply to become a tutor.
          </p>
          <Link
            href="/become-a-tutor"
            className="inline-flex items-center gap-2 bg-white text-green-700 hover:bg-green-50 font-semibold px-6 py-3 rounded-lg transition min-h-[48px]"
          >
            <Sparkles className="w-5 h-5" />
            Apply to Become a Tutor
          </Link>
        </div>
      </div>
    </div>
  )
}
