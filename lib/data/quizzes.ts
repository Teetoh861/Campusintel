export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
  section: string;
}

export interface CourseQuiz {
  courseSlug: string;
  courseCode: string;
  title: string;
  totalQuestions: number;
  maxQuizQuestions: number; // Maximum questions to show in one quiz attempt (typically 50)
  quizDurationMinutes: number; // Timer duration in minutes (typically 30)
  sections: string[];
  questions: QuizQuestion[];
}

export const quizzes: Record<string, CourseQuiz> = {
  'financial-accounting-1': {
    courseSlug: 'financial-accounting-1',
    courseCode: 'ACC201',
    title: 'Financial Accounting I - CBT Assessment',
    totalQuestions: 150,
    maxQuizQuestions: 50,
    quizDurationMinutes: 30,
    sections: [
      'Accounting Foundations & Framework',
      'IAS 1 - Presentation of Financial Statements',
      'IAS 2 - Inventories',
      'IAS 8 - Policies, Estimates, and Errors',
      'IAS 20 & IAS 23 - Grants and Borrowing Costs',
      'IFRS 15 - Revenue from Contracts with Customers',
      'IAS 16 - Property, Plant & Equipment',
      'Bookkeeping & Errors',
      'Cost & Management Accounting',
    ],
    questions: [
      {
        id: 1,
        section: 'Accounting Foundations & Framework',
        question: 'Which historical figure is credited with the first published description of the double-entry bookkeeping system in 1494?',
        options: ['Leonardo da Vinci', 'Luca Pacioli', 'Adam Smith', 'Benedetto Cotrugli'],
        correctAnswer: 1,
      },
      ...
    ],
  },
  ... (existing courses),
  'bua221': {
    courseSlug: 'bua221',
    courseCode: 'BUA221',
    title: 'Consumer Behavior - CBT Assessment',
    totalQuestions: 103,
    maxQuizQuestions: 50,
    quizDurationMinutes: 30,
    sections: [],
    questions: [
      ... (Existing questions remain here)
      { id: 51, question: 'Which of the following disciplines is primarily concerned with how culture and traditions influence consumer consumption patterns?', options: ['Economics', 'Psychology', 'Anthropology', 'Sociology'], correctAnswer: 2 },
{ id: 77, question: "Which of the following disciplines is primarily concerned with how culture and traditions influence...integration-to-culture-events="false" ... } . CorrectAnswer = Option (selected.. )
    ],
  }
}