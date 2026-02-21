'use client'

import { useState } from 'react'
import { Lock, MessageCircle, Upload, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { courses } from '@/lib/data/courses'

const ADMIN_PASSWORD = 'admin123' // Simple hardcoded password for MVP

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleLogin = () => {
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
      setError('')
      setPassword('')
    } else {
      setError('Incorrect password')
      setPassword('')
    }
  }

  // Calculate statistics
  const totalResources = courses.reduce((sum, course) => sum + course.resources.length, 0)
  const totalTextbooks = courses.reduce((sum, course) => sum + course.textbooks.length, 0)
  const totalDownloads = courses.reduce(
    (sum, course) => sum + course.resources.reduce((rSum, r) => rSum + (r.downloadCount || 0), 0),
    0
  )

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-white">
        <div className="w-full max-w-md bg-white rounded-lg border border-slate-200 p-8 shadow-lg">
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-blue-900 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Admin Access</h1>
            <p className="text-slate-600 text-sm mt-2">Enter your password to continue</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Enter admin password"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none"
                autoFocus
              />
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>

            <Button
              onClick={handleLogin}
              className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold"
            >
              Login
            </Button>
          </div>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-slate-600 mb-3">
              For full admin features, please contact us on WhatsApp:
            </p>
            <a
              href="https://wa.me/2349018750976?text=I%20need%20admin%20access%20to%20CampusIntel"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="w-full border-blue-900 text-blue-900 hover:bg-blue-100 gap-2">
                <MessageCircle className="w-4 h-4" />
                Contact Admin
              </Button>
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-blue-900">Admin Dashboard</h1>
            <p className="text-slate-600 mt-2">Manage CampusIntel resources and courses</p>
          </div>
          <Button
            onClick={() => setIsAuthenticated(false)}
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            Logout
          </Button>
        </div>

        {/* Main Content */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Stat Card 1 */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-2">Total Courses</p>
            <p className="text-3xl font-bold text-blue-900">{courses.length}</p>
            <p className="text-xs text-slate-500 mt-2">200 Level: All Active</p>
          </div>

          {/* Stat Card 2 */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-2">Total Resources</p>
            <p className="text-3xl font-bold text-green-600">{totalResources}</p>
            <p className="text-xs text-slate-500 mt-2">Notes, Past Questions, PDFs</p>
          </div>

          {/* Stat Card 3 */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-2">Textbooks Listed</p>
            <p className="text-3xl font-bold text-purple-600">{totalTextbooks}</p>
            <p className="text-xs text-slate-500 mt-2">Recommended reading</p>
          </div>

          {/* Stat Card 4 */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-2">Total Downloads</p>
            <p className="text-3xl font-bold text-orange-600">{totalDownloads}</p>
            <p className="text-xs text-slate-500 mt-2">Resource usage tracking</p>
          </div>
        </div>

        {/* Course List */}
        <div className="mt-8 bg-white rounded-lg border border-slate-200">
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-900" />
              Courses Overview
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-slate-700">Code</th>
                  <th className="px-6 py-3 text-left font-semibold text-slate-700">Title</th>
                  <th className="px-6 py-3 text-left font-semibold text-slate-700">Difficulty</th>
                  <th className="px-6 py-3 text-center font-semibold text-slate-700">Resources</th>
                  <th className="px-6 py-3 text-center font-semibold text-slate-700">Downloads</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course, idx) => (
                  <tr key={course.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-6 py-3 font-semibold text-slate-900">{course.code}</td>
                    <td className="px-6 py-3 text-slate-700">{course.title}</td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
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
                    </td>
                    <td className="px-6 py-3 text-center text-slate-700 font-semibold">{course.resources.length}</td>
                    <td className="px-6 py-3 text-center text-slate-700 font-semibold">
                      {course.resources.reduce((sum, r) => sum + (r.downloadCount || 0), 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Boxes */}
        <div className="mt-8 grid md:grid-cols-2 gap-6">
          {/* Upload Materials */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-900" />
              Upload Course Materials
            </h3>
            <p className="text-slate-600 text-sm mb-4">
              To upload lecture notes, PDFs, or past questions for any course, use the button below:
            </p>
            <a
              href="https://wa.me/2349018750976?text=I%20have%20course%20materials%20to%20upload%20to%20CampusIntel"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="w-full bg-blue-900 hover:bg-blue-800 text-white gap-2">
                <MessageCircle className="w-4 h-4" />
                Send Materials on WhatsApp
              </Button>
            </a>
          </div>

          {/* Data Management */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Data Management</h3>
            <p className="text-slate-600 text-sm mb-4">
              Export or backup system data and manage course information:
            </p>
            <a
              href="https://wa.me/2349018750976?text=I%20need%20to%20modify%20course%20data%20in%20CampusIntel"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="w-full border-2 border-blue-900 text-blue-900 hover:bg-blue-50 gap-2">
                <MessageCircle className="w-4 h-4" />
                Request Data Update
              </Button>
            </a>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-bold text-slate-900 mb-3">Admin Features Guide</h3>
          <p className="text-slate-600 text-sm mb-4">
            All admin functions including material uploads, course edits, and data management are coordinated through WhatsApp to simplify the backend. Here's how to use each feature:
          </p>
          <ul className="space-y-3 text-slate-600 text-sm">
            <li className="flex items-start gap-3">
              <span className="text-blue-900 font-bold mt-0.5">1.</span>
              <span><strong>Upload Materials:</strong> Click "Send Materials on WhatsApp" to submit lecture notes, PDFs, or past questions for any course.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-900 font-bold mt-0.5">2.</span>
              <span><strong>Edit Course Data:</strong> Use "Request Data Update" to modify course information, topics, or assessment structures.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-900 font-bold mt-0.5">3.</span>
              <span><strong>Download Tracking:</strong> Resource download counts are displayed above. Popular materials are tracked automatically.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-900 font-bold mt-0.5">4.</span>
              <span><strong>Student Contributions:</strong> Students can upload materials via the "Upload Material" button on course pages. Submissions go to your WhatsApp for approval.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
