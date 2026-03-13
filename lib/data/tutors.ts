import { Tutor, TutorReview } from '@/lib/tutor-types'

export const tutors: Tutor[] = [
  {
    id: 't1',
    slug: 'adaeze-okonkwo',
    name: 'Adaeze Okonkwo',
    level: 400,
    department: 'Business Administration',
    bio: 'Final year student with a passion for making statistics easy to understand. I scored A in BUA203 and have helped over 50 students improve their grades. My teaching style focuses on breaking down complex formulas into simple, memorable steps.',
    subjects: ['BUA203', 'BUA210'],
    rating: 4.9,
    reviewCount: 47,
    hourlyRate: 2500,
    availability: 'available',
    sessionsCompleted: 89,
    responseTime: 'Usually responds within 1 hour',
    achievements: ['Top 5% in BUA203', 'Dean\'s List 2024', 'Peer Tutor Award'],
    verified: true,
  },
  {
    id: 't2',
    slug: 'chinedu-eze',
    name: 'Chinedu Eze',
    level: 500,
    department: 'Accounting',
    bio: 'Graduate student specializing in Financial Accounting. I break down IFRS standards and journal entries into easy-to-follow steps. Former teaching assistant for ACC201 with 3 years of tutoring experience.',
    subjects: ['ACC201', 'BUA203'],
    rating: 4.8,
    reviewCount: 62,
    hourlyRate: 3000,
    availability: 'available',
    sessionsCompleted: 124,
    responseTime: 'Usually responds within 2 hours',
    achievements: ['First Class Graduate', 'ICAN Student Member', 'TA for ACC201'],
    verified: true,
  },
  {
    id: 't3',
    slug: 'fatima-bello',
    name: 'Fatima Bello',
    level: 300,
    department: 'Business Administration',
    bio: 'I specialize in Business Mathematics and love helping students conquer their fear of calculus and optimization. Scored A+ in BUA210 and currently helping juniors prepare for exams.',
    subjects: ['BUA210', 'BUA203'],
    rating: 4.7,
    reviewCount: 28,
    hourlyRate: 2000,
    availability: 'available',
    sessionsCompleted: 45,
    responseTime: 'Usually responds within 30 minutes',
    achievements: ['Mathematics Competition Winner', 'A+ in BUA210'],
    verified: true,
  },
  {
    id: 't4',
    slug: 'david-olamide',
    name: 'David Olamide',
    level: 400,
    department: 'Business Administration',
    bio: 'Passionate about marketing and consumer behaviour. I help students understand the theories behind why people buy and how businesses respond. Active case study approach to learning.',
    subjects: ['BUA201', 'BUA221', 'BUA205'],
    rating: 4.6,
    reviewCount: 35,
    hourlyRate: 2500,
    availability: 'busy',
    sessionsCompleted: 67,
    responseTime: 'Usually responds within 3 hours',
    achievements: ['Marketing Club President', 'Business Plan Competition Finalist'],
    verified: true,
  },
  {
    id: 't5',
    slug: 'grace-nnamdi',
    name: 'Grace Nnamdi',
    level: 400,
    department: 'Business Administration',
    bio: 'I focus on entrepreneurship and business administration courses. My sessions are interactive with real Nigerian business case studies. Let me help you connect theory to practice.',
    subjects: ['ENT211', 'BUA201', 'BUA205'],
    rating: 4.8,
    reviewCount: 41,
    hourlyRate: 2500,
    availability: 'available',
    sessionsCompleted: 78,
    responseTime: 'Usually responds within 1 hour',
    achievements: ['Student Entrepreneur of the Year', 'Dean\'s List'],
    verified: true,
  },
  {
    id: 't6',
    slug: 'ikenna-obi',
    name: 'Ikenna Obi',
    level: 500,
    department: 'Business Administration',
    bio: 'MSc student with expertise in quantitative methods. I tutor statistics, mathematics, and accounting with a focus on exam preparation and calculator techniques for faster problem-solving.',
    subjects: ['BUA203', 'BUA210', 'ACC201'],
    rating: 4.9,
    reviewCount: 56,
    hourlyRate: 3500,
    availability: 'available',
    sessionsCompleted: 112,
    responseTime: 'Usually responds within 1 hour',
    achievements: ['MSc Distinction', 'Published Research', 'Former TA'],
    verified: true,
  },
]

export const tutorReviews: TutorReview[] = [
  {
    id: 'r1',
    tutorId: 't1',
    studentName: 'Anonymous Student',
    rating: 5,
    comment: 'Adaeze made statistics so easy! I went from failing to scoring a B+ in my exams. Her formula sheets are gold.',
    date: '2024-12-15',
    courseCode: 'BUA203',
  },
  {
    id: 'r2',
    tutorId: 't1',
    studentName: 'Anonymous Student',
    rating: 5,
    comment: 'Very patient and explains concepts multiple ways until you understand. Highly recommend!',
    date: '2024-12-10',
    courseCode: 'BUA210',
  },
  {
    id: 'r3',
    tutorId: 't2',
    studentName: 'Anonymous Student',
    rating: 5,
    comment: 'Chinedu helped me understand depreciation and journal entries in just 2 sessions. Worth every naira!',
    date: '2024-12-12',
    courseCode: 'ACC201',
  },
  {
    id: 'r4',
    tutorId: 't3',
    studentName: 'Anonymous Student',
    rating: 5,
    comment: 'Finally someone who makes calculus make sense! Fatima is amazing at breaking down optimization problems.',
    date: '2024-12-08',
    courseCode: 'BUA210',
  },
  {
    id: 'r5',
    tutorId: 't6',
    studentName: 'Anonymous Student',
    rating: 5,
    comment: 'Ikenna\'s calculator tricks saved me in the exam. His past question walkthroughs are incredibly helpful.',
    date: '2024-12-14',
    courseCode: 'BUA203',
  },
]

export function getTutorBySlug(slug: string): Tutor | undefined {
  return tutors.find((tutor) => tutor.slug === slug)
}

export function getTutorsBySubject(courseCode: string): Tutor[] {
  return tutors.filter((tutor) => tutor.subjects.includes(courseCode))
}

export function getAvailableTutors(): Tutor[] {
  return tutors.filter((tutor) => tutor.availability === 'available')
}

export function getTutorReviews(tutorId: string): TutorReview[] {
  return tutorReviews.filter((review) => review.tutorId === tutorId)
}
