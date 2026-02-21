import { Course } from '@/lib/types'

export const courses: Course[] = [
  {
    id: '1',
    slug: 'entrepreneurship-innovation',
    code: 'ENT211',
    title: 'Entrepreneurship and Innovation',
    overview:
      'Introduction to entrepreneurship, innovation, opportunity recognition and business creation. Explores the fundamentals of identifying business opportunities and launching ventures.',
    level: 200,
    semester: 1,
    credits: 2,
    difficulty: 'Easy',
    textbooks: [
      {
        title: 'Entrepreneurship: Successfully Launching New Ventures',
        author: 'Barringer & Ireland',
        edition: '5th Edition',
      },
      {
        title: 'Innovation and Entrepreneurship',
        author: 'Drucker',
        edition: '1st Edition',
      },
    ],
    topics: [
      { chapter: '1-2', description: 'Meaning of Entrepreneurship & Types of Entrepreneurs' },
      { chapter: '3-4', description: 'Innovation and Opportunity Recognition' },
      { chapter: '5-6', description: 'Business Ideas and Concept Development' },
      { chapter: '7-8', description: 'Funding Sources and Business Creation' },
      { chapter: '9', description: 'Role of Entrepreneurship in Economic Development' },
    ],
    examFocus: [
      'Definitions of entrepreneurship and innovation',
      'Types of entrepreneurs and their characteristics',
      'Opportunity recognition process',
      'Business idea evaluation',
      'Short essay questions on economic impact',
      'Theoretical frameworks and concepts',
    ],
    resources: [
      {
        id: 'r1',
        title: 'Entrepreneurship Fundamentals - Complete Notes',
        type: 'notes',
        fileSize: '2.1 MB',
        uploadDate: '2024-02-01',
        downloadCount: 145,
      },
      {
        id: 'r2',
        title: 'Innovation and Opportunity Recognition Guide',
        type: 'notes',
        fileSize: '1.5 MB',
        uploadDate: '2024-02-02',
        downloadCount: 98,
      },
      {
        id: 'r3',
        title: 'Past Exam Questions 2022-2024',
        type: 'past-question',
        fileSize: '890 KB',
        uploadDate: '2024-02-03',
        downloadCount: 234,
      },
    ],
  },
  {
    id: '2',
    slug: 'principles-business-administration',
    code: 'BUA201',
    title: 'Principles of Business Administration I',
    overview:
      'Foundation course covering business functions, marketing fundamentals, organizational structure, and management concepts essential for business administration.',
    level: 200,
    semester: 1,
    credits: 3,
    difficulty: 'Medium',
    textbooks: [
      {
        title: 'Principles of Business',
        author: 'Gitman & McDaniel',
        edition: '8th Edition',
      },
      {
        title: 'Introduction to Business Administration',
        author: 'Rue & Byars',
        edition: '9th Edition',
      },
    ],
    topics: [
      { chapter: '1-2', description: 'Business Functions and Organizational Structure' },
      { chapter: '3-4', description: 'Marketing Fundamentals and Segmentation' },
      { chapter: '5-6', description: 'Management Concepts and Principles' },
      { chapter: '7-8', description: 'Business Environment and Strategy' },
    ],
    examFocus: [
      'Definition of business functions',
      'Organizational structure types and benefits',
      'Market segmentation strategies',
      'Management theories and applications',
      'Theory explanations and definitions',
    ],
    resources: [
      {
        id: 'r4',
        title: 'Business Administration Principles - Full Lecture Notes',
        type: 'notes',
        fileSize: '2.8 MB',
        uploadDate: '2024-02-01',
        downloadCount: 167,
      },
      {
        id: 'r5',
        title: 'Marketing Fundamentals Summary',
        type: 'notes',
        fileSize: '1.2 MB',
        uploadDate: '2024-02-02',
        downloadCount: 112,
      },
      {
        id: 'r6',
        title: 'Past Exam Questions 2021-2024',
        type: 'past-question',
        fileSize: '1.5 MB',
        uploadDate: '2024-02-03',
        downloadCount: 189,
      },
    ],
  },
  {
    id: '3',
    slug: 'business-statistics',
    code: 'BUA203',
    title: 'Business Statistics',
    overview:
      'Data collection, analysis, and interpretation techniques including graphs, tables, statistical measures, probability distributions, and their application in business decision-making.',
    level: 200,
    semester: 1,
    credits: 3,
    difficulty: 'Hard',
    textbooks: [
      {
        title: 'Business Statistics',
        author: 'Groebner, Shannon & Fry',
        edition: '9th Edition',
      },
      {
        title: 'Quantitative Methods for Business',
        author: 'Anderson, Sweeney & Williams',
        edition: '13th Edition',
      },
    ],
    topics: [
      { chapter: '1-2', description: 'Data Collection Methods and Types' },
      { chapter: '3-4', description: 'Graphs, Tables, and Data Visualization' },
      { chapter: '5-6', description: 'Central Tendency: Mean, Median, Mode' },
      { chapter: '7-8', description: 'Dispersion: Variance and Standard Deviation' },
      { chapter: '9-10', description: 'Probability and Distributions' },
    ],
    examFocus: [
      'Data collection and sampling techniques',
      'Calculation of mean, median, mode',
      'Standard deviation and variance calculations',
      'Probability distributions',
      'Problem-solving with formulas',
      'Interpretation of statistical results',
    ],
    resources: [],
  },
  {
    id: '4',
    slug: 'leadership-governance',
    code: 'BUA205',
    title: 'Leadership and Governance',
    overview:
      'Comprehensive study of leadership theories, styles, organizational ethics, governance frameworks, and stakeholder management in public and private sectors.',
    level: 200,
    semester: 1,
    credits: 2,
    difficulty: 'Medium',
    assessmentStructure: {
      assignment: 10,
      test: 20,
      exam: 70,
    },
    textbooks: [
      {
        title: 'Leadership: Theory and Practice',
        author: 'Northouse',
        edition: '8th Edition',
      },
      {
        title: 'Corporate Governance',
        author: 'Letza, Sun & Kirkbride',
        edition: '1st Edition',
      },
    ],
    topics: [
      { chapter: '1-3', description: 'Leadership Theories and Models' },
      { chapter: '4-5', description: 'Leadership Styles and Effectiveness' },
      { chapter: '6-7', description: 'Ethics and Governance Frameworks' },
      { chapter: '8-9', description: 'Stakeholder Management and Engagement' },
      { chapter: '10', description: 'Public Sector Reform and Innovation' },
    ],
    examFocus: [
      'Leadership theory definitions and applications',
      'Leadership styles and situational leadership',
      'Ethical leadership principles',
      'Governance structures and responsibilities',
      'Stakeholder analysis and management',
      'Essays on organizational leadership',
    ],
    resources: [
      {
        id: 'r10',
        title: 'Leadership Theories and Styles - Comprehensive Notes',
        type: 'notes',
        fileSize: '2.6 MB',
        uploadDate: '2024-02-01',
        downloadCount: 156,
      },
      {
        id: 'r11',
        title: 'Ethics and Governance Framework Summary',
        type: 'notes',
        fileSize: '1.8 MB',
        uploadDate: '2024-02-02',
        downloadCount: 134,
      },
      {
        id: 'r12',
        title: 'Exam Practice Questions and Essay Topics',
        type: 'past-question',
        fileSize: '1.3 MB',
        uploadDate: '2024-02-03',
        downloadCount: 201,
      },
    ],
  },
  {
    id: '5',
    slug: 'business-mathematics',
    code: 'BUA210',
    title: 'Business Mathematics',
    overview:
      'Mathematical foundations for business including algebra, functions, optimization, demand-supply analysis, and financial calculations essential for business decision-making.',
    level: 200,
    semester: 1,
    credits: 3,
    difficulty: 'Very High',
    textbooks: [
      {
        title: 'Business Mathematics',
        author: 'Clendening & Salzman',
        edition: '13th Edition',
      },
      {
        title: 'Mathematics for Business',
        author: 'Kaplan',
        edition: '1st Edition',
      },
    ],
    topics: [
      { chapter: '1-2', description: 'Algebra Fundamentals and Functions' },
      { chapter: '3-4', description: 'Linear Functions and Equations' },
      { chapter: '5-6', description: 'Demand, Supply and Market Equilibrium Mathematics' },
      { chapter: '7-8', description: 'Cost and Revenue Functions' },
      { chapter: '9-10', description: 'Calculus: Differentiation and Optimization' },
    ],
    examFocus: [
      'Algebraic problem solving',
      'Function notation and evaluation',
      'Demand and supply curve calculations',
      'Cost and revenue function optimization',
      'Differentiation for optimization',
      'Complex problem-solving with multiple steps',
    ],
    resources: [],
  },
  {
    id: '6',
    slug: 'consumer-behaviour',
    code: 'BUA221',
    title: 'Consumer Behaviour',
    overview:
      'Study of consumer decision processes, buyer types, and the psychological, cultural, and social factors influencing consumer choices and market behavior.',
    level: 200,
    semester: 1,
    credits: 2,
    difficulty: 'Medium',
    textbooks: [
      {
        title: 'Consumer Behavior',
        author: 'Solomon',
        edition: '12th Edition',
      },
      {
        title: 'Consumer Behaviour: Buying, Having, and Being',
        author: 'Belch & Belch',
        edition: '6th Edition',
      },
    ],
    topics: [
      { chapter: '1-2', description: 'Consumer Decision-Making Process' },
      { chapter: '3-4', description: 'Types of Consumers and Buyer Behavior' },
      { chapter: '5-6', description: 'Cultural and Social Influences on Consumer Behavior' },
      { chapter: '7-8', description: 'Personality, Attitudes, and Perception' },
      { chapter: '9-10', description: 'Communication, Persuasion and Marketing Appeals' },
    ],
    examFocus: [
      'Consumer decision-making models',
      'Psychological factors affecting consumer choice',
      'Cultural and social influences',
      'Personality and attitude measurement',
      'Communication theories in marketing',
      'Theoretical explanations and applications',
    ],
    resources: [
      {
        id: 'r16',
        title: 'Consumer Behaviour Theories and Models - Full Notes',
        type: 'notes',
        fileSize: '2.7 MB',
        uploadDate: '2024-02-01',
        downloadCount: 189,
      },
      {
        id: 'r17',
        title: 'Case Studies: Consumer Decision Analysis',
        type: 'notes',
        fileSize: '1.6 MB',
        uploadDate: '2024-02-02',
        downloadCount: 142,
      },
      {
        id: 'r18',
        title: 'Exam Questions and Discussion Topics',
        type: 'past-question',
        fileSize: '1.2 MB',
        uploadDate: '2024-02-03',
        downloadCount: 167,
      },
    ],
  },
  {
    id: '7',
    slug: 'financial-accounting-1',
    code: 'ACC201',
    title: 'Financial Accounting I',
    overview:
      'Fundamentals of financial accounting covering the IASB conceptual framework, IFRS 15 revenue recognition, IAS 1 financial statement presentation, IAS 2 inventories, IAS 8 accounting policies, IAS 16 property and equipment, IAS 20 government grants, and IAS 23 borrowing costs.',
    level: 200,
    semester: 1,
    credits: 2,
    difficulty: 'Hard',
    textbooks: [
      {
        title: 'Financial Accounting',
        author: 'Kieso, Weygandt & Warfield',
        edition: '18th Edition',
      },
      {
        title: 'Accounting Principles',
        author: 'Weygandt, Kimmel & Kieso',
        edition: '14th Edition',
      },
    ],
    topics: [
      { chapter: '1', description: 'IASB Framework for the Preparation and Presentation of Financial Statements' },
      { chapter: '2', description: 'IFRS 15 - Revenue from Contracts with Customers' },
      { chapter: '3', description: 'IAS 1 - Presentation of Financial Statements' },
      { chapter: '4', description: 'IAS 2 - Accounting for Inventory' },
      { chapter: '5', description: 'IAS 8 - Accounting Policies, Changes in Estimates and Errors' },
      { chapter: '6', description: 'IAS 16 - Property, Plant, and Equipment (PPE)' },
      { chapter: '7', description: 'IAS 20 - Government Grants' },
      { chapter: '8', description: 'IAS 23 - Borrowing Costs' },
    ],
    examFocus: [
      'IASB Framework qualitative characteristics',
      'IFRS 15 five-step revenue recognition model',
      'IAS 1 complete set of financial statements',
      'IAS 2 inventory valuation (lower of cost and NRV)',
      'IAS 8 retrospective vs prospective application',
      'IAS 16 depreciation calculations (straight-line & reducing balance)',
      'IAS 20 government grants recognition rules',
      'IAS 23 borrowing costs capitalization',
    ],
    resources: [
      {
        id: 'r19',
        title: 'Financial Accounting Principles - Complete Lecture Notes',
        type: 'notes',
        fileSize: '3.3 MB',
        uploadDate: '2024-02-01',
        downloadCount: 278,
      },
      {
        id: 'r20',
        title: 'Practical Journal Entries and Ledger Examples',
        type: 'notes',
        fileSize: '2.2 MB',
        uploadDate: '2024-02-02',
        downloadCount: 245,
      },
      {
        id: 'r21',
        title: 'Past Exam Papers with Solutions 2020-2024',
        type: 'past-question',
        fileSize: '2.4 MB',
        uploadDate: '2024-02-03',
        downloadCount: 312,
      },
    ],
  },
]

export function getCourseBySlug(slug: string): Course | undefined {
  return courses.find((course) => course.slug === slug)
}

export function getCoursesByLevel(level: number): Course[] {
  return courses.filter((course) => course.level === level)
}

export function getCoursesByLevelAndSemester(level: number, semester: number): Course[] {
  return courses.filter((course) => course.level === level && course.semester === semester)
}
