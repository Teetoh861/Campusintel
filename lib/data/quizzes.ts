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
  sections: string[]
  questions: QuizQuestion[]
}

export const quizzes: Record<string, CourseQuiz> = {
  'financial-accounting-1': {
    courseSlug: 'financial-accounting-1',
    courseCode: 'ACC201',
    title: 'Financial Accounting I - CBT Assessment',
    totalQuestions: 50,
    sections: [
      'Accounting Foundations & Framework',
      'IAS 1 - Presentation of Financial Statements',
      'IAS 2 - Inventories',
      'IAS 8 - Policies, Estimates, and Errors',
      'IAS 20 & IAS 23 - Grants and Borrowing Costs',
      'IFRS 15 - Revenue from Contracts with Customers',
    ],
    questions: [
      // Section 1: Accounting Foundations & Framework
      {
        id: 1,
        section: 'Accounting Foundations & Framework',
        question: 'Which historical figure is credited with the first published description of the double-entry bookkeeping system in 1494?',
        options: ['Leonardo da Vinci', 'Luca Pacioli', 'Adam Smith', 'Benedetto Cotrugli'],
        correctAnswer: 1,
      },
      {
        id: 2,
        section: 'Accounting Foundations & Framework',
        question: 'According to the conceptual framework, what are the two primary fundamental qualitative characteristics of financial information?',
        options: ['Comparability and Verifiability', 'Timeliness and Understandability', 'Relevance and Faithful Representation', 'Materiality and Prudence'],
        correctAnswer: 2,
      },
      {
        id: 3,
        section: 'Accounting Foundations & Framework',
        question: 'The "Going Concern" concept assumes that:',
        options: ['The business will be liquidated in the near future.', 'The business will continue operations for the foreseeable future.', 'The owner and the business are the same legal entity.', 'Revenue is recognized only when cash is received.'],
        correctAnswer: 1,
      },
      {
        id: 4,
        section: 'Accounting Foundations & Framework',
        question: 'Which branch of accounting is primarily focused on providing information for internal planning and control?',
        options: ['Financial Accounting', 'Auditing', 'Management Accounting', 'Tax Accounting'],
        correctAnswer: 2,
      },
      {
        id: 5,
        section: 'Accounting Foundations & Framework',
        question: 'Under the Accrual Basis of accounting, when is revenue recognized?',
        options: ['When cash is deposited in the bank.', 'When the invoice is printed.', 'When it is earned, regardless of cash timing.', 'At the end of the fiscal year.'],
        correctAnswer: 2,
      },
      {
        id: 6,
        section: 'Accounting Foundations & Framework',
        question: 'The accounting equation is correctly expressed as:',
        options: ['Assets = Liabilities - Equity', 'Assets + Liabilities = Equity', 'Assets = Liabilities + Equity', 'Equity = Assets + Liabilities'],
        correctAnswer: 2,
      },
      {
        id: 7,
        section: 'Accounting Foundations & Framework',
        question: 'Which of the following is classified as "Capital Expenditure"?',
        options: ['Monthly electricity bill payment', 'Purchase of a delivery van for business use', 'Staff salary payments', 'Annual insurance premiums'],
        correctAnswer: 1,
      },
      {
        id: 8,
        section: 'Accounting Foundations & Framework',
        question: 'What is the primary function of the "Journal" or "Prime Books of Entry"?',
        options: ['To summarize the final profit and loss.', 'To list all assets owned by the firm.', 'To record transactions chronologically before posting to ledgers.', 'To reconcile the bank statement.'],
        correctAnswer: 2,
      },
      {
        id: 9,
        section: 'Accounting Foundations & Framework',
        question: 'A "Contra Entry" in a three-column cash book involves:',
        options: ['A transaction between the business and a debtor.', 'The transfer of funds between the Cash account and the Bank account.', 'A discount allowed to a customer.', 'The correction of a prior period error.'],
        correctAnswer: 1,
      },
      {
        id: 10,
        section: 'Accounting Foundations & Framework',
        question: 'In an Imprest System of petty cash, the "Imprest Amount" refers to:',
        options: ['The total expenses incurred in a month.', 'The floating balance or fixed amount replenished at the start of a period.', 'The amount of cash stolen or lost.', 'The interest earned on petty cash.'],
        correctAnswer: 1,
      },

      // Section 2: IAS 1
      {
        id: 11,
        section: 'IAS 1 - Presentation of Financial Statements',
        question: 'IAS 1 requires a complete set of financial statements to include all the following EXCEPT:',
        options: ['Statement of Financial Position', 'Statement of Changes in Equity', 'A Board of Directors\' Biography', 'Notes comprising a summary of significant accounting policies'],
        correctAnswer: 2,
      },
      {
        id: 12,
        section: 'IAS 1 - Presentation of Financial Statements',
        question: 'Under IAS 1, the "Balance Sheet" is formally referred to as the:',
        options: ['Statement of Assets and Liabilities', 'Statement of Financial Position', 'Statement of Wealth Distribution', 'Ledger Summary Report'],
        correctAnswer: 1,
      },
      {
        id: 13,
        section: 'IAS 1 - Presentation of Financial Statements',
        question: 'An asset is classified as "Current" if it is expected to be realized within:',
        options: ['Five years', 'The entity\'s normal operating cycle or 12 months', 'Six months only', 'The lifetime of the business'],
        correctAnswer: 1,
      },
      {
        id: 14,
        section: 'IAS 1 - Presentation of Financial Statements',
        question: 'In the Statement of Profit or Loss, IAS 1 allows expenses to be classified by:',
        options: ['Nature or Function', 'Size or Color', 'Owner\'s preference only', 'Geographical location'],
        correctAnswer: 0,
      },
      {
        id: 15,
        section: 'IAS 1 - Presentation of Financial Statements',
        question: 'Which of the following is a "Current Liability"?',
        options: ['10-year Bank Loan', 'Share Capital', 'Trade Payables', 'Revaluation Reserve'],
        correctAnswer: 2,
      },

      // Section 3: IAS 2
      {
        id: 16,
        section: 'IAS 2 - Inventories',
        question: 'IAS 2 defines inventories as assets held for sale in the ordinary course of business, or:',
        options: ['Assets held for long-term investment.', 'In the process of production for such sale.', 'Intellectual property and patents.', 'Cash held in foreign currencies.'],
        correctAnswer: 1,
      },
      {
        id: 17,
        section: 'IAS 2 - Inventories',
        question: 'What is the fundamental measurement principle for inventories?',
        options: ['Lower of Cost and Fair Value', 'Higher of Cost and Net Realizable Value', 'Lower of Cost and Net Realizable Value', 'Replacement Cost'],
        correctAnswer: 2,
      },
      {
        id: 18,
        section: 'IAS 2 - Inventories',
        question: 'Net Realizable Value (NRV) is calculated as:',
        options: ['Estimated selling price minus estimated costs of completion and sale.', 'Original purchase price plus inflation.', 'Selling price plus transportation costs.', 'The value of the inventory if sold at an auction today.'],
        correctAnswer: 0,
      },
      {
        id: 19,
        section: 'IAS 2 - Inventories',
        question: 'Which of the following costs must be EXCLUDED from the cost of inventory?',
        options: ['Costs of purchase', 'Abnormal amounts of wasted materials', 'Costs of conversion', 'Import duties'],
        correctAnswer: 1,
      },
      {
        id: 20,
        section: 'IAS 2 - Inventories',
        question: 'Which inventory valuation method is explicitly PROHIBITED by IAS 2?',
        options: ['First-In, First-Out (FIFO)', 'Weighted Average Cost (WAC)', 'Last-In, First-Out (LIFO)', 'Specific Identification'],
        correctAnswer: 2,
      },
      {
        id: 21,
        section: 'IAS 2 - Inventories',
        question: 'When inventories are sold, their carrying amount shall be recognized as an expense in the period in which:',
        options: ['The cash is received.', 'The related revenue is recognized.', 'The inventory was purchased.', 'The inventory was manufactured.'],
        correctAnswer: 1,
      },
      {
        id: 22,
        section: 'IAS 2 - Inventories',
        question: 'Storage costs are generally excluded from inventory cost UNLESS:',
        options: ['They are necessary in the production process before a further stage.', 'The warehouse is owned by the company.', 'The storage period exceeds one year.', 'They are incurred after the goods are ready for sale.'],
        correctAnswer: 0,
      },
      {
        id: 23,
        section: 'IAS 2 - Inventories',
        question: 'Which of the following is a disclosure requirement for IAS 2?',
        options: ['The names of the suppliers.', 'The accounting policies adopted, including the cost formula used.', 'The specific location of every warehouse.', 'The profit margin on each individual item.'],
        correctAnswer: 1,
      },
      {
        id: 24,
        section: 'IAS 2 - Inventories',
        question: 'If the cost of an item is $1,000 and the NRV is $800, the inventory should be valued at:',
        options: ['$1,000', '$1,800', '$900', '$800'],
        correctAnswer: 3,
      },
      {
        id: 25,
        section: 'IAS 2 - Inventories',
        question: 'Trade discounts and rebates should be:',
        options: ['Ignored in cost calculation.', 'Added to the cost of inventory.', 'Deducted in determining the costs of purchase.', 'Recognized as "Other Income."'],
        correctAnswer: 2,
      },

      // Section 4: IAS 8
      {
        id: 26,
        section: 'IAS 8 - Policies, Estimates, and Errors',
        question: 'What is the primary objective of IAS 8?',
        options: ['To dictate how to calculate depreciation.', 'To enhance the relevance and reliability of financial statements.', 'To provide a list of all acceptable tax deductions.', 'To regulate the issuance of new shares.'],
        correctAnswer: 1,
      },
      {
        id: 27,
        section: 'IAS 8 - Policies, Estimates, and Errors',
        question: 'A change in "Accounting Policy" is generally applied:',
        options: ['Prospectively', 'Retrospectively', 'Only to future transactions', 'Never; policies cannot be changed'],
        correctAnswer: 1,
      },
      {
        id: 28,
        section: 'IAS 8 - Policies, Estimates, and Errors',
        question: 'Which of the following is an example of a change in "Accounting Estimate"?',
        options: ['Changing from FIFO to Weighted Average for inventory.', 'Changing the useful life of a machine from 5 years to 8 years.', 'Changing from the Cost Model to the Revaluation Model for property.', 'Adopting a new IFRS standard for the first time.'],
        correctAnswer: 1,
      },
      {
        id: 29,
        section: 'IAS 8 - Policies, Estimates, and Errors',
        question: 'Changes in accounting estimates are recognized:',
        options: ['By restating prior year figures.', 'Prospectively in the period of change and future periods.', 'Directly in the Revaluation Reserve.', 'As an extraordinary item in the income statement.'],
        correctAnswer: 1,
      },
      {
        id: 30,
        section: 'IAS 8 - Policies, Estimates, and Errors',
        question: 'Prior period errors are corrected:',
        options: ['By restating the comparative amounts for the prior period(s) presented.', 'By ignoring them if they are small.', 'In the current year\'s profit or loss only.', 'By informing the tax authorities only.'],
        correctAnswer: 0,
      },

      // Section 5: IAS 20 & IAS 23
      {
        id: 31,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'IAS 20 deals with:',
        options: ['Income Taxes', 'Accounting for Government Grants and Disclosure of Government Assistance', 'Employee Benefits', 'Leases'],
        correctAnswer: 1,
      },
      {
        id: 32,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'A government grant should be recognized only when there is reasonable assurance that:',
        options: ['The government has the budget to pay.', 'The entity will comply with the conditions and the grant will be received.', 'The entity will make a profit this year.', 'The grant is larger than $10,000.'],
        correctAnswer: 1,
      },
      {
        id: 33,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'Grants related to depreciable assets are usually recognized in profit or loss:',
        options: ['Immediately upon receipt.', 'Over the periods and in the proportions in which depreciation expense is recognized.', 'As a direct credit to Share Capital.', 'Only when the asset is sold.'],
        correctAnswer: 1,
      },
      {
        id: 34,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'Which of the following is NOT a "Government Grant" under IAS 20?',
        options: ['Forgivable loans from the government.', 'Direct subsidies to purchase equipment.', 'General infrastructure improvements in an area (e.g., roads).', 'Transfer of land to a company at no cost.'],
        correctAnswer: 2,
      },
      {
        id: 35,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'The repayment of a government grant should be treated as:',
        options: ['A change in accounting estimate.', 'A prior period error.', 'A change in accounting policy.', 'A gift to the government.'],
        correctAnswer: 0,
      },
      {
        id: 36,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'IAS 23 requires that borrowing costs directly attributable to a "qualifying asset" must be:',
        options: ['Expensed immediately.', 'Capitalized as part of the cost of that asset.', 'Ignored.', 'Charged to the owner\'s equity.'],
        correctAnswer: 1,
      },
      {
        id: 37,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'A "Qualifying Asset" is an asset that:',
        options: ['Necessarily takes a substantial period of time to get ready for its intended use or sale.', 'Is purchased and ready for use immediately.', 'Is held for less than three months.', 'Is used for administrative purposes only.'],
        correctAnswer: 0,
      },
      {
        id: 38,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'Which of the following would NOT be a qualifying asset?',
        options: ['A power generation facility.', 'Inventories that are manufactured in large quantities on a repetitive basis.', 'Investment properties.', 'A customized manufacturing plant.'],
        correctAnswer: 1,
      },
      {
        id: 39,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'Capitalization of borrowing costs should CEASE when:',
        options: ['The loan is fully repaid.', 'Substantially all the activities necessary to prepare the qualifying asset for its intended use or sale are complete.', 'The company runs out of cash.', 'The asset begins to generate its first dollar of revenue.'],
        correctAnswer: 1,
      },
      {
        id: 40,
        section: 'IAS 20 & IAS 23 - Grants and Borrowing Costs',
        question: 'Borrowing costs include:',
        options: ['Dividend payments to shareholders.', 'Interest expense calculated using the effective interest method.', 'The principal amount of the loan.', 'The salary of the Finance Director.'],
        correctAnswer: 1,
      },

      // Section 6: IFRS 15
      {
        id: 41,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'What is the core principle of IFRS 15?',
        options: ['Recognize revenue when cash is received.', 'Recognize revenue to depict the transfer of promised goods or services to customers.', 'Recognize revenue as early as possible to increase profit.', 'Recognize revenue only at the end of the contract.'],
        correctAnswer: 1,
      },
      {
        id: 42,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'How many steps are in the IFRS 15 revenue recognition model?',
        options: ['Three', 'Four', 'Five', 'Seven'],
        correctAnswer: 2,
      },
      {
        id: 43,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'The first step in the IFRS 15 model is:',
        options: ['Identify the performance obligations.', 'Determine the transaction price.', 'Identify the contract(s) with a customer.', 'Recognize revenue.'],
        correctAnswer: 2,
      },
      {
        id: 44,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'A "Performance Obligation" is:',
        options: ['A legal requirement to pay taxes.', 'A promise in a contract to transfer a distinct good or service.', 'The customer\'s obligation to pay the entity.', 'A bonus paid to employees for high sales.'],
        correctAnswer: 1,
      },
      {
        id: 45,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'Which of the following is NOT a criteria for a contract to exist under IFRS 15?',
        options: ['The parties have approved the contract.', 'Payment terms can be identified.', 'The contract has commercial substance.', 'The contract must be written and signed by a notary.'],
        correctAnswer: 3,
      },
      {
        id: 46,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'What is the "Transaction Price"?',
        options: ['The list price on the company\'s website.', 'The amount of consideration an entity expects to be entitled to in exchange for transferring goods/services.', 'The fair market value of the goods.', 'The cost of producing the goods plus 10%.'],
        correctAnswer: 1,
      },
      {
        id: 47,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'Revenue is recognized when (or as) the entity satisfies a performance obligation by:',
        options: ['Sending an invoice.', 'Transferring control of a promised good or service to a customer.', 'Receiving a deposit.', 'Signing the contract.'],
        correctAnswer: 1,
      },
      {
        id: 48,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'If a contract contains multiple performance obligations, the transaction price is allocated based on:',
        options: ['Equal distribution.', 'Relative stand-alone selling prices.', 'Management\'s discretion.', 'The order in which they are completed.'],
        correctAnswer: 1,
      },
      {
        id: 49,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: '"Control" of an asset refers to:',
        options: ['The ability to direct the use of and obtain substantially all remaining benefits from the asset.', 'Having physical possession only.', 'Having legal title only.', 'Paying the full price.'],
        correctAnswer: 0,
      },
      {
        id: 50,
        section: 'IFRS 15 - Revenue from Contracts with Customers',
        question: 'Variable consideration (like discounts or bonuses) should be included in the transaction price only if:',
        options: ['It is 100% certain.', 'It is highly probable that a significant reversal will not occur.', 'The customer is a long-term partner.', 'The amount is less than 5% of the total price.'],
        correctAnswer: 1,
      },
    ],
  },
}

export function getQuizByCourseSlug(slug: string): CourseQuiz | undefined {
  return quizzes[slug]
}
