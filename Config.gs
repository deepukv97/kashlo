/**
 * Shared workbook schema and product defaults. Personal settings are collected in the app
 * and stored in Script Properties, separately from source code.
 * Keep the internal journal keys expense/income/investment: they define app behavior.
 * Sheet names may contain {year}; it is replaced with the year below at runtime.
 * Changes take effect after uploading the project and updating its deployment.
 */
const FINANCE = Object.freeze({
  sheets: {
    // Preserve the two spaces in this workbook's expense journal name.
    expense: "{year}  Expense Journal",
    income: "{year} Income Journal",
    investment: "{year} Investment Journal",
  },
  lookupSheets: {
    expense: "Item & Category",
    income: "Source of Income",
    investment: "Investment Items",
  },
  // Hidden compatibility mappings keep old journal descriptions correctly categorized.
  legacyItemAliasesSheet: "Item Aliases",
  paymentMethodsSheet: "Payment Methods",
  paymentTypesSheet: "Payment Types",
  paymentMethods: ["Bank transfer", "Card", "UPI", "Cash"],
  dashboardSheet: "{year} Dashboard",
  groupSummarySheet: "{year} Group Summary",

  // Shared branding. Personal display preferences are collected in Profile & settings.
  display: {
    appTitle: "Kashlo — Your money. Your flow.",
    workspaceLabel: "Personal workspace",
  },
  categories: { investment: "Investments", travel: "Travel" },
  // These describe checks implemented in the workbook's formulas, not in this script.
  reviewHelp:
    "Possible duplicates have the same journal, date, description, amount, and recorded payment details. Description and payment text ignore case and extra whitespace. “Okay” accepts the matching duplicate group and keeps every amount. Use “Correct transaction” to edit an entry, or “Delete duplicate” to remove only the selected entry after confirmation.",
  monthStatuses: ["Not reviewed", "In progress", "Complete", "Not started"],

  // Worksheet coordinates are one-based: A = 1, B = 2, etc.
  // Leave these unchanged when copying the existing workbook layout.
  layout: {
    journal: {
      firstDataRow: 2,
      description: 2,
      amount: 3,
      date: 6,
      category: 7,
      notes: 8,
      // Legacy key retained for compatibility; column I now stores any expense group.
      trip: 9,
      duplicateIssue: 17,
      otherIssues: [18, 19],
      decision: 20,
      reviewNote: 21,
      paymentMethod: 22,
      paymentDetail: 23,
      fingerprintColumns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 22, 23],
      dateFormat: "d-mmm-yyyy",
    },
    lookup: {
      firstDataRow: 2,
      description: 1,
      category: 2,
      categoryOptions: 4,
      // Master list of expense groups (formerly trips).
      trips: 8,
    },
    dashboard: { firstMonthRow: 12, statusColumn: 6 },
  },
  limits: {
    descriptionLength: 180,
    noteLength: 1000,
    groupNameLength: 100,
    maximumAmount: 100000000,
    writeLockTimeoutMs: 20000,
    retryRetentionDays: 7,
  },
});
