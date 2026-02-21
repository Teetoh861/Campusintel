'use client'

import { Resource } from '@/lib/types'
import { FileText, MessageCircle, LinkIcon, FileJson } from 'lucide-react'

interface ResourceCardProps {
  resource: Resource
  courseCode?: string
}

export function ResourceCard({ resource, courseCode }: ResourceCardProps) {
  const getIcon = () => {
    switch (resource.type) {
      case 'pdf':
        return <FileText className="w-5 h-5 text-red-600" />
      case 'past-question':
        return <FileJson className="w-5 h-5 text-purple-600" />
      case 'notes':
        return <FileText className="w-5 h-5 text-blue-600" />
      case 'link':
        return <LinkIcon className="w-5 h-5 text-green-600" />
      default:
        return <FileText className="w-5 h-5 text-slate-600" />
    }
  }

  const getTypeBadge = () => {
    const badges: Record<string, { label: string; color: string }> = {
      pdf: { label: 'PDF', color: 'bg-red-100 text-red-700' },
      'past-question': { label: 'Past Question', color: 'bg-purple-100 text-purple-700' },
      notes: { label: 'Notes', color: 'bg-blue-100 text-blue-700' },
      link: { label: 'Link', color: 'bg-green-100 text-green-700' },
    }
    const badge = badges[resource.type]
    return <span className={`text-xs font-semibold px-2 py-1 rounded ${badge.color}`}>{badge.label}</span>
  }

  const whatsappMessage = encodeURIComponent(
    `Hi, I need the resource: "${resource.title}"${courseCode ? ` for ${courseCode}` : ''}. Please send it to me.`
  )
  const whatsappUrl = `https://wa.me/2349018750976?text=${whatsappMessage}`

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block border border-slate-200 rounded-lg p-5 bg-white hover:border-green-500 hover:shadow-md transition-all active:scale-[0.98]"
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
          {getIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900 line-clamp-2">{resource.title}</h4>
              {resource.fileSize && (
                <p className="text-xs text-slate-500 mt-1">{resource.fileSize}</p>
              )}
            </div>
            {getTypeBadge()}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 space-y-1">
              <p>{resource.uploadDate}</p>
              {resource.downloadCount !== undefined && (
                <p className="text-slate-600 font-medium">{resource.downloadCount} downloads</p>
              )}
            </div>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-lg">
              <MessageCircle className="w-4 h-4" />
              Get on WhatsApp
            </span>
          </div>
        </div>
      </div>
    </a>
  )
}
