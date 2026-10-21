# Kashlo

**Your money. Your flow.**

A private Google Apps Script web app for recording expenses, income, investment contributions, expense groups (events, projects, and trips), and review decisions in Google Sheets.

On phones, use the menu button beside the Kashlo logo to open the left navigation drawer. Choose Overview, Transactions, Investments, Dashboards, Review, or Manage; the drawer closes after selection. Desktop navigation stays in the sidebar. On phones, transaction rows become compact cards showing description, amount, and date. Tap **Details** to reveal category, expense group where applicable, payment details, and Edit/Delete where available. Desktop transaction tables keep their existing layout.

To refresh on a phone, scroll to the top, pull down until **Release to refresh** appears, then release. **Refreshing…** stays visible while the latest sheet data loads; your selected page, month, and search stay in place. The gesture is disabled while editing forms, viewing settings, or running another operation. The **Refresh** button remains available.

Transactions, Investments, and expense-group detail lists display 25 records per page, with First, Previous, Next, and Last controls. Search checks all matching records before pagination, including records on other pages. On **Transactions**, choose the selected month, a quarter, the entire configured year, or an inclusive custom date range using the From/To calendars. Combine category, payment-method, expense-group, and journal-type filters with search across description, date, amount, category, group, payment type, available payment names, and notes. The month selector sits beside the date-range preset. Custom From/To calendars stay together on one row. Calendar changes remain drafts while the phone picker is open; tap **Apply dates** to update results after choosing both dates. To cannot precede From, and moving From past the existing To clears To for reselection. Category choices follow the selected journal type, include configured and previously used categories, and always offer **All categories**. **Clear filters** restores the selected month and all types. These extra filters apply only to Transactions; Investments keeps its monthly search. Changing the search or filters starts at page one; edits retain the current page when possible, and shrinking results moves to the last valid page. Summary totals include all matching records, not just the visible page. Overview keeps six recent entries. Pagination limits displayed rows; the app still reads the full sheet snapshot.

After editing a transaction on Overview, Transactions, or Investments, Kashlo updates the changed row and affected summaries without replacing the whole view. Search focus, text selection, page scrolling, and table scrolling are preserved. Fresh sheet data still supplies totals and review checks; date or description changes update the current sorting and filters.

Complete the welcome screen to set your name, workbook, currency, locale, time zone, and year. Open **Profile & settings** through the sidebar avatar/name, or the profile icon beside the logo on mobile, to update profile and display preferences later. Personal settings are stored in Apps Script Properties; [Config.gs](Config.gs) contains the shared worksheet layout and product defaults.

