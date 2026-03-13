'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, GraduationCap, DollarSign, Clock, Users, CheckCircle, MessageCircle, Sparkles } from 'lucide-react'

export default function BecomeATutorPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    level: '',
    department: '',
    subjects: '',
    cgpa: '',
    whyTutor: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Build WhatsApp message
    const message = `*New Tutor Application - CampusIntel*

*Name:* ${formData.name}
*Email:* ${formData.email}
*Phone:* ${formData.phone}
*Level:* ${formData.level}
*Department:* ${formData.department}
*Subjects:* ${formData.subjects}
*CGPA:* ${formData.cgpa}

*Why I want to tutor:*
${formData.whyTutor}`

    const encodedMessage = encodeURIComponent(message)
    window.open(`https://wa.me/2349018750976?text=${encodedMessage}`, '_blank')
  }

  const benefits = [
    {
      icon: DollarSign,
      title: 'Earn While You Learn',
      description: 'Set your own hourly rates and earn money helping juniors succeed.',
    },
    {
      icon: Clock,
      title: 'Flexible Schedule',
      description: 'Choose when you want to tutor. Work around your own academic schedule.',
    },
    {
      icon: Users,
      title: 'Build Your Network',
      description: 'Connect with students across departments and build lasting relationships.',
    },
    {
      icon: GraduationCap,
      title: 'Reinforce Your Knowledge',
      description: 'Teaching others is the best way to master concepts yourself.',
    },
  ]

  const requirements = [
    'Must be a current UNILAG student (300L or above)',
    'Minimum CGPA of 3.5 (or equivalent strong grades in subjects you want to tutor)',
    'Must have scored at least B+ in courses you want to tutor',
    'Good communication skills and patience',
    'Access to WhatsApp for student communication',
  ]

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12 pb-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <Link href="/tutors" className="inline-flex items-center gap-2 text-blue-900 hover:text-blue-800 mb-6">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back to Tutors</span>
        </Link>

        {/* Hero Section */}
        <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-lg p-6 md:p-8 mb-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Become a CampusIntel Tutor
          </h1>
          <p className="text-blue-100 max-w-xl mx-auto">
            Share your knowledge, help fellow students succeed, and earn money while doing it. Join our growing community of peer tutors.
          </p>
        </div>

        {/* Benefits */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          {benefits.map((benefit, idx) => (
            <div key={idx} className="bg-white rounded-lg border border-slate-200 p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <benefit.icon className="w-5 h-5 text-blue-900" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{benefit.title}</h3>
                  <p className="text-sm text-slate-600">{benefit.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Requirements */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Requirements</h2>
          <ul className="space-y-3">
            {requirements.map((req, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="text-slate-700">{req}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Application Form */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 md:p-8">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Apply Now</h2>
          <p className="text-sm text-slate-600 mb-6">
            Fill out the form below and we will review your application within 48 hours.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                  Email Address *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                  placeholder="your.email@example.com"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2">
                  WhatsApp Number *
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  required
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                  placeholder="080XXXXXXXX"
                />
              </div>
              <div>
                <label htmlFor="level" className="block text-sm font-medium text-slate-700 mb-2">
                  Current Level *
                </label>
                <select
                  id="level"
                  name="level"
                  required
                  value={formData.level}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                >
                  <option value="">Select your level</option>
                  <option value="300">300 Level</option>
                  <option value="400">400 Level</option>
                  <option value="500">500 Level / Graduate</option>
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="department" className="block text-sm font-medium text-slate-700 mb-2">
                  Department *
                </label>
                <input
                  type="text"
                  id="department"
                  name="department"
                  required
                  value={formData.department}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                  placeholder="e.g. Business Administration"
                />
              </div>
              <div>
                <label htmlFor="cgpa" className="block text-sm font-medium text-slate-700 mb-2">
                  Current CGPA *
                </label>
                <input
                  type="text"
                  id="cgpa"
                  name="cgpa"
                  required
                  value={formData.cgpa}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                  placeholder="e.g. 4.2"
                />
              </div>
            </div>

            <div>
              <label htmlFor="subjects" className="block text-sm font-medium text-slate-700 mb-2">
                Subjects You Want to Tutor *
              </label>
              <input
                type="text"
                id="subjects"
                name="subjects"
                required
                value={formData.subjects}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base"
                placeholder="e.g. BUA203, BUA210, ACC201"
              />
              <p className="text-xs text-slate-500 mt-1">Separate multiple course codes with commas</p>
            </div>

            <div>
              <label htmlFor="whyTutor" className="block text-sm font-medium text-slate-700 mb-2">
                Why Do You Want to Become a Tutor? *
              </label>
              <textarea
                id="whyTutor"
                name="whyTutor"
                required
                rows={4}
                value={formData.whyTutor}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none transition text-base resize-none"
                placeholder="Tell us about your motivation and any tutoring experience..."
              />
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white h-14 rounded-lg text-base font-semibold transition-colors min-h-[56px]"
            >
              <MessageCircle className="w-5 h-5" />
              Submit Application via WhatsApp
            </button>

            <p className="text-xs text-slate-500 text-center">
              Your application will be sent to our team via WhatsApp for review.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
