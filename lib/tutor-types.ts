// Tutor Marketplace Types
export interface Tutor {
  id: string
  slug: string
  name: string
  avatar?: string
  level: number // 300, 400, 500 (graduate)
  department: string
  bio: string
  subjects: string[] // Course codes they tutor e.g. ['BUA203', 'BUA210']
  rating: number // 1-5
  reviewCount: number
  hourlyRate: number // in Naira
  availability: 'available' | 'busy' | 'unavailable'
  sessionsCompleted: number
  responseTime: string // e.g. "Usually responds within 2 hours"
  whatsappNumber?: string
  email?: string
  achievements?: string[]
  verified: boolean
}

export interface TutorReview {
  id: string
  tutorId: string
  studentName: string
  rating: number
  comment: string
  date: string
  courseCode: string
}
