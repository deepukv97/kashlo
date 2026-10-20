# Kashlo — Your Google Sheets finance app

Kashlo uses a compatible Google Sheets workbook as its database. Personal profile and workbook settings live in Apps Script Properties; **Config.gs** holds the common sheet names, column layout, and product defaults.

## Install and complete first-time setup

### Recommended: copy the ready-to-use template

You only need a Google account and a browser. No local software or code editing is required.

1. Sign into the Google account that should own your financial data. Open the [Kashlo — Personal Finances](https://docs.google.com/spreadsheets/d/1DUx9pc11orQe0zhirA-l80z3VWRYEyGoILiw7znh77s/edit) workbook and choose **File → Make a copy**. Save the copy in your own Google Drive and give it a name. You must have access to the template first; ask its owner if Google shows an access request. Keep the master template empty.
2. In **your copied workbook**, open **Extensions → Apps Script**. The attached project already contains **Config.gs**, **Code.gs**, **Index.html**, and the manifest. Do not create another project or paste code when these files are present.
3. In Apps Script, choose **Deploy → New deployment**. Click the gear beside **Select type**, then choose **Web app**. Enter a description such as `Kashlo — initial setup`, set **Execute as: Me**, and set **Who has access: Only myself**. Click **Deploy**.
4. Click **Authorize access** and choose the same Google account you used to copy the workbook. If Google shows **"Google hasn’t verified this app"**, click **Advanced → Go to [your project name] (unsafe)** to continue with the Kashlo copy you just created. This notice can appear for a personal deployment that Google has not verified. Only continue for your own Kashlo copy; check the permissions shown and click **Allow** to authorize it. If Google says **"This app is blocked"** or there is no option to continue, stop and ask your work/school administrator if applicable. When deployment finishes, copy the **Web app URL** ending in `/exec`, open it, and bookmark it.
5. Return to **your copied Kashlo sheet** in Google Sheets. Click the browser's address bar and copy the full URL, which starts with `https://docs.google.com/spreadsheets/d/`. Keep this sheet tab open.
6. Switch back to the Kashlo web app. On **Welcome to Kashlo**, paste that URL into **Google Sheet URL or ID**. Use the URL of **your own copy**, not the shared template or the Apps Script deployment URL. Enter your name, workspace name, currency code, locale, time zone, and the **calendar year you want to track**. The current year is suggested automatically; you can choose another year before connecting. For example, an India-based user may choose `INR`, `en-IN`, and `Asia/Kolkata`. Use your own preferences; the Google account is detected automatically and is read-only.
7. Choose **Validate & connect workbook**. Kashlo assigns the fresh template to your selected year and updates its tab names and dashboard dates automatically. After the empty dashboard loads, use **Manage** to add descriptions, categories, and payment names, then add your first transaction. A transaction date is required.

The shared workbook contains empty journals, general description/category suggestions, dashboard/review formulas, and blank payment/group lists. It contains no personal transactions or saved owner profile. **Bundled app last updated: 20 October 2026.** Journals add space automatically as you record transactions in Kashlo. Follow the update instructions below to update an existing installation. Sheets use neutral numeric amount formatting; the app displays your selected currency. Set a currency format in Sheets separately if desired.

**One workbook per calendar year.** The shared template has no assigned year. During first-time setup, Kashlo replaces the `{year}` tab-name placeholders and records your chosen year in **Start here → B16**, which drives the workbook's dashboard dates. Keep this cell managed by Kashlo. Once connected, the workbook stays assigned to that year.

### Start another year

Repeat steps 1–7 with a **fresh copy of the shared template**, create a **new private Apps Script deployment**, and choose the next year on its welcome screen. Give the workbook a name that helps you recognize its year and bookmark the new app separately. Keep your previous workbook and app for viewing historical records. Start with the empty template rather than duplicating a workbook that already contains transactions. Historical entries, descriptions, payment names, expense groups, and review statuses are not carried forward automatically.

### Alternative: install the repository files manually

If your compatible workbook does not have an attached script, open **Extensions → Apps Script** and replace the default code with [Code.gs](Code.gs). Add a script file named **Config** containing [Config.gs](Config.gs), and an HTML file named **Index** containing [Index.html](Index.html). In **Project settings**, enable **Show "appsscript.json" manifest file in editor**, then replace its contents with [appsscript.json](appsscript.json). Save all files and follow deployment steps 3–7 above. The workbook must already have the required layout and formulas; a blank Google Sheet alone will not work.

### Update an existing installation

Copy the updated repository files into **your own** Apps Script project and save them. Choose **Deploy → Manage deployments**, select the existing web app, click the pencil, select **Version → New version**, add a short description, and click **Deploy**. Open or reload the existing bookmarked URL. The template's attached code is a snapshot; existing copies do not automatically receive future code updates. Profile setting changes need no redeployment.

An existing installation upgrading to this release also sees setup once. Select the existing workbook to retain its records. Nothing is copied or deleted by setup. Owner name, email, workbook ID, year, currency, and locale no longer need to be placed in source code.

## Profile & settings

On desktop, click the **avatar/name at the bottom of the sidebar**. On mobile, use the **profile icon beside the Kashlo logo**.

- **Profile:** owner name and workspace name; initials are generated automatically. The Google account cannot be changed here.
- **Workbook settings:** Google Sheet URL/ID, currency, locale, time zone, and year.

Currency changes app formatting only, not historical amounts, exchange rates, or the sheet’s number formats. The selected time zone is applied to the workbook and used for transaction dates. The year is assigned when connecting a fresh template. Changing the year of an already connected workbook is blocked; use a new copy and deployment for another year. App date handling uses the workbook's time zone; the Apps Script manifest's default time zone is separate.

Settings are saved under `kashlo:workspace:v1` in Script Properties for this owner-only deployment. All financial writes carry the workspace revision from the loaded snapshot; after settings change, older tabs must refresh before writing. A copied script cannot silently reuse another owner's stored workbook settings. Settings validation failures preserve the previous connection and workbook time zone.

## Shared schema in Config.gs

Keep journal keys `expense`, `income`, and `investment`. Customize worksheet names and coordinates only when adapting the workbook layout:

| Setting                                         | Purpose                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sheets`                                        | Journal tab names; `{year}` is replaced using the saved profile year. The default expense tab has two spaces after the year. |
| `lookupSheets`                                  | Expense, income, and investment master-list tabs.                                                                            |
| `workbookYear`                                  | Template guide and assigned-year cell; keep this marker when adapting the template.                                          |
| `dashboardSheet`                                | Dashboard tab containing monthly completeness statuses.                                                                      |
| `groupSummarySheet`                             | Optional native expense-group summary.                                                                                       |
| `paymentMethodsSheet`, `paymentTypesSheet`      | Reusable payment-name and custom-type storage.                                                                               |
| `legacyItemAliasesSheet`                        | Historical description compatibility mappings.                                                                               |
| `display`                                       | Product title and default workspace label; personal display settings come from the profile.                                  |
| `categories`, `paymentMethods`, `monthStatuses` | Shared investment category, initial payment types, and review status labels.                                                 |
| `reviewHelp`, `layout`, `limits`                | General policy guidance, column coordinates, and validation/write limits.                                                    |

New transactions always start with a blank required date. Corrections keep their recorded date. For another year, repeat first-time setup in a fresh template copy and new deployment.

## Share or deploy the project

Each person needs their own copied workbook and Apps Script project, deployed while signed into their own Google account with access **Only myself**. Do not publish one owner-executed deployment for multiple people's finances. If using clasp, copy **.clasp.example.json** to **.clasp.json** and replace the placeholder with **your own Apps Script project ID** from Apps Script → Project settings before uploading. The workbook URL is selected later during first-time setup. The real `.clasp.json` is local deployment configuration and must not be committed.

```sh
cp .clasp.example.json .clasp.json
# Edit .clasp.json and set your own scriptId before continuing.
clasp login
clasp status
clasp push
clasp deployments
clasp deploy --deploymentId YOUR_EXISTING_DEPLOYMENT_ID --description "Update Kashlo"
```

A new installation uses `clasp deploy --description "Kashlo"` for its first deployment. Updating an existing deployment retains its URL. The included **.claspignore** uploads only Config.gs, Code.gs, Index.html, and appsscript.json. Changes to local code require upload and redeployment; editing profile settings requires neither.

The repository's `.gitignore` excludes clasp login files, local deployment targets, environment files, credential keys, workbook exports, and private-data/backup folders. Keep credentials and financial data outside tracked source files; ignore rules do not remove anything already committed. The shared `appsscript.json` manifest and `.clasp.example.json` contain public configuration and remain versioned.

## What is included

A shared bottom-right **In progress…** status appears during the initial sheet load and all server actions. It stays visible through a save followed by refresh, then briefly shows **Completed**. Failed operations show **Couldn’t complete** alongside the existing error message.

- **Overview:** month selector, income, expenses, investment contributions, cash surplus/shortfall, monthly chart, category chart, recent activity, annual totals.
- **Transactions:** searchable monthly records and a quick-entry form. Transaction, investment, and expense-group detail lists display 25 records per page with First, Previous, Next, and Last controls. Search covers the full selected month/type before pagination, not only the visible page. Search/filter changes reset to page one; edits keep the current page when possible, and shorter results clamp it to the last valid page. Totals cover all matching records. Overview keeps six recent entries. On phones, each transaction appears as a compact card with its description, amount, and date; **Details** expands category, expense group where applicable, payment details, and available Edit/Delete actions. Desktop tables keep their existing layout. Each row on Overview, Transactions, and Investments has **Edit** and **Delete** buttons. Delete opens a confirmation dialog and removes the selected transaction from Google Sheets only after confirmation. Edit opens the existing description, date, amount, category, expense group, and notes for editing. Saving updates the same journal row, verifies its fingerprint, and refreshes totals; Cancel makes no changes. On Overview, Transactions, and Investments, successful edits update changed elements in place while preserving search focus, text selection, and page/table scrolling. Kashlo still reads a fresh sheet snapshot for totals and review checks. The journal stays fixed. Known descriptions fill their category automatically. A new description/category is remembered once for subsequent entries.
- **Investments:** contributions separate from spending. No portfolio value or investment returns are inferred.
- **Dashboards:** Expense groups, Spending insights, and Cash flow share one sidebar tab. Spending insights compares selected-month expenses with the previous month, shows the six largest categories, and lists repeated descriptions. Cash flow includes an annual chart and twelve monthly totals with completeness status. January has no prior-year comparison in this workbook. Figures use recorded entries, so incomplete months affect comparisons.
- **Expense groups (inside Dashboards):** combine expenses from any categories for a wedding, house construction, a trip, or another purpose. Create a group from **Dashboards → Expense groups → New group**, or use **Create new group** beside the expense form dropdown without losing entered fields. Group names are saved in **Item & Category column H**, and selected groups are saved in **Expense Journal column I**. Existing expense-group tags remain unchanged. The **Group Summary** worksheet provides native totals and category breakdowns. Group totals cover all months, not only the selected month.
- **Review:** three actions for each flagged entry: **Okay**, **Correct transaction**, and **Delete duplicate**. Okay accepts the entire matching duplicate group without changing any amounts. All three journals use the same duplicate policy: matching date, description, amount, payment type, and payment name within the same journal. Description and payment text ignore case and extra whitespace; dates compare the calendar day. Blank payment details match other blanks, while a known payment name does not match an unknown one. Other issues, such as missing categories, remain visible until corrected. Correction opens the selected entry in a prefilled form and updates it in place. Deletion opens a confirmation showing the exact entry before removing it from totals. Optional review notes remain supported.
- **Monthly completeness:** update the existing Dashboard statuses from the interface.

At the top of the Review list, two buttons let you handle entries together:

- **Okay all:** opens a confirmation before marking all current review entries Okay, using the same behavior as the individual button. Every transaction and amount stays unchanged. Duplicate warnings clear; missing or invalid details still need correction. Notes entered beside the entries are saved.
- **Delete all duplicates:** opens a confirmation showing how many extra transactions will be permanently removed from Google Sheets and totals. It keeps the earliest sheet row in each pending exact duplicate group and deletes the extra copies. Already accepted groups and unrelated entries are kept. The button is disabled when no pending duplicate groups are available.

Bulk actions show **In progress…** while saving, then refresh the review list and totals. Before writing, Kashlo checks that the loaded transactions and review decisions still match the sheet; refresh if they have changed. Retrying the same confirmation uses the same submission ID to prevent repeated deletions. If an action fails and its result is uncertain, refresh and check the sheet before starting another bulk action.

Profile settings, master-list controls, transaction actions, review actions, and month statuses save only when you submit their controls. Refresh initializes payment storage if needed, then reads the current snapshot. Existing sheet formulas remain in place. Review actions, corrections, and deletions check the loaded transaction fingerprint so a changed source entry cannot be modified accidentally. Corrections reset its review decision to Pending so the sheet can reevaluate its checks. They keep the original review note and do not overwrite description/category mappings.

## Expense-group setup and compatibility

The browser and worksheet both use the visible label **Expense group**. In a fresh workbook, label Expense Journal cell **I1** `Expense group`, Item & Category cell **H1** `Expense groups`, and name the optional summary tab **{year} Group Summary** (setup replaces `{year}` with the selected year). Keep its existing expense/category pivot tables; their source is still the expense journal.

For compatibility, the internal `trip` transaction field, `trips` dropdown array, and `layout.journal.trip` / `layout.lookup.trips` configuration keys retain their original names. They now carry any expense group, not just travel. No existing financial records need migration.

Creating a group adds a name to the master list; it does not create a payment or alter financial totals. Group names are trimmed, limited by `limits.groupNameLength`, and reused case-insensitively to avoid duplicate dropdown choices. One expense belongs to at most one group. Income and investment entries do not use this field. Categories continue to describe what was bought; groups describe its shared purpose. Groups may also be entered directly in the master list and then loaded with Refresh.

## Preview versus connected app

Opening **Index.html** as a local file previews the interface only. It intentionally shows empty states and does not contain a copy of your financial data. Saving is disabled until it is running in Apps Script and live data has loaded.

When you edit the sheet directly, click **Refresh** in the app. The interface does not continuously sync in the background. Failed refreshes retain the previous data and mark it stale.

Cash surplus/shortfall is **recorded income − recorded expenses − recorded investment contributions**. It is not your bank balance. An aggregate group payment must not also be counted as separate itemized costs.

## Technical notes and limits

- The year is selected in **Profile & settings**; tab names and column positions are configured in **Config.gs**. The default journal columns are: Description B, Amount C, Date F, Category G, Notes H; Expense group I; Review decision T; Review note U.
- Adding entries uses the row after the last recorded description, amount, or date, preserving incomplete entries. When more space is needed, Kashlo extends the journal, copies formatting and dropdowns, and extends the date and review checks automatically. The optional native Review sheet grows too.
- Submission IDs and a lock protect against duplicate clicks. If a save starts but its completion is uncertain, it will not automatically replay the submission. Refresh and check the source before trying again.
- Review decisions use batched writes per journal, and adjacent submitted notes are written together as literal rich text. Bulk duplicate cleanup deletes consecutive row groups from bottom to top and repairs generated checks once per affected journal, including after a partial deletion failure. Confirmation, snapshot validation, and retry protection remain in place; intervening rows and unsubmitted notes are preserved. These operations use built-in Apps Script [RangeList](https://developers.google.com/apps-script/reference/spreadsheet/range-list), [rich-text range writes](https://developers.google.com/apps-script/reference/spreadsheet/range#setrichtextvaluesvalues), and [grouped row deletion](https://developers.google.com/apps-script/reference/spreadsheet/sheet#deleterowsrowposition,-howmany).
- A manual category saved through the app is stored as a value for that entry. New description mappings are learned once; existing mappings are not overwritten.
- Flagged transactions can be corrected or deleted from Review. Corrections keep the entry in its original journal. Deletion removes the entire sheet row and shifts the rows below upward. Google Sheets adjusts remaining formula references. The changed row count invalidates older app snapshots so identical shifted duplicates cannot be changed using stale row references. Other duplicate transactions remain. Keep standalone summary tables on summary tabs instead of beside transaction rows. Unflagged entries can also be edited or deleted from Overview, Transactions, and Investments. The app cannot trade, transfer money, or make payments.
- Run `node --test tests/config.test.cjs` to check configuration changes against in-memory server and browser adapters. The tests exercise fresh-year setup, single-year protection, leap dates, owner authorization, writes, retries, review fingerprints, column changes, browser settings, correction validation, deletion confirmation, safe retries, formula preservation, and unchanged neighboring duplicates without accessing Google Sheets. Verify live reads and writes after deploying.

Official references: [Deploying web apps](https://developers.google.com/apps-script/guides/web) and [copying container-bound scripts](https://developers.google.com/apps-script/guides/bound).

## Payment methods

Payment tracking is optional: leave **Not recorded** selected, or choose **Bank transfer**, **Card**, **UPI**, or **Cash** in the transaction form. The first three reveal a required bank/card/app selector; Cash hides and clears that detail. This applies to expenses and investments. Income entry and editing hide payment fields and save blank payment metadata. Use **+ Add payment type** to create a custom type, or **+ Add payment name** to add a name under an existing type without losing the rest of the form, or use **Manage → Payment methods** to add/remove names. Only a name is collected.

On the first successful load, the app adds formatted **Payment method** and **Bank / card / UPI app** headers in columns **V:W** on all three journals, expanding their column count where needed. Existing inputs and formulas remain in place. The new **Payment Methods** worksheet stores **Payment method**, **Name**, and **Available for new entries** in A:C, with a frozen header. There are no initial sample bank/card/app names. Rows marked **Yes** are available. Removing a name deletes its master-list row from the sheet, while retaining transaction history in the journals. Existing rows marked **No** are deleted automatically on the next successful app load or payment-name update. Re-adding a removed name creates a new master-list row. You may edit the master list directly and Refresh the app.

Older entries retain blank payment fields and display **Not recorded**. Editing them can keep payment tracking blank; selecting Not recorded also clears existing payment metadata. Removed names display as blank on all transaction tables and in the edit form. The payment type remains visible. When a bank, card, or UPI method is selected, choose an available name before saving; alternatively select Not recorded. Original payment names remain in the source sheet for history; adding the same name again makes it visible again. Payment fields are included in fingerprints, so a direct sheet change rejects a stale correction or deletion. Older clients that omit payment fields remain compatible and preserve existing metadata when editing.

## Organized description lists

- **Item & Category A:B:** expense item/category mappings, sorted by category then item. Sort only the mapping pair; the category and expense-group lists beside it are independent.
- **Item & Category D:** editable allowed expense categories. Its dropdown validates B. The former derived category formula was replaced with the existing category values so a category typo does not become a new allowed choice automatically.
- **Investment Items A:B:** investment descriptions and the fixed Investments category. Column D supplies that category; Item & Category E links to it to preserve existing native journal dropdown references. Configure the investment lookup in `lookupSheets.investment`.
- **Item & Category H:** existing expense groups, unchanged.
- **Item Aliases:** hidden original-name/current-name/category mappings used by native expense-journal formulas. Keep this compatibility sheet when copying the workbook. The migrated formulas check aliases first, then current expense mappings, preserving old category results without renaming historical transactions. Configure `legacyItemAliasesSheet` if renaming this tab.

Both description lists have category dropdowns, duplicate-name and missing-category highlighting, frozen headers, and filters limited to A:B. New descriptions learned through Kashlo are added to the correct journal's lookup and only that mapping block is sorted. New investment names are now available as typed-prefix suggestions too. Legacy expense names remain recordable but are not added back to the cleaned suggestion list. Existing journal amounts, descriptions, and manual categories are not changed by the master-list cleanup.

## Manage descriptions and categories

The **Manage** sidebar tab contains **Descriptions**, **Categories**, and **Payment methods**. Select a journal to maintain its reusable choices. Expense and income support new categories, including inline category creation while adding a description. Investment descriptions use the configured fixed Investments category. Existing descriptions cannot be remapped through these controls.

Both **Item & Category D2:D** and **Source of Income D2:D** must contain editable category names, not a spilling UNIQUE/FILTER formula. For an older workbook, replace the derived list with its current displayed values before using the add-category controls; retain the existing category spellings, formatting, and dropdown references. The current workbook's nine income categories have been converted without changing their values. New descriptions are written only to their journal's A:B mapping block, which is sorted without moving the adjacent category or expense-group lists.

### Custom payment types

Create types such as Wallet or Cheque in **Manage → Payment methods → Add payment type**, or use **+ Add payment type** beside Payment method in the transaction form. The new type is selected immediately and remains available after refreshing. Custom types may be saved without a payment name; Bank transfer, Card, and UPI still require their corresponding name when selected. Payment tracking itself remains optional, and income continues to hide payment fields.

Custom type names are stored as literal text in **Payment Types column A**, configured by `paymentTypesSheet`. Kashlo creates this sheet with a header and frozen first row when needed. Default types remain configured in `paymentMethods`; names under any non-Cash type remain in the existing **Payment Methods A:C** master. Type names are trimmed and deduplicated without regard to case. Removing a payment name leaves its type available. Keep the Payment Types sheet when copying the workbook.

## General duplicate policy

Journal column Q flags possible duplicates only when the description, numeric amount, calendar date, recorded payment type, and recorded payment name all match another row in the same journal. No description has an exemption or a monthly frequency rule. Text comparisons ignore case and extra whitespace, including repeated spaces. Matching uses literal equality, so description characters such as `*` and `?` are not wildcards.

The shared workbook uses one generated duplicate-check formula at the top of column Q. It compares normalized text, exact numeric amounts, calendar dates, and recorded payment details in bulk. Kashlo extends its range when the journal grows and restores generated formula anchors after deleting the first entry. Leave generated check cells for Kashlo to maintain; transaction values, review decisions, and notes remain separate. Existing installations adopt this check when a journal first needs more space.

The live migration updates only Q formulas and the Q1 explanation notes. Existing review decisions and notes, amounts, payment history, and other validation checks remain unchanged. Previously accepted entries retain their decisions. An Okay action accepts the exact matching group; correction or deletion still requires the user's action, and other issues remain until corrected.
