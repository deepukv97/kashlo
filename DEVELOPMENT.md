# Kashlo — Developer and workbook reference

For ordinary installation and daily use, follow [SETUP.md](SETUP.md). This reference is for people changing the code or adapting the workbook layout.

## Shared schema in Config.gs

Keep journal keys `expense`, `income`, and `investment`. Customize worksheet names and coordinates only when adapting the workbook layout:

| Setting                                         | Purpose                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `sheets`                                        | Journal tab names; `{year}` is replaced using the saved profile year. The default expense tab has two spaces after the year.      |
| `lookupSheets`                                  | Expense, income, and investment master-list tabs.                                                                                 |
| `workbookYear`                                  | Template guide and assigned-year cell; keep this marker when adapting the template.                                               |
| `dashboardSheet`                                | Dashboard tab containing monthly completeness statuses.                                                                           |
| `formulaRanges`                                 | Generated Dashboard/Review formula cells whose journal bounds follow capacity growth; adjust these addresses for a custom layout. |
| `groupSummarySheet`                             | Optional native expense-group summary.                                                                                            |
| `paymentMethodsSheet`, `paymentTypesSheet`      | Reusable payment-name and custom-type storage.                                                                                    |
| `legacyItemAliasesSheet`                        | Historical description compatibility mappings.                                                                                    |
| `display`                                       | Product title and default workspace label; personal display settings come from the profile.                                       |
| `categories`, `paymentMethods`, `monthStatuses` | Shared investment category, initial payment types, and review status labels.                                                      |
| `reviewHelp`, `layout`, `limits`                | General policy guidance, column coordinates, and validation/write limits.                                                         |

New transactions always start with a blank required date. Corrections keep their recorded date. For another year, repeat first-time setup in a fresh template copy and new deployment.

## Saved profile settings

Owner and workbook settings live under `kashlo:workspace:v1` in Script Properties, not in tracked source. Workspace revisions reject saves from older open tabs after settings change. The private deployment determines the owner account. Currency changes app formatting without converting amounts; the saved time zone is applied to the workbook. Setup assigns a fresh template to one calendar year. Failed validation retains the previous connection and time zone.

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

## Maintain the shared template’s bundled app

First-time setup relies on the Apps Script source attached to the public template. Copying the workbook copies that source; a new owner only needs to create a private deployment and complete setup.

When releasing app changes, update the shared template’s attached project with **Code.gs**, **Config.gs**, **Index.html**, and **appsscript.json** from the tested release. Back up the remote project first, use a separate local deployment target, and pull the updated source back to verify all four files. Do not reuse the personal app’s target or copy Script Properties, profile settings, or transaction data. Updating this source does not update deployments or workbook copies that users already created.

Leave the shared workbook’s financial journals empty. Do not deploy a shared owner-executed app for other people; each copied workbook’s owner deploys their own instance.

## Expense-group setup and compatibility

The browser and worksheet both use the visible label **Expense group**. In a fresh workbook, label Expense Journal cell **I1** `Expense group`, Item & Category cell **H1** `Expense groups`, and name the optional summary tab **{year} Group Summary** (setup replaces `{year}` with the selected year). Keep its existing expense/category pivot tables; their source is still the expense journal.

For compatibility, the internal `trip` transaction field, `trips` dropdown array, and `layout.journal.trip` / `layout.lookup.trips` configuration keys retain their original names. They now carry any expense group, not just travel. No existing financial records need migration.

Creating a group adds a name to the master list; it does not create a payment or alter financial totals. Group names are trimmed, limited by `limits.groupNameLength`, and reused case-insensitively to avoid duplicate dropdown choices. One expense belongs to at most one group. Income and investment entries do not use this field. Categories continue to describe what was bought; groups describe its shared purpose. Groups may also be entered directly in the master list and then loaded with Refresh.

## Technical notes and limits

