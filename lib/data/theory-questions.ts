export interface TheoryQuestion {
  id: number
  question: string
  answer: string
  examTip?: string
}

export interface CalculatorTrick {
  id: number
  title: string
  description: string
  example: string
  formula?: string
}

export interface CourseTheoryContent {
  courseSlug: string
  courseCode: string
  theoryQuestions: TheoryQuestion[]
  calculatorTricks: CalculatorTrick[]
}

export const theoryContent: Record<string, CourseTheoryContent> = {
  'financial-accounting-1': {
    courseSlug: 'financial-accounting-1',
    courseCode: 'ACC201',
    theoryQuestions: [
      {
        id: 1,
        question: 'What are the five components of a complete set of financial statements according to IAS 1?',
        answer: `A complete set of financial statements includes:

1. A statement of financial position as at the end of the period
2. A statement of profit or loss and other comprehensive income for the period
3. A statement of changes in equity for the period
4. A statement of cash flows for the period
5. Notes to the accounts comprising significant accounting policies and other explanatory information`,
        examTip: 'List all five components clearly. Don\'t forget the notes - many students miss this one.',
      },
      {
        id: 2,
        question: 'Define "inventory" according to IAS 2 and list the three main categories.',
        answer: `Inventories are assets held for sale in the ordinary course of business, in the process of production for such sale, or in the form of materials or supplies to be consumed in the production process or rendering of services.

The three main categories are:
1. Raw materials
2. Work in progress
3. Finished goods`,
        examTip: 'Start with the full IAS 2 definition, then list the three categories. This shows comprehensive understanding.',
      },
      {
        id: 3,
        question: 'How is Net Realizable Value (NRV) calculated under IAS 2?',
        answer: `Net Realizable Value (NRV) is calculated as:

NRV = Estimated selling price in the ordinary course of business - Estimated costs necessary to make the sale

The estimated costs to make the sale include marketing costs, advertising costs, and transport/delivery costs to get the product to the customer.`,
        examTip: 'Include the formula AND explain what costs are deducted. Give an example if time permits.',
      },
      {
        id: 4,
        question: 'State the five-step model for revenue recognition under IFRS 15.',
        answer: `The five-step revenue recognition model under IFRS 15 is:

Step 1: Identify the contract with a customer
Step 2: Identify the performance obligations in the contract
Step 3: Determine the transaction price
Step 4: Allocate the transaction price to the performance obligations
Step 5: Recognize revenue when (or as) the entity satisfies a performance obligation

Revenue is recognized when control of the promised goods or services is transferred to the customer.`,
        examTip: 'Number each step clearly. Add the core principle about control transfer to show deeper understanding.',
      },
      {
        id: 5,
        question: 'Explain the difference between a change in accounting policy and a change in accounting estimate under IAS 8.',
        answer: `Under IAS 8:

**Change in Accounting Policy:**
- Example: Switching from the cost model to the fair value model for investment properties
- Treatment: Applied RETROSPECTIVELY
- This means you adjust opening balances and past comparative amounts as if the new policy had always been applied

**Change in Accounting Estimate:**
- Example: Changing an asset's useful life or depreciation method (straight-line to reducing balance)
- Treatment: Applied PROSPECTIVELY
- This means it only affects the current and future periods; past periods are not restated

The key difference is retrospective (restate the past) vs prospective (only affect the future).`,
        examTip: 'Give examples for each and clearly state retrospective vs prospective. This distinction is crucial.',
      },
      {
        id: 6,
        question: 'Under IAS 16, what components make up the initial cost of Property, Plant, and Equipment (PPE)?',
        answer: `The initial cost of PPE under IAS 16 comprises:

1. **Purchase price** - including import duties and non-refundable purchase taxes, less trade discounts and rebates

2. **Directly attributable costs** - any costs directly needed to bring the asset to its working condition and location:
   - Site preparation
   - Initial delivery and handling
   - Installation and assembly
   - Testing costs
   - Professional fees (architects, engineers)

3. **Initial estimate** - of dismantling and removing the item and restoring the site on which it is located

**EXCLUDE:** General administrative costs, staff training costs, and regular repairs/maintenance (these are revenue expenditure).`,
        examTip: 'Structure your answer with three main components. Clearly state what to EXCLUDE to show you understand the boundaries.',
      },
      {
        id: 7,
        question: 'What is the fundamental difference between the Capital Approach and the Income Approach for recognizing government grants related to assets under IAS 20?',
        answer: `Under IAS 20, there are two acceptable methods for grants related to assets:

**Capital Approach (Netting Method):**
- The grant amount is deducted directly from the cost of the non-current asset on the balance sheet
- This reduces the carrying amount of the asset
- Result: Lower annual depreciation charge over the asset's useful life

**Income Approach (Deferred Income Method):**
- The asset is recorded at its full cost (no deduction)
- The grant is treated as Deferred Income (a liability)
- The deferred income is systematically released to the profit or loss statement over the asset's useful life
- Result: Full depreciation charge, but offset by grant income recognized each year

Both methods ultimately have the same effect on net profit, but they present differently in the financial statements.`,
        examTip: 'Clearly label each approach. Explain the balance sheet treatment AND the income statement impact for full marks.',
      },
      {
        id: 8,
        question: 'Define a "Qualifying Asset" in the context of IAS 23 (Borrowing Costs).',
        answer: `Under IAS 23, a Qualifying Asset is:

**Definition:** An asset that necessarily takes a substantial period of time to get ready for its intended use or sale.

**Key characteristics:**
- "Substantial period" typically means months or years of construction/production
- Examples: Large buildings, infrastructure projects (bridges, roads), major production facilities, power generation plants

**Why it matters:**
Borrowing costs (interest, finance charges) directly attributable to the acquisition, construction, or production of a qualifying asset MUST be capitalized as part of the cost of that asset.

For assets that do NOT qualify (e.g., inventory produced routinely, assets ready for use immediately), borrowing costs must be expensed to profit or loss.`,
        examTip: 'Define it, give the key characteristic (substantial period), provide examples, and explain why it matters for capitalization.',
      },
      {
        id: 9,
        question: 'What happens to borrowing costs incurred during an extended period where active construction of a qualifying asset is halted (e.g., due to a strike) under IAS 23?',
        answer: `Under IAS 23:

**Capitalization MUST CEASE** during extended periods in which active development of the qualifying asset is suspended.

**Treatment:**
The borrowing costs (interest) incurred during this idle period must be EXPENSED directly to the statement of profit or loss in the period they are incurred.

**When to resume capitalization:**
Capitalization resumes when active construction or development activities restart.

**Rationale:**
Borrowing costs can only be capitalized when they are directly related to bringing the asset to its intended condition and use. During idle periods (strikes, delays, disputes), the asset is not actively being developed, so the interest cannot be justified as part of the asset cost.

**Exception:**
Brief, temporary delays that are a necessary part of the construction process do not stop capitalization.`,
        examTip: 'State that capitalization STOPS, expense the interest, and explain the logic. Mention the exception about brief delays if time allows.',
      },
      {
        id: 10,
        question: 'Explain the "Imprest System" in relation to a Petty Cashbook.',
        answer: `The Imprest System is a method of managing petty cash:

**How it works:**
1. The petty cashier is given a fixed amount of cash at the beginning of a period (e.g., ₦10,000) - this is called the "float" or "imprest amount"

2. Throughout the period, the petty cashier makes small payments and records them in the petty cashbook

3. At the end of the period (or when the cash runs low), the petty cashier presents receipts and the petty cashbook to the main cashier

4. The main cashier reimburses EXACTLY the amount that was spent (e.g., if ₦7,500 was spent, the petty cashier receives ₦7,500)

5. This restores the petty cash balance back to the original fixed float amount (₦10,000)

**Advantages:**
- Provides internal control
- Easy to identify shortages or overages
- Limits the amount of cash exposure
- Simple reconciliation`,
        examTip: 'Explain the cycle step-by-step with an example amount. State that the float is RESTORED to the fixed amount - this is the key feature.',
      },
      {
        id: 11,
        question: 'Differentiate between Capital Expenditure and Revenue Expenditure.',
        answer: `**Capital Expenditure:**
- Money spent to acquire, upgrade, or prepare NON-CURRENT ASSETS for use
- Provides benefits for MORE THAN ONE YEAR
- Appears on the Statement of Financial Position (Balance Sheet) as an asset
- Examples:
  • Buying a delivery van
  • Installing a new machine
  • Legal costs to acquire a building
  • Major extension to a factory

**Revenue Expenditure:**
- Money spent on the day-to-day running of the business
- Benefits are consumed within ONE ACCOUNTING YEAR
- Charged to the Statement of Profit or Loss (Income Statement) as an expense
- Examples:
  • Fuel for the delivery van
  • Routine repairs and maintenance
  • Salaries and wages
  • Electricity and rent

**Why it matters:**
Incorrect classification distorts profit and asset values. Capitalizing revenue expenses overstates assets and profit. Expensing capital costs understates assets and profit.`,
        examTip: 'Use a clear structure: define each, state the time period (more than one year vs one year), give examples, and explain the impact of wrong classification.',
      },
      {
        id: 12,
        question: 'What is an Error of Principle? Give an example.',
        answer: `**Error of Principle:**
An Error of Principle occurs when a transaction is entered into the wrong CLASS or TYPE of account, thereby breaking fundamental accounting rules.

**Key characteristic:**
The wrong type of account is used - for example, treating an asset as an expense, or vice versa.

**Example:**
A business purchases a motor vehicle (a non-current asset) for ₦2,000,000, but the accountant incorrectly debits the Motor Expenses Account (an expense account) instead of the Motor Vehicles Account (an asset account).

**Correct entry should be:**
Dr Motor Vehicles Account ₦2,000,000
Cr Bank/Cash Account ₦2,000,000

**Incorrect entry made:**
Dr Motor Expenses Account ₦2,000,000
Cr Bank/Cash Account ₦2,000,000

**Impact:**
- Assets are understated
- Expenses are overstated
- Profit is understated
- This error is NOT revealed by the trial balance (both debit and credit totals still match)`,
        examTip: 'Define it, emphasize "wrong CLASS of account," give a clear example with journal entries, and state that trial balance won\'t catch it.',
      },
      {
        id: 13,
        question: 'List three reasons why a cash book balance might not agree with a bank statement balance.',
        answer: `Three common reasons for differences between the cash book and bank statement:

**1. Unpresented Cheques (Outstanding Cheques):**
- Cheques that have been drawn (written) by the business and recorded in the cash book
- But have NOT YET been presented to the bank for payment by the recipient
- The cash book shows a lower balance, but the bank statement still shows a higher balance

**2. Uncredited Cheques (Deposits in Transit):**
- Cheques or cash that have been paid into the bank by the business
- Recorded in the cash book as a receipt
- But NOT YET cleared or credited by the bank
- The cash book shows a higher balance, but the bank statement shows a lower balance

**3. Bank Charges, Interest, or Direct Debits:**
- Items that appear on the bank statement but have NOT YET been recorded in the cash book
- Examples: bank charges, standing orders, direct debits, interest earned
- These need to be added to or deducted from the cash book during reconciliation

**Additional reasons:** Dishonored cheques, bank errors, timing differences.`,
        examTip: 'List and explain three clearly. State the direction of the difference (cashbook higher/lower). Mention one or two additional reasons if time allows.',
      },
      {
        id: 14,
        question: 'Define "Prime Cost" in a manufacturing account.',
        answer: `**Prime Cost** is the aggregate of ALL DIRECT COSTS involved in manufacturing a product.

**Formula:**
Prime Cost = Direct Materials + Direct Labour + Direct Expenses

**Components:**

1. **Direct Materials:** Raw materials that can be directly traced to the finished product (e.g., wood for furniture, fabric for clothing)

2. **Direct Labour:** Wages of workers directly involved in production (e.g., machine operators, assembly line workers)

3. **Direct Expenses:** Other costs directly attributable to production (e.g., royalties paid per unit, hire of special equipment for a specific job)

**What Prime Cost excludes:**
- Factory overheads (indirect costs like factory rent, supervisor salaries, depreciation of machinery)
- Administrative overheads
- Selling and distribution costs

**Why it matters:**
Prime Cost is the foundation of product costing. It represents the minimum cost to produce a unit before adding factory overheads.`,
        examTip: 'State the formula clearly, break down each component with examples, and explain what it EXCLUDES.',
      },
      {
        id: 15,
        question: 'What is the fundamental difference between Marginal Costing and Absorption Costing?',
        answer: `The fundamental difference lies in how FIXED PRODUCTION OVERHEADS are treated:

**Marginal Costing:**
- Only VARIABLE costs (direct materials, direct labour, variable overheads) are included in the product cost
- Fixed production overheads are treated as PERIOD COSTS
- Fixed costs are written off in full to the Profit or Loss Statement in the period they are incurred
- Product valuation: Direct Materials + Direct Labour + Variable Overheads

**Absorption Costing:**
- Both variable costs AND fixed production overheads are included in the product cost
- Fixed production overheads are ABSORBED into the cost of each unit produced
- Fixed costs are "carried forward" in inventory valuation
- Product valuation: Direct Materials + Direct Labour + Variable Overheads + Fixed Overheads

**Impact on profit:**
- When production exceeds sales: Absorption costing shows HIGHER profit (some fixed costs remain in closing inventory)
- When sales exceed production: Marginal costing shows HIGHER profit
- When production equals sales: Both methods show the SAME profit`,
        examTip: 'Clearly contrast the two approaches, emphasize the treatment of fixed overheads, and explain the profit impact under different scenarios.',
      },
      {
        id: 16,
        question: 'Provide the formulas for calculating the Re-order Level and the Maximum Stock Level.',
        answer: `**Re-order Level Formula:**
Re-order Level = Maximum Usage per period × Maximum Lead Time

**Explanation:**
- This is the inventory level at which a new order should be placed
- Uses maximum values to ensure stock doesn't run out in worst-case scenario

**Example:** If maximum usage is 500 units/day and maximum lead time is 10 days:
Re-order Level = 500 × 10 = 5,000 units


**Maximum Stock Level Formula:**
Maximum Stock Level = Re-order Level + Economic Order Quantity (EOQ) - (Minimum Usage × Minimum Lead Time)

**Explanation:**
- This is the highest inventory level the business should hold
- Prevents overstocking and excessive holding costs

**Example:** If Re-order Level is 5,000, EOQ is 2,000, minimum usage is 300 units/day, and minimum lead time is 5 days:
Maximum Stock Level = 5,000 + 2,000 - (300 × 5) = 5,500 units`,
        examTip: 'Write both formulas clearly, explain what each represents, and provide a worked example for each.',
      },
      {
        id: 17,
        question: 'Explain "Break-Even Point" and provide its formula in units.',
        answer: `**Break-Even Point (BEP):**
The break-even point is the level of activity or sales at which TOTAL REVENUE exactly equals TOTAL COSTS, resulting in ZERO PROFIT and ZERO LOSS.

**Formula (in units):**
Break-Even Point (units) = Total Fixed Costs ÷ Contribution per Unit

Where:
Contribution per Unit = Selling Price per Unit - Variable Cost per Unit

**Example:**
- Fixed Costs = ₦600,000
- Selling Price per unit = ₦1,500
- Variable Cost per unit = ₦900
- Contribution per unit = ₦1,500 - ₦900 = ₦600

Break-Even Point = ₦600,000 ÷ ₦600 = 1,000 units

**Interpretation:**
The business must sell 1,000 units to cover all costs. Sales below 1,000 units result in a loss; sales above 1,000 units generate profit.

**Formula (in sales value):**
Break-Even Point (₦) = Total Fixed Costs ÷ Contribution-to-Sales Ratio`,
        examTip: 'Define BEP (zero profit, zero loss), write the formula, show a worked example, and interpret the result.',
      },
      {
        id: 18,
        question: 'What is the "Margin of Safety"?',
        answer: `**Margin of Safety:**
The Margin of Safety is the difference between the EXPECTED (or BUDGETED) SALES and the BREAK-EVEN SALES.

**Formula:**
Margin of Safety = Budgeted Sales - Break-Even Sales

Or expressed as a percentage:
Margin of Safety (%) = (Margin of Safety ÷ Budgeted Sales) × 100

**What it measures:**
- How much sales can FALL before the business starts making a loss
- It's a measure of risk and cushion against adverse conditions

**Example:**
- Budgeted Sales = 2,000 units
- Break-Even Sales = 1,000 units
- Margin of Safety = 2,000 - 1,000 = 1,000 units

**Interpretation:**
Sales can drop by 1,000 units (or 50%) before the business incurs a loss.

**Higher margin = lower risk** (more cushion)
**Lower margin = higher risk** (operating close to break-even)`,
        examTip: 'Define it, give the formula, provide an example with interpretation, and explain what a high vs low margin means for business risk.',
      },
      {
        id: 19,
        question: 'Describe the First-In, First-Out (FIFO) method of inventory valuation.',
        answer: `**FIFO (First-In, First-Out) Method:**

**Principle:**
FIFO assumes that the FIRST batches of materials received into the store are the FIRST ones to be issued to production or sold.

**How it works:**
- Inventory is issued at the cost of the oldest batches first
- Ending inventory is valued at the prices of the MOST RECENT purchases

**Example:**
Opening Stock: 100 units @ ₦10 = ₦1,000
Purchase 1: 200 units @ ₦12 = ₦2,400
Purchase 2: 150 units @ ₦15 = ₦2,250

Issue: 250 units

Under FIFO:
- Issue 100 units @ ₦10 = ₦1,000 (from opening stock)
- Issue 150 units @ ₦12 = ₦1,800 (from Purchase 1)
- Total cost of issue = ₦2,800

Closing Stock:
- 50 units @ ₦12 = ₦600 (remaining from Purchase 1)
- 150 units @ ₦15 = ₦2,250 (all of Purchase 2)
- Total closing stock value = ₦2,850

**Impact:**
- In times of rising prices: Lower cost of sales, higher profit, higher closing stock value
- Closing stock approximates current market value`,
        examTip: 'Explain the principle, work through a numerical example step-by-step, and state the impact on profit in rising price scenarios.',
      },
      {
        id: 20,
        question: 'What is "Labour Turnover" and how is the Separation Rate measured?',
        answer: `**Labour Turnover:**
Labour Turnover refers to the rate at which employees LEAVE and ENTER an organization over a specific period.

**Types of Labour Turnover:**
1. Separation Rate (Leavers)
2. Replacement Rate
3. Accession Rate (Joiners)

**Separation Rate Formula:**
Separation Rate (%) = (Number of Separations during the period ÷ Average Number of Employees during the period) × 100

**Example:**
- Number of employees who left during the year = 30
- Average number of employees = 200

Separation Rate = (30 ÷ 200) × 100 = 15%

**Interpretation:**
15% of the workforce left during the year.

**Why it matters:**
- High turnover increases costs (recruitment, training, lost productivity)
- Low turnover may indicate good working conditions
- Very low turnover might suggest lack of career progression opportunities

**Costs of Labour Turnover:**
- Preventative costs (better conditions, higher pay to retain staff)
- Replacement costs (recruitment, selection, training)
- Lost productivity and efficiency`,
        examTip: 'Define it, write the formula clearly, provide a worked example, and explain why high turnover is costly for businesses.',
      },
    ],
    calculatorTricks: [
      {
        id: 1,
        title: 'Price Allocation (IFRS 15 Bundled Sales)',
        description: 'When allocating transaction prices to multiple performance obligations, use the percentage method to avoid rounding errors.',
        formula: 'Allocated Price = (Standalone Price ÷ Total Standalone Prices) × Transaction Price',
        example: `Bundle sells for ₦700,000. Individual items worth ₦500,000 and ₦300,000 (total ₦800,000).

Quick method:
1. Calculate: 500 ÷ 800 = 0.625 (leave in calculator)
2. Multiply: 0.625 × 700 = 437.5k for Item 1
3. Calculate: 300 ÷ 800 = 0.375
4. Multiply: 0.375 × 700 = 262.5k for Item 2

Result: Item 1 = ₦437,500, Item 2 = ₦262,500 (Total = ₦700k ✓)`,
      },
      {
        id: 2,
        title: 'Net Realizable Value (NRV) Calculation',
        description: 'Always calculate NRV first, then compare with cost. Pick the LOWER value.',
        formula: 'NRV = Estimated Sales Value - Estimated Costs to Sell',
        example: `Cost: ₦100,000
Sales Value: ₦220,000
Selling costs: Advertisement ₦10,000 + Transport ₦50,000 + Rent ₦44,000 = ₦104,000

Step 1: NRV = 220,000 - 104,000 = ₦116,000
Step 2: Compare: Cost (100k) vs NRV (116k)
Step 3: Pick LOWER = ₦100,000 ✓

Inventory recorded at ₦100,000`,
      },
      {
        id: 3,
        title: 'Reducing Balance Depreciation Rate',
        description: 'Use the nth root function on your calculator to find the depreciation rate.',
        formula: 'Rate = 1 - ⁿ√(Scrap Value ÷ Cost)',
        example: `Asset: ₦500,000, Scrap: ₦163,840, Life: 5 years

Calculator steps:
1. Type: 163840 ÷ 500000 = 0.32768
2. Find 5th root: 0.32768 ^ (1 ÷ 5) = 0.8
3. Subtract from 1: 1 - 0.8 = 0.2
4. Convert to %: 0.2 × 100 = 20%

Depreciation rate = 20% per year`,
      },
      {
        id: 4,
        title: 'Straight-Line Depreciation',
        description: 'Quick method for consistent annual depreciation.',
        formula: 'Annual Depreciation = (Cost - Scrap Value) ÷ Useful Life',
        example: `Machine: ₦150,000, Scrap: ₦30,000, Life: 4 years

Quick calculation:
(150,000 - 30,000) ÷ 4 = 120,000 ÷ 4 = ₦30,000 per year

Year 1: ₦30,000
Year 2: ₦30,000
Year 3: ₦30,000
Year 4: ₦30,000`,
      },
      {
        id: 5,
        title: 'Weighted Average Interest Rate (IAS 23)',
        description: 'For general borrowings, calculate one unified rate instead of tracking each loan separately.',
        formula: 'Capitalization Rate = (Total Interest on All Loans ÷ Total Principal) × 100',
        example: `Loan 1: ₦50m @ 3% = ₦1.5m interest
Loan 2: ₦20m @ 6% = ₦1.2m interest

Step 1: Total interest = 1.5m + 1.2m = ₦2.7m
Step 2: Total principal = 50m + 20m = ₦70m
Step 3: Rate = (2.7 ÷ 70) × 100 = 3.857%

Use 3.857% on all construction expenditures`,
      },
      {
        id: 6,
        title: 'Break-Even Point Calculation',
        description: 'Quick two-step method for finding break-even units.',
        formula: 'BEP (units) = Fixed Costs ÷ Contribution per Unit',
        example: `Fixed Costs: ₦600,000
Selling Price: ₦1,500
Variable Cost: ₦900

Step 1: Contribution = 1,500 - 900 = ₦600
Step 2: BEP = 600,000 ÷ 600 = 1,000 units

Must sell 1,000 units to break even`,
      },
      {
        id: 7,
        title: 'Margin of Safety Quick Check',
        description: 'Calculate how much cushion you have above break-even.',
        formula: 'Margin of Safety = Budgeted Sales - Break-Even Sales',
        example: `Budgeted Sales: 2,000 units
Break-Even: 1,000 units

Margin of Safety = 2,000 - 1,000 = 1,000 units

As %: (1,000 ÷ 2,000) × 100 = 50%

Sales can drop by 50% before making a loss`,
      },
      {
        id: 8,
        title: 'Government Grant - Capital Approach',
        description: 'When deducting grant from asset cost, calculate new depreciable amount.',
        formula: 'Depreciable Amount = (Cost - Grant) - Scrap Value',
        example: `Machine: ₦100m, Grant: ₦10m, Scrap: ₦0, Life: 10 years

Capital Approach:
Net Cost = 100m - 10m = ₦90m
Annual Depreciation = 90m ÷ 10 = ₦9m per year

(Compare to ₦10m without grant)`,
      },
      {
        id: 9,
        title: 'Borrowing Cost Capitalization',
        description: 'Only capitalize interest during ACTIVE construction months.',
        formula: 'Capitalized Interest = Loan Amount × Rate × (Active Months ÷ 12)',
        example: `Loan: ₦50m @ 12% per year
Construction: Jan-Aug (8 active months)
Strike: Sep-Dec (4 idle months)

Capitalize: 50m × 0.12 × (8 ÷ 12) = ₦4m
Expense: 50m × 0.12 × (4 ÷ 12) = ₦2m

Total interest: ₦6m (split ₦4m asset, ₦2m expense)`,
      },
      {
        id: 10,
        title: 'Inventory Valuation - Lower of Cost and NRV',
        description: 'Always do the comparison before recording.',
        formula: 'Inventory Value = LOWER of (Cost, NRV)',
        example: `Item A: Cost ₦50k, NRV ₦45k → Record ₦45k
Item B: Cost ₦30k, NRV ₦35k → Record ₦30k
Item C: Cost ₦80k, NRV ₦80k → Record ₦80k

Total Inventory = 45k + 30k + 80k = ₦155k

Write-down loss = (50-45) = ₦5k (expense)`,
      },
    ],
  },
}

export function getTheoryContentBySlug(slug: string): CourseTheoryContent | undefined {
  return theoryContent[slug]
}
