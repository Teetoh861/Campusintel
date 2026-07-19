'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

// Small interactive login form. It POSTs the password to /api/admin/login
// (where it is compared server-side) and refreshes the route on success so the
// now-authenticated Server Component renders the dashboard. The password never
// touches any client-side comparison — this component only collects and sends
// it.
export default function AdminLoginForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        setPassword('')
        router.refresh()
      } else if (res.status === 429) {
        setError('Too many attempts. Please try again later.')
        setPassword('')
      } else {
        setError('Incorrect password')
        setPassword('')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

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
              maxLength={200}
              placeholder="Enter admin password"
              className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none"
              autoFocus
            />
            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          </div>

          <Button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold"
          >
            {loading ? 'Signing in…' : 'Login'}
          </Button>
        </div>

        <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-slate-600 mb-3">
            For full admin features, please contact us on WhatsApp:
          </p>
          <a
            href={buildWhatsAppUrl('I need admin access to CampusIntel')}
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