- The year is selected in **Profile & settings**; tab names and column positions are configured in **Config.gs**. The default journal columns are: Description B, Amount C, Date F, Category G, Notes H; Expense group I; Review decision T; Review note U.
- Adding entries uses the row after the last recorded description, amount, or date, preserving incomplete entries. When more space is needed, Kashlo extends the journal, copies formatting and dropdowns, and extends the date and review checks automatically. The optional native Review sheet grows too.
- Formula maintenance runs when journal capacity grows, not on ordinary refreshes or transaction edits. The configured generated Dashboard/Review cells use journal-capacity bounds; later growth updates only open-ended ranges or ranges ending at the previous capacity. Manual values, quoted text, deliberately smaller ranges, and formulas outside `formulaRanges` are preserved. Already-current duplicate/date anchors are not rewritten. Existing installations adopt the summary bounds on their next capacity expansion after updating the app; deletion still repairs affected generated anchors. The duplicate spill reuses amount/date inputs and numeric checks through [LET](https://support.google.com/docs/answer/13190535?hl=en). Lookup lists and native pivots retain their existing behavior.
- Transaction add/edit validation runs under the write lock before marking the submission as started. Invalid fields can be corrected and retried with the same submission ID; successful replays return the original result, and failures after writing starts remain blocked. Amounts must be finite, greater than zero, and within the configured maximum for expenses, income, and investments.
- Submission IDs and a lock protect against duplicate clicks. If a save starts but its completion is uncertain, it will not automatically replay the submission. Refresh and check the source before trying again.
- Review decisions use batched writes per journal, and adjacent submitted notes are written together as literal rich text. Bulk duplicate cleanup deletes consecutive row groups from bottom to top and repairs generated checks once per affected journal, including after a partial deletion failure. Confirmation, snapshot validation, and retry protection remain in place; intervening rows and unsubmitted notes are preserved. These operations use built-in Apps Script [RangeList](https://developers.google.com/apps-script/reference/spreadsheet/range-list), [rich-text range writes](https://developers.google.com/apps-script/reference/spreadsheet/range#setrichtextvaluesvalues), and [grouped row deletion](https://developers.google.com/apps-script/reference/spreadsheet/sheet#deleterowsrowposition,-howmany).
- A manual category saved through the app is stored as a value for that entry. New description mappings are learned once; existing mappings are not overwritten.
- Flagged transactions can be corrected or deleted from Review. Corrections keep the entry in its original journal. Deletion removes the entire sheet row and shifts the rows below upward. Google Sheets adjusts remaining formula references. The changed row count invalidates older app snapshots so identical shifted duplicates cannot be changed using stale row references. Other duplicate transactions remain. Keep standalone summary tables on summary tabs instead of beside transaction rows. Unflagged entries can also be edited or deleted from Overview, Transactions, and Investments. The app cannot trade, transfer money, or make payments.
- Run `node --test tests/config.test.cjs` to check configuration changes against in-memory server and browser adapters. The tests exercise fresh-year setup, single-year protection, leap dates, owner authorization, writes, retries, review fingerprints, column changes, browser settings, correction validation, deletion confirmation, safe retries, formula preservation, and unchanged neighboring duplicates without accessing Google Sheets. Verify live reads and writes after deploying.

Official references: [Deploying web apps](https://developers.google.com/apps-script/guides/web) and [copying container-bound scripts](https://developers.google.com/apps-script/guides/bound).

## Payment methods

Payment tracking is optional: leave **Not recorded** selected, or choose **Bank transfer**, **Card**, **UPI**, or **Cash** in the transaction form. The first three reveal a required bank/card/app selector; Cash hides and clears that detail. This applies to expenses and investments. Income entry and editing hide payment fields and save blank payment metadata. Use **+ Add payment type** to create a custom type, or **+ Add payment name** to add a name under an existing type without losing the rest of the form, or use **Manage → Payment methods** to add, edit, or remove types and names. Only a name is collected.

On the first successful load, the app adds formatted **Payment method** and **Bank / card / UPI app** headers in columns **V:W** on all three journals, expanding their column count where needed. Existing inputs and formulas remain in place. The new **Payment Methods** worksheet stores **Payment method**, **Name**, and **Available for new entries** in A:C, with a frozen header. There are no initial sample bank/card/app names. Rows marked **Yes** are available. Removing a name deletes its master-list row from the sheet, while retaining transaction history in the journals. Existing rows marked **No** are deleted automatically on the next successful app load or payment-name update. Re-adding a removed name creates a new master-list row. You may edit the master list directly and Refresh the app.

Older entries retain blank payment fields and display **Not recorded**. Editing them can keep payment tracking blank; selecting Not recorded also clears existing payment metadata. Removed names display as blank on all transaction tables and in the edit form. The payment type remains visible. When a bank, card, or UPI method is selected, choose an available name before saving; alternatively select Not recorded. Original payment names remain in the source sheet for history; adding the same name again makes it visible again. Payment fields are included in fingerprints, so a direct sheet change rejects a stale correction or deletion. Older clients that omit payment fields remain compatible and preserve existing metadata when editing.

## Organized description lists

- **Item & Category A:B:** expense item/category mappings, sorted by category then item. Sort only the mapping pair; the category and expense-group lists beside it are independent.
- **Item & Category D:** editable allowed expense categories. Its dropdown validates B. The former derived category formula was replaced with the existing category values so a category typo does not become a new allowed choice automatically.
- **Investment Items A:B:** investment descriptions and their categories. Column D supplies the editable category list; Item & Category E links to it to preserve existing native journal dropdown references. Configure the investment lookup in `lookupSheets.investment`.
- **Item & Category H:** existing expense groups, unchanged.
- **Item Aliases:** hidden original-name/current-name/category mappings used by native expense-journal formulas. Keep this compatibility sheet when copying the workbook. The migrated formulas check aliases first, then current expense mappings, preserving old category results without renaming historical transactions. Configure `legacyItemAliasesSheet` if renaming this tab.

Both description lists have category dropdowns, duplicate-name and missing-category highlighting, frozen headers, and filters limited to A:B. New descriptions learned through Kashlo are added to the correct journal's lookup and only that mapping block is sorted. New investment names are now available as typed-prefix suggestions too. Legacy expense names remain recordable but are not added back to the cleaned suggestion list. Existing journal amounts, descriptions, and manual categories are not changed by the master-list cleanup.

## Manage descriptions and categories

The **Manage** sidebar tab contains **Descriptions**, **Categories**, and **Payment methods**. Select a journal to maintain its reusable choices. All three journals support new categories, including inline category creation while adding a description. Saved descriptions and categories have Edit and Remove controls. Description editing updates its name and mapping; category renaming updates dependent description mappings. Removal of a category used by descriptions requires a replacement. Master-column writes preserve neighboring lists, formatting, and validation. Existing transaction values are preserved; affected native formula-derived categories are saved as their current literal values before changing a mapping. An existing transaction may retain a removed historical category during edits, but new transactions must use an available category.

Investment categories in older copies fall back to the existing mapping or configured default until the first category-management write. That write initializes Investment Items column D and labels its header **Categories**, marking the list as authoritative even when intentionally empty. The original Investments choice can be edited or removed like any other category. During initialization, prepared investment category formulas for unused rows switch from a fixed label to the description lookup; recorded category results are preserved.

Manage mutations use the workspace revision, owner authorization, write lock, and request receipts. Read-only validation rejects stale choices, conflicting names, and missing category replacements before a write starts, allowing corrected retries. Started or partially completed writes cannot replay.

The category columns in **Item & Category D2:D**, **Source of Income D2:D**, and **Investment Items D2:D** must contain editable category names, not a spilling UNIQUE/FILTER formula. For an older workbook, replace the derived list with its current displayed values before using the add-category controls; retain the existing category spellings, formatting, and dropdown references. New descriptions are written only to their journal's A:B mapping block, which is sorted without moving the adjacent category or expense-group lists.

### Custom payment types

Create types such as Wallet or Cheque in **Manage → Payment methods → Add payment type**, or use **+ Add payment type** beside Payment method in the transaction form. The new type is selected immediately and remains available after refreshing. Custom types may be saved without a payment name; Bank transfer, Card, and UPI still require their corresponding name when selected. Payment tracking itself remains optional, and income continues to hide payment fields.

Payment type names are stored as literal text in **Payment Types column A**, configured by `paymentTypesSheet`. Kashlo creates this sheet with a header and frozen first row when needed. Older custom-only lists are seeded once with `paymentMethods` defaults and their existing custom values; the **Payment type** header marks the resulting list as authoritative. Deleting a default or every type does not restore defaults on refresh. Names under any non-Cash type remain in the existing **Payment Methods A:C** master. Editing a type updates its saved names' type; removing a type deletes its associated name rows bottom-up. Both operations preserve journal history. Removed types and names display blank in the app. Type names are trimmed and deduplicated without regard to case. Removing a payment name leaves its type available. Keep the Payment Types sheet when copying the workbook.

## General duplicate policy

Journal column Q flags possible duplicates only when the description, numeric amount, calendar date, recorded payment type, and recorded payment name all match another row in the same journal. No description has an exemption or a monthly frequency rule. Text comparisons ignore case and extra whitespace, including repeated spaces. Matching uses literal equality, so description characters such as `*` and `?` are not wildcards.

The shared workbook uses one generated duplicate-check formula at the top of column Q. It compares normalized text, exact numeric amounts, calendar dates, and recorded payment details in bulk. Kashlo extends its range when the journal grows and restores generated formula anchors after deleting the first entry. Leave generated check cells for Kashlo to maintain; transaction values, review decisions, and notes remain separate. Existing installations adopt this check when a journal first needs more space.

For older workbooks, a duplicate-policy migration updates only Q formulas and the Q1 explanation notes; copying app files alone does not migrate legacy worksheet checks. Existing review decisions and notes, amounts, payment history, and other validation checks remain unchanged. Previously accepted entries retain their decisions. An Okay action accepts the exact matching group; correction or deletion still requires the user's action, and other issues remain until corrected.
