import { cookies } from 'next/headers'
import { MessageCircle, Upload, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { courses } from '@/lib/data/courses'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { COOKIE_NAME, verifySessionToken } from '@/lib/admin-auth'
import AdminLoginForm from './AdminLoginForm'
import AdminLogoutButton from './AdminLogoutButton'

export default async function AdminPage() {
  // Server-side auth gate. The session cookie is read and its signature +
  // expiry verified here; nothing below the guard is sent to the client when
  // the visitor is unauthenticated. Fails closed via verifySessionToken.
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const isAuthenticated = await verifySessionToken(token)

  if (!isAuthenticated) {
    // Render ONLY the login form — no dashboard markup or data reaches the
    // browser pre-auth.
    return <AdminLoginForm />
  }

  // Calculate statistics
  const totalResources = courses.reduce((sum, course) => sum + course.resources.length, 0)
  const totalTextbooks = courses.reduce((sum, course) => sum + course.textbooks.length, 0)
  const totalDownloads = courses.reduce(
    (sum, course) => sum + course.resources.reduce((rSum, r) => rSum + (r.downloadCount || 0), 0),
    0
  )

  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-blue-900">Admin Dashboard</h1>
            <p className="text-slate-600 mt-2">Manage CampusIntel resources and courses</p>
          </div>
          <AdminLogoutButton />
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
              href={buildWhatsAppUrl('I have course materials to upload to CampusIntel')}
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
              href={buildWhatsAppUrl('I need to modify course data in CampusIntel')}
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
