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
          'The framework sets the theoretical foundation for preparing financial statements. It is not an accounting standard itself, but it outlines the concepts, definitions, and criteria that underlie financial reporting to ensure they provide relevant and reliable information.',
        keyPoints: [
          'Fundamental Qualitative Characteristics: Relevance (capable of influencing economic decisions) and Faithful Representation (accurately reflecting real economic phenomena).',
          'Enhancing Qualitative Characteristics: Comparability, Verifiability, Timeliness, and Understandability.',
          'Definition of an Asset: A resource owned and controlled by an entity as a result of past events, from which future economic benefits are expected to flow to the entity.',
        ],
        examTip: 'Know the difference between fundamental and enhancing qualitative characteristics.',
      },
      {
        topicTitle: 'IFRS 15 - Revenue from Contracts with Customers',
        summary:
          'IFRS 15 establishes a single, unified framework for determining when and how much revenue to recognize from customer contracts.',
        keyPoints: [
          'Core Principle: Revenue is recognized when (or as) the entity transfers control of promised goods or services to the customer.',
          'The 5-Step Model: (1) Identify the contract, (2) Identify performance obligations, (3) Determine the transaction price, (4) Allocate the transaction price, (5) Recognize revenue when each obligation is satisfied.',
          'A contract only exists if it is probable the entity will collect the consideration.',
          'Revenue can be recognized at a point in time or over time.',
        ],
        examTip: 'Memorize all 5 steps of the revenue recognition model - this is almost guaranteed to appear in your exam.',
      },
      {
        topicTitle: 'IAS 1 - Presentation of Financial Statements',
        summary:
          'This standard sets out the overall requirements for presenting general-purpose financial statements to ensure comparability both with the entity\'s past periods and with other entities.',
        keyPoints: [
          'A Complete Set of Financial Statements includes 5 components: (1) Statement of financial position, (2) Statement of profit or loss and OCI, (3) Statement of changes in equity, (4) Statement of cash flows, (5) Notes with significant accounting policies.',
          'Current vs. Non-Current: An item is "current" if expected to be realized/settled within the normal operating cycle or within 12 months after the reporting period.',
          'Expense Classification: Expenses can be analyzed by nature (e.g., depreciation, salaries) or by function (e.g., cost of sales, distribution, administration).',
        ],
        examTip: 'Know all 5 components of a complete set of financial statements and the current vs. non-current classification rules.',
      },
      {
        topicTitle: 'IAS 2 - Accounting for Inventory',
        summary:
          'IAS 2 prescribes the accounting treatment for inventories - assets held for sale in the ordinary course of business (finished goods), in the process of production (WIP), or materials consumed in production (raw materials).',
        keyPoints: [
          'Fundamental Valuation Principle: Inventories must always be valued at the lower of cost and net realizable value (NRV).',
          'NRV = Estimated selling price minus estimated costs necessary to make the sale.',
          'Components of Cost: Purchase price (less trade discounts), conversion costs (direct labor, factory overheads), and other costs bringing inventory to its present location.',
          'Strict Exclusions: Abnormal waste, storage costs, administrative overheads, selling costs, and interest must be excluded.',
          'Cost Formulas: FIFO and Weighted Average are permitted. LIFO is strictly prohibited.',
        ],
        examTip: 'Lower of cost and NRV is the most important rule. Also remember: LIFO is NEVER allowed under IAS 2.',
      },
      {
        topicTitle: 'IAS 8 - Accounting Policies, Changes in Estimates and Errors',
        summary:
          'IAS 8 guides how companies should select accounting policies, and how they must account for changes in those policies, changes in accounting estimates, and corrections of past errors.',
        keyPoints: [
          'Changes in Accounting Policy (e.g., switching from cost model to fair value): Only permitted if required by an IFRS or if it provides more reliable info. Applied RETROSPECTIVELY.',
          'Changes in Accounting Estimate (e.g., changing useful life of an asset): Applied PROSPECTIVELY - only affects current and future periods.',
          'Prior Period Errors: Must be corrected retrospectively.',
        ],
        examTip: 'The key distinction: Policy changes = retrospective. Estimate changes = prospective. This is a very common exam question.',
      },
      {
        topicTitle: 'IAS 16 - Property, Plant, and Equipment (PPE)',
        summary:
          'IAS 16 dictates how to account for physical non-current assets (like land, buildings, machinery) that are held for use in production, supply, rental, or administration, and are expected to be used for more than one period.',
        keyPoints: [
          'Initial Measurement: PPE is initially measured at Cost (purchase price + non-refundable taxes + delivery + site preparation + installation + dismantling costs estimate).',
          'Exclusions: General administrative costs, staff training, and regular repairs/maintenance are revenue expenditures and cannot be capitalized.',
          'Depreciation: Systematic allocation of the depreciable amount (Cost minus Scrap Value) over the asset\'s useful life.',
          'Methods: Straight-line (equal charge every year) and Reducing Balance (fixed percentage applied to net book value, giving higher depreciation in early years).',
        ],
        examTip: 'Know how to calculate both Straight-line and Reducing Balance depreciation. Practice the formulas.',
      },
      {
        topicTitle: 'IAS 20 - Government Grants',
        summary:
          'This standard handles accounting for government assistance - a transfer of resources to an entity in return for past or future compliance with operating conditions.',
        keyPoints: [
          'Recognition Rule: A grant cannot be recognized until there is reasonable assurance that the entity will comply with conditions AND the grant will be received.',
          'Grants Related to Assets: Two approaches - (1) Capital approach: Deduct from asset cost, (2) Income approach: Record asset at full cost and treat grant as deferred income, releasing over the asset\'s useful life.',
          'Grants Related to Income: Must be recognized in the income statement to match the related expenses they compensate.',
        ],
        examTip: 'Remember the two approaches for asset-related grants: deduct from cost OR treat as deferred income.',
      },
      {
        topicTitle: 'IAS 23 - Borrowing Costs',
        summary:
          'IAS 23 determines whether borrowing costs (interest, finance charges) should be added to the cost of an asset on the balance sheet or expensed immediately.',
        keyPoints: [
          'Capitalization Rule: Borrowing costs directly attributable to a Qualifying Asset MUST be capitalized (added to the cost of the asset).',
          'Qualifying Asset: An asset that takes a "substantial period of time" to get ready for its intended use or sale (e.g., building a factory).',
          'Expensing Rule: Borrowing costs not related to a qualifying asset, or occurring after the asset is ready, must be expensed in the income statement.',
          'Components: Include interest, amortization of discounts/premiums on debt, ancillary bank charges, and certain foreign exchange differences.',
        ],
        examTip: 'Key question: "Is this a qualifying asset?" If yes = capitalize. If no = expense immediately.',
      },
    ],
  },
}

export function getTopicNotesByCourseSlug(slug: string): CourseTopicNotes | undefined {
  return topicNotes[slug]
}