Start with the [Kashlo — Personal Finances](https://docs.google.com/spreadsheets/d/1DUx9pc11orQe0zhirA-l80z3VWRYEyGoILiw7znh77s/edit) workbook: **File → Make a copy**, then deploy its included Apps Script project as **Me / Only myself** and complete the welcome screen using your copied workbook URL. No code editing is needed for this template. Template access is managed by its owner.

See [SETUP.md](SETUP.md#recommended-copy-the-ready-to-use-template) for the full browser-only deployment and authorization steps, updates, and the manual installation alternative. The empty template works for the calendar year you choose during setup. Kashlo assigns its journal, dashboard, review, and summary tabs to that year automatically. It includes general starter choices and no personal transactions. **Use one workbook and one private app deployment per year.** For another year, make a fresh copy of the shared template and repeat setup; keep the earlier workbook and app for its historical records.

Journals add space automatically as you record transactions through Kashlo, including the necessary formatting, dropdowns, and checks. Existing installations need the latest app files and a redeployment to receive this behavior.

Run the local regression checks with Node.js:

```sh
node --test tests/config.test.cjs
```

## Payment tracking

Payment tracking is optional when adding or editing an expense or investment. Leave **Not recorded** selected, or choose Bank transfer, Card, UPI, or Cash. Income entries do not ask for payment details. Bank transfer, Card, and UPI require a bank/card/app name when selected; Cash needs no extra detail. Use **+ Add payment type** in the entry form or **Manage → Payment methods → Add payment type** to create custom types such as Wallet or Cheque. New types can be used alone or with an optional payment name. **+ Add payment name** adds a named choice under an existing type without losing transaction details. You can also manage names in **Manage → Payment methods**. Names only—no card numbers or CVVs. Removing a name deletes its row from the Payment Methods sheet and leaves its detail blank across the app, including past transactions. The payment type remains visible and the original sheet record is preserved.

Payment fields are stored in journal columns V:W, with reusable names in the **Payment Methods** worksheet and custom types in **Payment Types**. Existing transactions show **Not recorded** until updated.

## The Kashlo experience

A charcoal dashboard with lime and lavender accents keeps your recorded cash flow in focus. Monthly checkpoints reflect real entries, contributions, and your manual review status. Positive surplus has a gentle orbit animation; shortfalls stay red. New investment contributions get a brief celebration after saving. All animations respect reduced-motion preferences.

## Dashboards

Open **Dashboards** for **Expense groups**, **Spending insights**, or **Cash flow**. The existing expense-group view and creation flow are kept in this section. Spending insights compares recorded monthly expenses, category totals, and repeated descriptions. Cash flow shows income, expenses, investment contributions, and surplus/shortfall for each month. The month selector applies to Spending insights and Cash flow; expense groups continue to cover all recorded months.

## Organizing descriptions

**Item & Category** contains expense descriptions in A:B, allowed expense categories in D, and expense groups in H. **Investment Items** holds investment descriptions in A:B and their fixed category in D. Both lists are sorted by category and description when Kashlo learns a new name. Category dropdowns, duplicate highlighting, and missing-category highlighting help keep the master lists consistent.

Old spellings and moved investment descriptions are retained in the hidden **Item Aliases** compatibility sheet, so historical journal descriptions and categories remain unchanged. These aliases are excluded from suggestions and are not relearned into the expense master. Use **Manage → Categories** to add expense or income categories, or add a category while creating a description. Investment entries keep the fixed **Investments** category.

## Manage reusable choices

Open **Manage** for **Descriptions**, **Categories**, and **Payment methods**. Select Expense, Income, or Investment to add a description and its category without recording a transaction. New choices are written to the matching master sheet and become available in entry forms immediately. Use **+ Add new category** beneath the category selector to create one alongside an expense or income description, without leaving the Descriptions section. Both are saved together. The selected section and journal stay selected after saving.

Names are trimmed and checked without regard to case within each journal. Existing descriptions cannot be reassigned to another category here, and historical aliases remain protected. Adding choices preserves existing transactions. Editing, merging, and deleting descriptions or categories are outside this release.

## Duplicate review

Expense, income, and investment journals share one policy: possible duplicates match the calendar date, description, amount, and recorded payment type/name within the same journal. Text comparison ignores case and extra whitespace. Repeating a description on another day or for another amount is allowed. No investment names receive special treatment. **Okay** keeps and accepts the exact matching group; correction and confirmed deletion remain user decisions. At the top of Review, **Okay all** accepts the current review entries while keeping all amounts. **Delete all duplicates** asks for confirmation, shows the number of extra entries to remove, and keeps the earliest sheet row in each pending exact duplicate group. Already accepted groups are kept. Both bulk actions check for changes before writing and protect retries from repeating a deletion. As with individual Okay, missing or invalid details still need correction.

## Profile & first-time setup

A fresh installation starts with **Welcome to Kashlo**. Connect an existing compatible Kashlo workbook using its URL or ID; the app validates its journal, lookup, dashboard layout, and prepared duplicate-check formulas before saving. This step does not create a blank workbook template. The Google account comes from the private deployment and cannot be changed through the profile.

Changing currency changes app display formatting without converting existing amounts or changing the sheet’s number formats. Changing time zone updates the selected workbook's time zone and date grouping. A connected workbook stays assigned to one year. For another year, create a fresh template copy and a new private deployment. Settings changes invalidate older open tabs, which must refresh before saving to prevent transactions from going to a different workspace. Existing records remain in their original workbook.

The first launch of this settings-enabled release also requires setup for an existing installation; select your existing workbook to continue. Each person must use their own owner-only Apps Script deployment and workbook. The application is not a shared multi-user service.
