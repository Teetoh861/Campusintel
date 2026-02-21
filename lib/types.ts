export interface Textbook {
  title: string
  author: string
  edition: string
  link?: string
}

export interface Topic {
  chapter: string
  description: string
}

export interface Resource {
  id: string
  title: string
  type: 'pdf' | 'link' | 'notes' | 'past-question'
  url?: string
  fileSize?: string
  uploadDate: string
  downloadCount?: number
}

export interface Course {
  id: string
  slug: string
  code: string
  title: string
  overview: string
  level: number // 200, 300, 400
  semester: number // 1, 2
  credits: number
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Very High'
  lecturer?: string
  assessmentStructure?: {
    assignment?: number
    test?: number
    exam?: number
  }
  
  textbooks: Textbook[]
  topics: Topic[]
  examFocus: string[]
  resources: Resource[]
}

export interface Bookmark {
  courseId: string
  savedAt: string
}

export interface QuizQuestion {
  id: number
  question: string
  options: string[]
  correctAnswer: number // index of correct option (0-based)
  section: string
}

export interface CourseQuiz {
  courseSlug: string
  courseCode: string
  title: string
  totalQuestions: number
  maxQuizQuestions?: number // Maximum questions to show in one quiz attempt
  quizDurationMinutes?: number // Timer duration in minutes
  sections: string[]
  questions: QuizQuestion[]
}
