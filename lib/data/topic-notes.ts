export interface TopicNote {
  topicTitle: string
  summary: string
  keyPoints: string[]
  examTip?: string
}

export interface CourseTopicNotes {
  courseSlug: string
  courseCode: string
  topics: TopicNote[]
}

export const topicNotes: Record<string, CourseTopicNotes> = {
  'financial-accounting-1': {
    courseSlug: 'financial-accounting-1',
    courseCode: 'ACC201',
    topics: [
      {
        topicTitle: 'IASB Framework for the Preparation and Presentation of Financial Statements',
        summary:
          'The Conceptual Framework is not an accounting standard itself, but it provides the foundational rules, concepts, and definitions that the International Accounting Standards Board (IASB) uses to develop IFRS. Its main objective is to ensure financial statements provide transparent, high-quality, and useful information to investors and creditors.',
        keyPoints: [
          'Fundamental Qualitative Characteristics: Information must be Relevant (capable of influencing user decisions) and a Faithful Representation (complete, neutral, and free from error).',
          'Enhancing Qualitative Characteristics: Comparability, Verifiability, Timeliness, and Understandability.',
          'Definition of an Asset: A resource controlled by the entity as a result of past events from which future economic benefits are expected to flow.',
        ],
        examTip: 'Know the difference between fundamental (Relevance and Faithful Representation) and enhancing qualitative characteristics.',
      },
      {
        topicTitle: 'Introduction to IFRS 15 - Revenue from Contracts with Customers',
        summary:
          'IFRS 15 establishes a single, comprehensive framework for determining when to recognize revenue and how much to recognize. The core principle is that revenue is recognized when control over goods or services is transferred to the customer.',
        keyPoints: [
          'The 5-Step Model: (1) Identify the contract, (2) Identify performance obligations, (3) Determine the transaction price, (4) Allocate the transaction price, (5) Recognize revenue when control passes.',
          'A contract only exists if collection of consideration is probable. If a customer has severe liquidity issues, you cannot recognize a contract.',
          'Performance obligations are distinct promises to transfer goods/services (e.g., software license and technical support are separate).',
          'Transaction price includes fixed and variable consideration (like volume discounts).',
          'Control passes either at a point in time (goods) or over time (services).',
          'Formula: Allocated Price = (Standalone Price ÷ Total Standalone Prices) × Transaction Price',
        ],
        examTip: 'Memorize all 5 steps - this is almost guaranteed to appear. Know when revenue is recognized "at a point in time" vs "over time".',
      },
      {
        topicTitle: 'IAS 1 - Presentation of Financial Statements',
        summary:
          'IAS 1 sets the overall requirements, structure, and minimum content for general-purpose financial statements to ensure comparability with past periods and other entities.',
        keyPoints: [
          'Complete Set of Financial Statements: (1) Statement of Financial Position, (2) Statement of Profit or Loss and OCI, (3) Statement of Changes in Equity, (4) Statement of Cash Flows, (5) Notes.',
          'Current vs. Non-Current: An item is "current" if expected to be realized/settled within 12 months after the reporting period, held primarily for trading, or part of the normal operating cycle.',
          'Expenses Classification: Expenses can be presented by Nature (depreciation, raw materials, wages) or by Function/Cost of Sales (cost of sales, administrative, distribution).',
        ],
        examTip: 'Know all 5 components and the strict current vs. non-current classification rules.',
      },
      {
        topicTitle: 'IAS 2 - Accounting for Inventory',
        summary:
          'IAS 2 dictates how to value inventories (raw materials, work in progress, and finished goods). The fundamental principle is that inventory must always be valued at the lower of cost and Net Realizable Value (NRV).',
        keyPoints: [
          'Valuation Rule: Inventory = Lower of Cost and NRV.',
          'NRV Formula: Estimated Sales Value - Estimated Costs to Sell.',
          'Cost Components: Purchase price (less trade discounts), direct taxes, delivery/carriage inwards, and conversion costs (direct labor + factory overheads).',
          'Strict Exclusions: Abnormal waste, storage costs (unless necessary for production), administrative overheads, selling costs, and interest.',
          'Prohibited Methods: FIFO and Weighted Average are permitted; LIFO is strictly prohibited.',
          'Write-down: If NRV falls below cost, write down to NRV and recognize the loss as an expense immediately.',
        ],
        examTip: 'Lower of cost and NRV is THE rule. LIFO is NEVER allowed. Know what to exclude (abnormal waste, admin costs, selling costs).',
      },
      {
        topicTitle: 'Introduction to IAS 8 - Accounting Policies, Changes in Estimates and Errors',
        summary:
          'IAS 8 prescribes the criteria for selecting accounting policies and the accounting treatment for changes in those policies, changes in estimates, and corrections of prior period errors.',
        keyPoints: [
          'Change in Accounting Policy: (e.g., switching from cost model to fair value model). Applied RETROSPECTIVELY - adjust opening balances and past comparative amounts as if the new policy had always been applied.',
          'Change in Accounting Estimate: (e.g., changing the useful life of an asset, or changing from straight-line to reducing balance depreciation). Applied PROSPECTIVELY - only affects current and future years.',
          'Errors: Prior period errors are also corrected retrospectively.',
        ],
        examTip: 'Key distinction: Policy changes = retrospective. Estimate changes = prospective. This is very common in exams.',
      },
      {
        topicTitle: 'IAS 16 - Property, Plant, and Equipment (PPE)',
        summary:
          'IAS 16 deals with the recognition, initial measurement, and depreciation of tangible non-current assets held for use in production, rental, or administration for more than one period.',
        keyPoints: [
          'Initial Cost: Purchase price + non-refundable taxes + directly attributable costs (site preparation, installation, delivery, testing, professional fees). Exclude general admin costs, training, and regular repair costs.',
          'Depreciation: The systematic allocation of the depreciable amount (Cost - Scrap Value) over its useful life, obeying the matching concept.',
          'Straight-Line Method: Depreciation = (Cost - Scrap Value) / Useful Life',
          'Reducing Balance Method Rate: R = 1 - ⁿ√(Scrap Value / Cost)',
          'Disposal: Profit/Loss on Disposal = Sales Proceeds - Carrying Amount (NBV)',
        ],
        examTip: 'Know how to calculate both Straight-line and Reducing Balance depreciation. Practice the formulas with examples.',
      },
      {
        topicTitle: 'IAS 20 - Government Grants',
        summary:
          'IAS 20 handles the accounting for government assistance and transfers of resources to an entity tied to compliance with operating conditions.',
        keyPoints: [
          'Recognition: Do not recognize a grant until there is reasonable assurance that the entity will comply with conditions AND the grant will be received.',
          'Grants Related to Assets (Two Methods): (1) Capital Approach: Deduct the grant from the asset cost, lowering annual depreciation. (2) Income Approach: Keep asset at full cost, treat grant as Deferred Income and release to profit/loss over the asset\'s life to offset depreciation.',
          'Grants Related to Income: Recognized in the income statement systematically over periods in which related costs/expenses are incurred.',
        ],
        examTip: 'Remember the two approaches for asset-related grants: deduct from cost OR treat as deferred income.',
      },
      {
        topicTitle: 'IAS 23 - Borrowing Costs',
        summary:
          'IAS 23 determines whether interest, finance charges, and amortization of discounts on debt should be expensed immediately or capitalized (added to the cost of an asset).',
        keyPoints: [
          'Capitalization Rule: You MUST capitalize borrowing costs that are directly attributable to the acquisition or construction of a Qualifying Asset.',
          'Qualifying Asset: An asset that takes a substantial period of time (like 2-5 years) to get ready for its intended use or sale.',
          'Idle vs. Active Periods: Only capitalize interest during the active construction period. If construction is halted (e.g., strike) or hasn\'t started, expense the interest.',
          'General Borrowings: If a pool of general loans is used, calculate a weighted average interest rate.',
          'Capitalized Interest Formula (Specific Loan): Total Loan Principal × Interest Rate × (Active Construction Months / 12)',
          'Weighted Average Rate: (Total Interest on all loans ÷ Total Principal on all loans) × 100',
        ],
        examTip: 'Key question: "Is this a qualifying asset?" If yes = capitalize interest. If no = expense. Know when to stop capitalizing (when active construction stops).',
      },
      {
        topicTitle: 'Bookkeeping Fundamentals and Errors',
        summary:
          'Bookkeeping involves recording all financial transactions systematically. Understanding different types of errors and how to correct them is crucial for maintaining accurate financial records.',
        keyPoints: [
          'Accounting Equation: Assets = Capital + Liabilities',
          'Error of Principle: Transaction entered in wrong class of account (e.g., motor expenses debited to motor vehicles).',
          'Error of Transposition: Digits wrongly swapped (e.g., ₦4,466 written as ₦4,664).',
          'Suspense Account: Temporary account opened when trial balance totals do not agree.',
          'Unpresented Cheques: Cheques drawn but not yet presented to the bank for payment.',
          'Bank Reconciliation: Bank charges not in cash book are deducted from cash book balance.',
          'Imprest System: Fixed petty cash float maintained and exactly reimbursed.',
          'Books of Original Entry: Purchases Daybook (credit purchases), Journal (non-standard entries).',
        ],
        examTip: 'Know the different types of errors. Error of Principle is when you put a transaction in the wrong CLASS of account.',
      },
      {
        topicTitle: 'Cost and Management Accounting Fundamentals',
        summary:
          'Cost accounting involves classifying, recording, and allocating costs to determine product costs and support management decisions. Key concepts include prime cost, conversion cost, and break-even analysis.',
        keyPoints: [
          'Prime Cost: Direct Material + Direct Labour + Direct Expenses',
          'Conversion Cost: Cost of converting raw materials into finished products (Direct Labour + Factory Overheads).',
          'Sunk Cost: A cost that has already been incurred and cannot be recovered.',
          'Marginal Costing: Fixed production overheads treated as period costs and written off to Profit or Loss.',
          'Absorption Costing: Fixed production overheads charged to cost units (included in product cost).',
          'Break-even Point (units): Fixed Cost ÷ Contribution per unit',
          'Margin of Safety: Budgeted Sales - Break-even Sales',
          'Economic Order Quantity (EOQ): Considers Annual Demand, Ordering Cost, Holding Cost.',
          'Variable Cost: Varies directly in proportion to activity level.',
          'Fixed Cost: Remains constant in total regardless of output volume (within relevant range).',
          'Contribution: Sales Revenue - Variable Cost',
        ],
        examTip: 'Know the formulas for Break-even Point and Margin of Safety. Understand the difference between Marginal and Absorption Costing.',
      },
    ],
  },
  'entrepreneurship-innovation': {
    courseSlug: 'entrepreneurship-innovation',
    courseCode: 'ENT211',
    topics: [
      {
        topicTitle: 'Theory and Concept of Entrepreneurship Studies',
        summary:
          'Entrepreneurship is the process of establishing a new business venture to create utility. It has evolved through contributions from pioneers like Richard Cantillon (risk-takers), Joseph Schumpeter (innovation), and Peter Drucker (learnable discipline).',
        keyPoints: [
          'Richard Cantillon (circa 1730): First to coin the term "entrepreneur" - defined them as risk-takers who invest for profit.',
          'Joseph Schumpeter: Father of innovation - defined entrepreneurship as carrying out "new combinations" (new products, methods, markets).',
          'Peter Drucker: Emphasized entrepreneurship is a discipline that can be systematically learned, not genetic.',
          'Intrapreneurs: Exhibit entrepreneurial skills while working within an existing organization.',
          'Types: Fabian (cautious, lazy), Drone (resistant to change), Imitating (copycats), Innovative (create new things).',
        ],
        examTip: 'Associate key figures with their definitions: Cantillon = risk, Schumpeter = innovation, Drucker = learnable discipline.',
      },
      {
        topicTitle: 'Entrepreneurial Theories: Effectuation and Discovery',
        summary:
          'Modern theories explain how entrepreneurs think and act. Effectuation Theory (Sarasvathy) and Entrepreneurial Discovery (Kirzner) provide frameworks for understanding entrepreneurial decision-making.',
        keyPoints: [
          'Effectuation Theory: Start with available means rather than predicting the future.',
          'Bird-in-Hand Principle: Use what you already have (skills, knowledge, network).',
          'Affordable Loss: Only risk what you can afford to lose.',
          'Lemonade Principle: Turn surprises and failures into opportunities (making lemonade from lemons).',
          'Kirzner\'s Entrepreneurial Discovery: Entrepreneurs are alert opportunity seekers who discover pre-existing market gaps others miss.',
        ],
        examTip: 'Remember the three key principles of Effectuation: Bird-in-Hand, Affordable Loss, and Lemonade.',
      },
      {
        topicTitle: 'The Entrepreneurial Mindset and Characteristics',
        summary:
          'Successful entrepreneurs share psychological traits including internal locus of control, tolerance for ambiguity, and need for independence. The entrepreneurial mindset can be developed through continuous learning and observation.',
        keyPoints: [
          'Internal Locus of Control: Believing success is determined by your own actions, not fate or luck.',
          'Tolerance for Ambiguity: Ability to handle uncertain and risky situations.',
          'Most Important Reward: Independence (being one\'s own boss).',
          'Serial Entrepreneur: Continuously starts, scales, and moves to new businesses.',
          'Portfolio Entrepreneur: Owns and manages multiple diversified businesses simultaneously.',
          'Lifestyle Entrepreneur: Creates business to support personal passions and work-life balance.',
        ],
        examTip: 'Internal locus of control and tolerance for ambiguity are the two most critical psychological traits.',
      },
      {
        topicTitle: 'Creativity, Innovation, and the Creative Process',
        summary:
          'Creativity is thinking of new things; innovation is doing new things that create value. Understanding the creative process and fostering innovative thinking are essential entrepreneurial skills.',
        keyPoints: [
          'Creativity vs. Innovation: Creativity = generating novel ideas; Innovation = translating ideas into valuable products/services.',
          '5 Stages of Creative Process: (1) Idea germination, (2) Preparation, (3) Incubation, (4) Illumination, (5) Verification.',
          'Convergent Thinking: Piecing together information to form one singular conventional idea.',
          'Divergent Thinking: Analyzing one piece of information to generate multiple novel ideas.',
          'Disruptive Innovation: Creates new markets and displaces established firms (e.g., Netflix displacing Blockbuster).',
          'Knowledge Management: Knowledge fuels innovation - cannot innovate without understanding markets, technology, and finance.',
        ],
        examTip: 'Memorize the 5-stage creative process. Verification is the final stage where ideas are tested.',
      },
      {
        topicTitle: 'Scanning and Analyzing the Business Environment',
        summary:
          'Businesses operate within internal and external environments. SWOT analysis helps entrepreneurs match internal capabilities with external realities to identify opportunities and threats.',
        keyPoints: [
          'Internal Environment (Micro): Strengths and Weaknesses - factors the entrepreneur can control (staff skills, financial resources, culture).',
          'External Environment (Macro): Opportunities and Threats - factors beyond direct control (government policies, competitors, economy).',
          'SWOT Analysis: Framework for strategic planning matching internal strengths/weaknesses with external opportunities/threats.',
          'Environmental Scanning: Searching and analyzing the business environment to identify opportunities to exploit and threats to avoid.',
          'Effective Demand: Demand backed by purchasing power (money) to actually buy the product.',
        ],
        examTip: 'Remember: Strengths and Weaknesses are INTERNAL (controllable); Opportunities and Threats are EXTERNAL (uncontrollable).',
      },
      {
        topicTitle: 'Business Plans and Feasibility Studies',
        summary:
          'Feasibility studies investigate whether an idea is viable before starting. Business plans are comprehensive roadmaps created after viability is proven, essential for securing funding.',
        keyPoints: [
          'Feasibility Study: Investigative tool used BEFORE starting to assess viability and costs/benefits.',
          'Business Plan: Written roadmap detailing marketing, operations, and financial strategies; created AFTER idea is proven viable.',
          'Executive Summary: Summary of all key sections; should work as stand-alone document to hook investors.',
          'Break-Even Analysis: Determines when the firm will begin to turn a profit.',
          'Essential for Funding: Feasibility studies and business plans help convince banks and investors of viability.',
        ],
        examTip: 'Key distinction: Feasibility Study comes BEFORE (investigative); Business Plan comes AFTER (execution roadmap).',
      },
      {
        topicTitle: 'Forms of Business Ownership',
        summary:
          'Different legal structures carry distinct levels of risk, control, and capital generation potential. Choosing the right structure is critical for business success.',
        keyPoints: [
          'Sole Proprietorship: Simplest form, owned by one person. Advantage: Full control. Disadvantage: Unlimited personal liability.',
          'Partnership: Owned by 2-20 people sharing profits and risks. Advantage: Shared resources. Disadvantage: Unlimited liability, potential conflicts.',
          'Limited Liability Company (LLC): Separate legal entity. Advantage: Limited liability (personal assets protected). Disadvantage: More complex setup.',
          'Franchising: Operating under established brand and business model (e.g., McDonald\'s).',
          'Primary Failure Cause: Not seeking proper legal/accounting help when choosing structure.',
        ],
        examTip: 'Focus on liability: Sole Proprietorship/Partnership = UNLIMITED liability; LLC = LIMITED liability.',
      },
      {
        topicTitle: 'Sources of Business Funding',
        summary:
          'Understanding funding sources is crucial for startup survival. The safest approach is starting with personal savings (bootstrapping) before seeking external funding.',
        keyPoints: [
          'Three Categories: Personal/Family sources, Internal sources (retained profits), External sources (loans, equity).',
          'Safest Source: Personal savings (bootstrapping) - relying on borrowed funds early is dangerous.',
          'Equity Capital: Selling ownership portion to investors; requires no scheduled repayment, making it safer than debt.',
          'Trade Credit: Short-term financing where seller allows buying goods and paying later.',
          'Factoring: Selling unpaid invoices to finance house at discount for immediate cash.',
          'Crowdfunding: Raising small amounts from many people via internet platforms.',
        ],
        examTip: 'Remember: Personal savings is the SAFEST primary source for new ventures. Equity is safer than debt.',
      },
      {
        topicTitle: 'Nigerian Business Environment and Government Support',
        summary:
          'The Nigerian business environment is complex and challenging, but government agencies provide critical support. Understanding these agencies is essential for compliance and accessing resources.',
        keyPoints: [
          'CAC (Corporate Affairs Commission): Registers and supervises businesses in Nigeria.',
          'NAFDAC: Regulates food, drugs, and cosmetics manufacturing and distribution.',
          'SON (Standards Organisation of Nigeria): Maintains product and method standardization.',
          'SMEDAN: Supports, trains, and provides resources for MSMEs.',
          'Business Definitions: Micro (1-9 employees), Small (10-49 employees), Medium (50-199 employees).',
          'Environment Characteristics: Highly complex, dynamic, uncertain with infrastructural deficits.',
        ],
        examTip: 'Know the acronyms and functions: CAC = registration, NAFDAC = food/drugs, SMEDAN = SME support.',
      },
      {
        topicTitle: 'Teamwork, Vision, and Social Entrepreneurship',
        summary:
          'Successful ventures require effective teams, clear vision, and increasingly, social impact. Understanding group dynamics and social responsibility is essential for modern entrepreneurs.',
        keyPoints: [
          '5 Stages of Group Development: Forming, Storming, Norming, Performing, Adjourning.',
          'Vision: Mental picture of preferred future, consisting of Core Ideology and Envisioned Future.',
          'Goals vs. Vision: Goals must be SMART (Specific, Measurable, Achievable, Realistic, Time-bound).',
          'Primary Business Aim: Create value and solve human problems; profit is the reward for doing this successfully.',
          'Social Entrepreneurship: Non-profit-oriented ventures solving societal problems while maintaining financial sustainability.',
          'Business Ethics: Moral principles governing appropriate conduct; includes Corporate Social Responsibility (CSR).',
        ],
        examTip: 'Remember the 5 stages as a story: meet (form), argue (storm), agree on rules (norm), work (perform), leave (adjourn).',
      },
    ],
  },
  'principles-business-administration': {
    courseSlug: 'principles-business-administration',
    courseCode: 'BUA201',
    topics: [
      {
        topicTitle: 'Introduction to Business and Management',
        summary:
          'Business organizations are legal entities formed to carry on commercial enterprise. Management is the art of getting things done through others, involving planning, organizing, and controlling resources.',
        keyPoints: [
          'Business Characteristics: Economic activities for profit, legal entity status, utilizes resources, requires structured management, operates under risk.',
          'Historical Evolution: Barter → Medieval Guilds → Industrial Revolution → Modern Multinational Corporations.',
          'Traditional Purpose: Profit maximization and shareholder wealth (Adam Smith\'s influence).',
          'Modern Purpose: Value creation, employment generation, wealth distribution - businesses as social institutions.',
          'Management Definition: Process of designing and maintaining an environment where individuals efficiently accomplish selected aims.',
        ],
        examTip: 'Focus on the shift from traditional (profit-only) to modern (social institution) purpose of business.',
      },
      {
        topicTitle: 'Evolution of Management Thought',
        summary:
          'Management theory has evolved through distinct eras, each contributing unique perspectives on how to organize and lead organizations effectively.',
        keyPoints: [
          'Classical Approach (Late 19th-Early 20th Century): Scientific Management (Taylor - time/motion studies), Administrative (Fayol - 14 principles), Bureaucratic (Weber - formal rules).',
          'Human Relations (1930s-1950s): Hawthorne Studies (Mayo), Maslow\'s hierarchy, McGregor\'s Theory X and Y - emphasized social factors and psychological needs.',
          'Quantitative/Management Science (1940s-1960s): Mathematical models, statistics, forecasting for optimization.',
          'Systems Theory: Views organizations as open systems taking inputs, transforming them, and producing outputs.',
          'Key Distinction: Classical focuses on efficiency; Human Relations focuses on people and motivation.',
        ],
        examTip: 'Associate key figures: Taylor = Scientific Management, Fayol = 14 Principles, Weber = Bureaucracy, Mayo = Human Relations.',
      },
      {
        topicTitle: 'The Business Environment: SWOT and PESTLE',
        summary:
          'Organizations operate within complex internal and external environments. SWOT and PESTLE frameworks help analyze these environments for strategic planning.',
        keyPoints: [
          'Internal Environment: Strengths and Weaknesses - organizational structure, culture, resources (financial, physical, human).',
          'External Environment: Opportunities and Threats - generally cannot be controlled.',
          'Micro Environment: Immediate actors like competitors, suppliers, customers, regulators.',
          'PESTLE Analysis: Political (tax, stability), Economic (inflation, exchange rates), Social (demographics, culture), Technological (R&D, automation), Legal (employment/consumer laws), Ecological (climate).',
          'SWOT Purpose: Match internal conditions to external realities for strategic advantage.',
        ],
        examTip: 'Memorize PESTLE acronym. Remember: Internal factors are controllable; External factors are uncontrollable.',
      },
      {
        topicTitle: 'Functional Areas: Marketing Management',
        summary:
          'Marketing begins before product creation (identifying needs) and continues after sales (after-sales service). It requires understanding customer segments and positioning products effectively.',
        keyPoints: [
          'STP Framework: Segmentation (dividing market), Targeting (selecting best segment), Positioning (creating unique image in consumers\' minds).',
          'Marketing Mix (4Ps): Product (what you sell), Price (what customers pay), Place (distribution), Promotion (advertising, PR).',
          'Nigerian Urban Markets: Focus on trends, aesthetics, digital marketing.',
          'Nigerian Rural Markets: Prioritize value, durability, bulk purchases (gap bridging due to mobile access).',
          'Timing: Marketing starts BEFORE product creation by identifying customer needs.',
        ],
        examTip: 'Know the 4Ps and STP framework cold - these are guaranteed exam questions.',
      },
      {
        topicTitle: 'Functional Areas: Human Resources Management',
        summary:
          'HRM focuses on recruiting, developing, and managing staff. It works interdependently with Marketing through Employer Branding to build both internal and external organizational reputation.',
        keyPoints: [
          'Core Functions: Recruitment, Training & Development, Compensation, Performance Appraisal, Legal Compliance.',
          'Cross-Functional Integration: HR and Marketing collaborate on Employer Branding.',
          'Employer Branding: HR recruits culturally aligned people so workforce can deliver promises Marketing makes to public.',
          'Strategic Role: HR builds internal brand (employees); Marketing builds external brand (customers).',
          'Legal Compliance: Ensuring adherence to employment laws and regulations.',
        ],
        examTip: 'Understand how HR and Marketing depend on each other through Employer Branding concept.',
      },
      {
        topicTitle: 'Corporate Governance and Leadership',
        summary:
          'Corporate governance is the framework of policies directing and controlling organizations. Leadership theories explain how leaders influence followers to achieve organizational goals.',
        keyPoints: [
          'Corporate Governance: Framework promoting transparency, integrity, public trust. Nigerian Code (NCCG 2018).',
          'Management as Profession: Regulated by Nigerian Institute of Management (NIM) - requires specialized training and ethics.',
          'NIM Code of Ethics: Integrity, Transparency, Fairness, Accountability.',
          'Transformational Leadership: Inspires followers to embrace change and exceed expectations.',
          'Transactional Leadership: Based on exchange of rewards and punishments.',
          'Servant Leadership: Prioritizes empowering and supporting employees over exercising authority.',
        ],
        examTip: 'Know NIM code of ethics values and distinguish Transformational vs. Servant vs. Transactional leadership.',
      },
      {
        topicTitle: 'Leadership Theories and Styles',
        summary:
          'Various theories explain leadership effectiveness. Understanding different leadership approaches helps managers adapt their style to situational requirements.',
        keyPoints: [
          'Trait Theory (Great Man): Leaders are born with innate abilities (charisma, courage).',
          'Behavioral Theory: Focuses on what leaders do (task-oriented vs. people-oriented).',
          'Contingency/Situational: Situation determines best leadership approach.',
          'Transformational: Four dimensions - Idealized Influence, Inspirational Motivation, Intellectual Stimulation, Individualized Consideration.',
          'Responsible Leadership: Considers interests of all stakeholders (employees, society, environment), not just profit.',
        ],
        examTip: 'Know the four dimensions of Transformational Leadership and how it differs from Transactional.',
      },
      {
        topicTitle: 'Contemporary Issues: Nigerian Business Challenges',
        summary:
          'Nigerian managers operate in a volatile, high-risk environment requiring constant adaptation. Infrastructure decay, insecurity, and economic volatility create unique strategic challenges.',
        keyPoints: [
          'Key Challenges: Insecurity (banditry, kidnapping), Infrastructure deficits (poor roads, erratic power), Economic volatility (inflation, FX scarcity), Human capital (brain drain, skills gap).',
          'Insecurity Impact: Disrupts supply chains, increases operating costs (private security spending).',
          'Infrastructure: Poor power forces expensive self-generated power (diesel).',
          'Economic Issues: High inflation erodes purchasing power; FX scarcity makes importing raw materials expensive.',
          'Strategic Adaptations: Vertical Integration (e.g., Presco generating own power from waste).',
        ],
        examTip: 'List major challenges: power, roads, FX, inflation, insecurity. Explain how companies adapt (e.g., vertical integration).',
      },
      {
        topicTitle: 'Innovation and Digitalization in Nigeria',
        summary:
          'Despite challenges, Nigeria is experiencing technological boom. FinTech and e-commerce are driving financial inclusion and optimizing logistics, creating opportunities for innovation.',
        keyPoints: [
          'FinTech Success: Flutterwave, Paystack driving financial inclusion through digital payments.',
          'E-commerce Growth: Platforms optimizing logistics and expanding market access.',
          'Digital Transformation: Mobile technology bridging urban-rural gap.',
          'Opportunities: Tech innovation compensating for infrastructure deficits.',
          'Innovation Strategy: Using technology to bypass traditional infrastructure limitations.',
        ],
        examTip: 'Know how FinTech firms like Flutterwave/Paystack innovate around infrastructure challenges.',
      },
      {
        topicTitle: 'Biographic Study of Successful Nigerian Managers',
        summary:
          'Learning from successful Nigerian business leaders provides practical insights into effective leadership and entrepreneurial strategies in the Nigerian context.',
        keyPoints: [
          'Aliko Dangote: Learning through apprenticeship, high risk appetite, disciplined and focused approach, present in 10+ African countries.',
          'Ibukun Awosika: Empathetic leadership, prioritizing impact alongside profit, first female First Bank chairman.',
          'Cosmas Maduka (Coscharis): Built automobile empire using traditional "Nwa boy" apprenticeship system.',
          'Femi Otedola: Opportunist investor working with data and timing.',
          'Common Traits: Adaptability, risk-taking, leveraging Nigerian cultural systems (like apprenticeship).',
        ],
        examTip: 'Link specific managers to their defining strategies: Dangote = high risk appetite, Maduka = apprenticeship system.',
      },
    ],
  },
  'leadership-governance': {
    courseSlug: 'leadership-governance',
    courseCode: 'BUA205',
    topics: [
      {
        topicTitle: 'An Overview of Leadership',
        summary:
          'Leadership is the relational process of influencing, guiding, and inspiring others toward shared goals. Effective leaders possess specific traits and characteristics including integrity, emotional intelligence, and adaptability.',
        keyPoints: [
          'Leadership Definition: Relational process of influencing, guiding, and inspiring others toward shared goals and collective development.',
          'Trait Theory (Great Man Hypothesis): Leaders are born with specific traits like intelligence, vigor, conceptual ability.',
          'Behavioral Theory: Evaluates behavioral characteristics and styles rather than inherent traits.',
          'Effective Leader Characteristics: Visionary & strategic, integrity, emotional intelligence, adaptability, accountability.',
          'Core Leadership Roles: Providing direction, motivating followers, decision-making, maintaining ethical standards, managing change.',
        ],
        examTip: 'Know the difference between Trait Theory (born leaders) and Behavioral Theory (learned behaviors).',
      },
      {
        topicTitle: 'Traditional Leadership Styles',
        summary:
          'Traditional leadership styles represent classical approaches to leading organizations. Each style has distinct advantages and disadvantages depending on organizational context.',
        keyPoints: [
          'Democratic (Participative): Inspires employees to participate in decision-making. Advantage: Builds trust and innovation. Disadvantage: Slow decisions.',
          'Autocratic (Authoritarian): Centralized decision-making, minimal participation. Advantage: Fast crisis decisions. Disadvantage: Lowers morale, limits creativity.',
          'Bureaucratic: Strict adherence to policy and guidelines. Managers as regulatory officers.',
          'Laissez-Faire (Delegative): Hands-off approach, maximum autonomy. Effective only with highly skilled, motivated subordinates.',
        ],
        examTip: 'Contrast Democratic (participative, slow) with Autocratic (fast, low morale). Know when each is appropriate.',
      },
      {
        topicTitle: 'Contemporary Leadership Styles',
        summary:
          'Modern leadership theories emphasize inspiration, transformation, and moral philosophy. These approaches focus on empowering followers and creating positive organizational change.',
        keyPoints: [
          'Transformational Leadership: Inspires followers to exceed expectations. Four dimensions: (1) Charismatic/Idealized Influence, (2) Inspirational Motivation, (3) Intellectual Stimulation, (4) Individualized Consideration.',
          'Transactional Leadership: Based on exchange/transaction of rewards and punishments. Uses Contingent Rewards and Management-by-Exception.',
          'Servant Leadership: Prioritizes well-being and growth of subordinates over leader\'s power.',
          'Authentic Leadership: Promotes self-awareness and relational transparency to build trust.',
          'Ethical Leadership: Focuses on justice, honesty, and accountability.',
        ],
        examTip: 'Memorize the four dimensions of Transformational Leadership. Distinguish from Transactional (rewards/punishment).',
      },
      {
        topicTitle: 'Leadership and Followership',
        summary:
          'Followership is the active role individuals play in supporting and influencing leadership. Effective followers are partners, not passive participants, in achieving organizational objectives.',
        keyPoints: [
          'Followership Definition: Active role in supporting, influencing, and challenging leadership to achieve shared objectives.',
          'Kelley\'s 5 Follower Types: (1) Exemplary (active, independent), (2) Conformist (active, unquestioning), (3) Passive (dependent), (4) Alienated (critical but disengaged), (5) Pragmatic (flexible).',
          'Citizenship: Legal membership with rights (voting, free speech, justice access) and responsibilities (taxes, obeying laws, accountability).',
          'Civic Society: Voluntary NGOs, unions, religious bodies representing citizen interests and providing civic education.',
        ],
        examTip: 'Know Kelley\'s 5 follower types. Exemplary followers are the ideal (active and independent thinkers).',
      },
      {
        topicTitle: 'Stakeholder Theory and Public Governance',
        summary:
          'Stakeholder Theory argues organizations should manage interests of all affected groups, not just shareholders. Effective stakeholder engagement enhances policy acceptance and service delivery.',
        keyPoints: [
          'Stakeholder Theory (R. Edward Freeman, 1984): Organizations should identify, respond to, and manage interests of ALL groups affected by decisions.',
          'Stakeholder Engagement: Actively involving stakeholders enhances policy acceptance, improves service delivery, reduces conflict.',
          'Crisis Management: Managing sudden unexpected events threatening organizations. Requires preparedness, quick response, clear communication, recovery strategy.',
          'Benefits: Balanced decision-making, improved legitimacy, sustainable outcomes.',
        ],
        examTip: 'Associate R. Edward Freeman with Stakeholder Theory (1984). Know it emphasizes ALL stakeholders, not just shareholders.',
      },
      {
        topicTitle: 'Governance in Public Services',
        summary:
          'Governance is the system and processes through which authority is exercised and organizations are held accountable. Good governance is built on purpose, people, process, and performance.',
        keyPoints: [
          'Governance Definition: Derived from Greek "Kubernaein" (to steer) - system, structure, and processes for exercising authority and accountability.',
          'Four Ps of Good Governance: Purpose, People, Process, Performance.',
          'Core Elements: Accountability (explaining actions, accepting consequences), Transparency (open decisions, information access), Rule of Law (fair legal frameworks), Equity and Inclusiveness.',
          'Hindrances: Corruption/misuse of power, lack of transparency, political interference.',
        ],
        examTip: 'Memorize the "Four Ps": Purpose, People, Process, Performance. Know core governance principles.',
      },
      {
        topicTitle: 'Public vs. Private Sector Governance',
        summary:
          'Public and private sectors have fundamentally different objectives, decision-making processes, and accountability structures. Understanding these differences is crucial for effective governance.',
        keyPoints: [
          'Public Sector Objectives: Social welfare, economy, efficiency, effectiveness (the "Three Es").',
          'Private Sector Objectives: Maximize shareholder profit and value creation.',
          'Public Decision-Making: Highly bureaucratic with multiple approval levels.',
          'Private Decision-Making: Flexible and market-responsive.',
          'Public Accountability: To government and citizens. Private Accountability: To shareholders.',
          'Agency Theory (Private): Management runs business on behalf of principals (owners).',
        ],
        examTip: 'Know the "Three Es" of public sector: Economy, Efficiency, Effectiveness. Contrast public (social welfare) vs. private (profit).',
      },
      {
        topicTitle: 'Principles of Good Governance',
        summary:
          'Good governance requires transparency, accountability, rule of law, and responsiveness. These principles ensure organizations serve stakeholders effectively and ethically.',
        keyPoints: [
          'Accountability: Leaders must explain actions and accept consequences for decisions.',
          'Transparency: Open decision-making and free access to information breeds trust.',
          'Rule of Law: Fair legal frameworks enforced impartially without favoritism.',
          'Equity and Inclusiveness: All members, especially vulnerable, have opportunities and voice.',
          'Responsiveness: Serving all stakeholders within reasonable timeframe.',
          'Participation: Stakeholders have voice in decision-making directly or through representatives.',
        ],
        examTip: 'Transparency and Accountability are the two most fundamental governance principles - know their definitions.',
      },
      {
        topicTitle: 'Ethics and Moral Leadership',
        summary:
          'Ethical leadership involves making decisions that balance stakeholder interests while maintaining moral integrity. Leaders must reflect, act courageously, and seek truth.',
        keyPoints: [
          'Ethical Decision-Making: Identifying core values, balancing stakeholder preferences, accommodating real-world compromises.',
          'Moral Leadership Qualities: Reflection (thinking deeply), seeing humanity in everyone, acting with courage, seeking truth.',
          'Workplace Ethics: Principles governing appropriate conduct and decision-making in business context.',
          'Challenges: Navigating competing interests, maintaining integrity under pressure, balancing profit and principles.',
        ],
        examTip: 'Ethical leaders balance stakeholder interests while maintaining core moral principles and integrity.',
      },
      {
        topicTitle: 'Management History and Theory',
        summary:
          'Management theory evolved from scientific approaches through human relations to systems thinking. Understanding this evolution provides context for modern management practices.',
        keyPoints: [
          'Scientific Management (F.W. Taylor): Time and motion studies, efficiency focus, published "Principles of Scientific Management" (1911).',
          'Administrative Management (Henri Fayol): 14 principles including scalar chain, esprit de corps, unity of command.',
          'Bureaucracy (Max Weber): Formalized organizational structure with clear hierarchy.',
          'Human Relations (Hawthorne Experiments): Highlighted importance of informal groups and morale.',
          'Systems Theory: Organizations as open systems with inputs, processes, outputs.',
          'Cybernetics (Norbert Weiner): Science of communication and control.',
        ],
        examTip: 'Associate theorists: Taylor = Scientific, Fayol = 14 Principles, Weber = Bureaucracy, Mayo = Hawthorne/Human Relations.',
      },
    ],
  },
  'consumer-behaviour': {
    courseSlug: 'consumer-behaviour',
    courseCode: 'BUA221',
    topics: [
      {
        topicTitle: 'Introduction to Consumer Behaviour',
        summary:
          'Consumer behaviour is the study of how individuals, groups, and organizations select, buy, use, and dispose of goods, services, ideas, or experiences to satisfy needs and wants. It draws from psychology, sociology, and anthropology to understand purchasing decisions.',
        keyPoints: [
          'Consumer vs. Customer: A customer purchases the product; a consumer is the end-user who benefits from it.',
          'Types of Buyers: Impulse (spontaneous, emotional), Informed (research extensively), Brand Loyal (stick to trusted brands), Price Sensitive (hunt for discounts).',
          'Economic Impact: Consumer spending stimulates production, supports GDP, and drives economic growth.',
          'Online vs. Offline: Online shoppers value convenience and range; offline shoppers prefer tactile product experience.',
        ],
        examTip: 'Remember the distinction between customer (purchaser) and consumer (end-user) - they can be different people.',
      },
      {
        topicTitle: 'The 5-Stage Consumer Decision-Making Process',
        summary:
          'Consumers move through five distinct stages when making purchase decisions: recognizing a problem, searching for information, evaluating alternatives, making a purchase decision, and evaluating post-purchase satisfaction.',
        keyPoints: [
          '1. Problem Recognition: Triggered by internal stimuli (hunger) or external stimuli (advertisement).',
          '2. Information Search: Internal (memory/past experiences) or external (reviews, friends, ads).',
          '3. Evaluation of Alternatives: Comparing brands based on attributes, features, benefits, and costs.',
          '4. Purchase Decision: Actual choice of what to buy, which brand, where to buy, and how to pay.',
          '5. Post-Purchase Behaviour: Evaluating satisfaction - critical for loyalty and word-of-mouth.',
        ],
        examTip: 'Memorize the 5 stages in order. Post-purchase evaluation is critical because it drives future loyalty and recommendations.',
      },
      {
        topicTitle: 'Cultural and Social Influences',
        summary:
          'Culture is the broadest and deepest influence on consumer behaviour, dictating fundamental tastes, norms, values, and traditions. Social class and sub-cultures provide additional layers of influence on purchasing decisions.',
        keyPoints: [
          'Culture: Dictates fundamental tastes, norms, values, traditions (food, clothing, holidays).',
          'Sub-Culture: Smaller groups providing specific identification (nationality, religion, racial groups, geographic regions).',
          'Social Class: Division based on wealth, education, status - heavily affects media consumption and product choices.',
          'Social Stratification: Measured by occupation, income, and education.',
        ],
        examTip: 'Culture is the BROADEST influence. Social class is measured using occupation, income, and education.',
      },
      {
        topicTitle: 'Reference Groups and External Influences',
        summary:
          'Reference groups serve as standards for evaluating behavior and purchasing decisions. They exert influence through informational guidance, normative pressure to conform, and value-expressive inspiration.',
        keyPoints: [
          'Reference Groups: Any group used as a standard for evaluating one\'s own behavior.',
          'Aspirational Groups: Groups a person wants to join or emulate (celebrities, sports teams).',
          'Dissociative Groups: Groups a person actively wants to avoid being associated with.',
          'Informational Influence: Seeking explicit expert opinions (doctor, mechanic).',
          'Utilitarian Influence: Buying to fit in, be rewarded, or avoid punishment by peers.',
          'Value-Expressive Influence: Adopting group values to enhance self-image (eco-friendly products).',
        ],
        examTip: 'Know the three types of group influence: Informational (expert advice), Utilitarian (fitting in), Value-Expressive (self-image).',
      },
      {
        topicTitle: 'Individual Psychology: Motivation and Perception',
        summary:
          'Motivation is the driving force behind consumer actions. Maslow\'s Hierarchy explains that humans satisfy basic needs first. Perception involves how consumers select, organize, and interpret information through selective attention, distortion, and retention.',
        keyPoints: [
          'Motivation: The driving force that impels consumers to action.',
          'Maslow\'s Hierarchy: Physiological → Safety → Social → Esteem → Self-Actualization (satisfied in order).',
          'Selective Attention: Consumers screen out most stimuli and notice only relevant information.',
          'Selective Distortion: Consumers twist information to fit existing preconceptions.',
          'Selective Retention: Consumers remember good points about liked products and forget competitors\' advantages.',
        ],
        examTip: 'Maslow\'s hierarchy must be satisfied from bottom to top. The three selective processes are barriers marketers must overcome.',
      },
      {
        topicTitle: 'Learning and Attitudes',
        summary:
          'Consumer learning results from experience and influences future behavior. Classical conditioning associates brands with positive stimuli, while operant conditioning uses rewards. Attitudes consist of cognitive, affective, and conative components.',
        keyPoints: [
          'Classical Conditioning: Learning to associate a brand with positive stimulus (music, imagery).',
          'Instrumental (Operant) Conditioning: Rewarding specific behavior (loyalty points for purchases).',
          'Tri-component Attitude Model: (1) Cognitive (knowledge), (2) Affective (feelings), (3) Conative (action likelihood).',
          'Cognitive Dissonance: Post-purchase tension or regret when expectations aren\'t met.',
          'Attitudes: Enduring favorable or unfavorable evaluations toward objects/brands.',
        ],
        examTip: 'Classical = association, Operant = reward. The conative component predicts likelihood of purchase action.',
      },
      {
        topicTitle: 'Communication and Persuasive Techniques',
        summary:
          'Effective marketing communication requires understanding the five components: sender, message, medium, receiver, and feedback. Credibility is critical - informal sources (friends/family) typically have higher credibility than formal sources (advertisers).',
        keyPoints: [
          'Five Components: Sender (initiator), Message (encoded thought), Medium (channel), Receiver (target audience), Feedback (response).',
          'Credibility: Perceived honesty and objectivity of the source.',
          'Informal Sources: Friends/family have higher credibility (no financial gain perceived).',
          'Formal Sources: Commercial advertisers have lower credibility.',
          'Communication Barriers: Psychological noise (competing messages, distractions) and selective perception.',
        ],
        examTip: 'Remember the 5 components. Informal sources > Formal sources in credibility because of perceived objectivity.',
      },
      {
        topicTitle: 'Promotional Strategy and the AHP Model',
        summary:
          'The Analytic Hierarchy Process (AHP) helps determine optimal promotional mix. For Nigerian insurance companies, advertising and personal selling were found most effective, while sales promotion received minimal investment priority.',
        keyPoints: [
          'AHP Model: Determines best mix of promotional elements based on weighted criteria.',
          'Best for Nigerian Insurance: Advertising (builds brand awareness and trust for intangible services).',
          'Second Most Effective: Personal Selling (direct relationships, builds buyer conviction).',
          'Minimal Investment: Sales Promotion (lowest direct impact on insurance policy sales).',
          'Seven Promotional Tools: Advertising, Personal Selling, Sales Promotion, Public Relations, Publicity, Sponsorship, Direct Marketing.',
        ],
        examTip: 'AHP study: Advertising = best, Personal Selling = second, Sales Promotion = minimal investment.',
      },
      {
        topicTitle: 'Modern Decision-Making and Digital Influences',
        summary:
          'Recent research shows consumer decision-making has shifted from sequential stages to continuous digital exploration. The Stimulus-Organism-Response (SOR) framework explains how external stimuli affect internal states and behavioral outcomes.',
        keyPoints: [
          'Shift to Continuous Exploration: Social media and digital platforms blur traditional decision-making stages.',
          'SOR Framework: External stimuli (web design, social proof) → Internal states (emotions, cognition) → Behavioral outcomes (purchase).',
          'Green Purchasing: Increasing priority due to health consciousness and sustainability concerns.',
          'Choice Architecture: The way choices are presented to influence decision-making (nudging).',
          'Digital Nudging: Subtly guiding consumer behavior in online environments (defaults, framing, badges).',
        ],
        examTip: 'SOR framework: Stimulus → Organism → Response. Digital nudging uses choice architecture to guide behavior.',
      },
      {
        topicTitle: 'Pricing Strategies and Consumer Value Perception',
        summary:
          'Pricing strategies must align with consumer value perceptions. Customer-value-based pricing starts with analyzing consumer needs rather than costs. Competitive advantage mediates the relationship between pricing and performance.',
        keyPoints: [
          'Cost-Based Pricing: Setting prices based on total expenses of providing the product/service.',
          'Competition-Based Pricing: Setting prices based on what competitors charge.',
          'Customer-Value-Based Pricing: Setting prices based on perceived value to the consumer.',
          'Penetration Pricing: Low initial prices to attract large number of buyers quickly.',
          'Skimming Pricing: High initial prices for new, unique products.',
          'Psychological Pricing: Using prices like $9.99 instead of $10.00 to influence perception.',
        ],
        examTip: 'Customer-value-based pricing is most customer-centric - it starts with analyzing consumer needs, not costs.',
      },
    ],
  },
}

export function getTopicNotesByCourseSlug(slug: string): CourseTopicNotes | undefined {
  return topicNotes[slug]
}
