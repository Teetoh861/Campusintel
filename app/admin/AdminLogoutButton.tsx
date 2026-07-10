'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// Logout control. POSTs to /api/admin/logout (which clears the session cookie)
// then refreshes so the Server Component re-renders the login form.
export default function AdminLogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleLogout = async () => {
    if (loading) return
    setLoading(true)
    try {
      await fetch('/api/admin/logout', { method: 'POST' })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleLogout}
      disabled={loading}
      variant="outline"
      className="border-slate-300 text-slate-700 hover:bg-slate-100"
    >
      Logout
    </Button>
  )
}
