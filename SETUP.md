# Set up and use Kashlo

Use a computer browser for the first setup. You only need a Google account; you do not need to install software or know how to program. After setup, open your app on your phone or computer.

[Set up](#set-up-your-private-app) · [Daily use](#use-kashlo) · [Update](#update-your-app) · [Another year](#start-another-year) · [Help](#if-something-goes-wrong)

## Set up your private app

### 1. Make your own copy of the sheet

1. Sign in to the Google account you want to use for Kashlo.
2. Open the [Kashlo — Personal Finances workbook](https://docs.google.com/spreadsheets/d/1DUx9pc11orQe0zhirA-l80z3VWRYEyGoILiw7znh77s/edit).
3. Choose **File → Make a copy**. Give it a name and save it to your Google Drive.
4. Keep **your copy** open. Do the remaining steps in your copy, not the shared template.

The template includes the sheets and formulas Kashlo needs, with no personal transactions. If Google asks you to request access, contact the template owner.

### 2. Open the attached app project

In **your copied sheet**, choose **Extensions → Apps Script**. This opens the project attached to your copy. **The app code and settings files are already included. You do not need to copy files from GitHub or edit code.** You do not need a second project.

### 3. Publish your private app

1. Click **Deploy → New deployment**.
2. Click the gear beside **Select type** and choose **Web app**.
3. Enter a description, such as `My Kashlo app`.
4. Set **Execute as → Me**.
5. Set **Who has access → Only myself**.
6. Click **Deploy**.

Keep **Only myself** selected. Your friend should create their own private app rather than use yours.

### 4. Authorize and open the app

1. Click **Authorize access** and choose the same Google account used for your sheet copy.
2. If Google shows **Google hasn’t verified this app**, open **Advanced → Go to [your project name] (unsafe)** for the Kashlo copy you just created. This is a normal warning for personal Google Apps Script projects that have not gone through Google’s verification process. Continue only for your own Kashlo copy. Review the requested permissions and grant all permissions Kashlo requests, then click **Allow**. This authorization is required to complete setup and let Kashlo read and update your workbook. [Learn about Google’s verification warning](https://developers.google.com/apps-script/guides/client-verification).
3. If Google says the app is blocked or offers no way to continue, see [Help](#if-something-goes-wrong).
4. After deployment, copy the **Web app URL** ending in `/exec`. Open it in a new tab and bookmark it. This is the app you will use every day.

### 5. Connect your sheet on the welcome screen

1. Return to **your copied Google Sheet**. Copy the full URL from the browser address bar.
2. Return to the Kashlo app’s **Welcome to Kashlo** screen.
3. Paste the copied sheet URL into **Google Sheet URL or ID**.
4. Fill in your preferences:

| Setting            | What to enter                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **Your name**      | Your name, as you want it shown in the app.                                                             |
| **Workspace name** | A label for your finances, such as `My finances`.                                                       |
| **Currency code**  | Your currency code, such as `INR`, `USD`, or `EUR`.                                                     |
| **Locale**         | How dates and numbers are displayed. For example, `en-IN` for Indian English or `en-US` for US English. |
| **Time zone**      | The time zone for your records, such as `Asia/Kolkata`.                                                 |
| **Year**           | The calendar year you want to track. The current year is suggested.                                     |

Your Google account is detected automatically. You cannot change it in the profile.

Choose **Validate & connect workbook**. Kashlo prepares the template’s tab names and dashboard dates for your chosen year. When the empty dashboard appears, your connection is ready.

**Keep these two URLs separate:**

| URL                                                                  | What it is for                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Your Google Sheet URL** — contains `docs.google.com/spreadsheets/` | Paste this into the welcome screen. This sheet holds your records. |
| **Your web app URL** — ends in `/exec`                               | Bookmark and open this to use Kashlo.                              |

### 6. Add your first transaction

1. Click **Add transaction**.
2. Choose **expense**, **income**, or **investment**.
3. Choose the transaction’s date. It starts blank so you can enter the correct day.
4. Enter a description and an amount greater than zero, then choose the category. This applies to expenses, income, and investments. Known descriptions suggest their category automatically.
5. For an expense, optionally choose an **expense group**. For an expense or investment, optionally record how you paid.
6. Click **Save to Google Sheet**. Wait for the operation to finish, then find the entry under its recorded month.

You are ready to use Kashlo. Open your bookmarked app for daily use; you do not need to open Apps Script again unless updating the app.

## Use Kashlo

### Find and filter transactions

Open **Transactions**. Search can find descriptions, categories, expense groups, payment methods such as UPI or Bank transfer, available bank/card/app names, dates, amounts, and notes.

Combine search with these filters:

- **Journal type:** all, expense, income, or investment. Category choices follow that type; **All categories** is always available.
- **Date range:** selected month, quarter, entire year, or custom dates. Month and quarter selection appear beside the date-range preset.
- **Category, Payment method, Expense group:** choose a specific value or keep all values.

For **Custom dates**:

1. Tap **From** to open its calendar.
2. Tap a day, then tap the **✓ at the bottom of that calendar** to confirm it. Opening the calendar does not select today automatically.
3. Repeat for **To**. It must be on or after From.
4. Results filter automatically when both dates are confirmed. Both endpoints are included. There is no separate Apply button.

Closing the calendar with **×** cancels an unconfirmed choice. **Reset**, followed by the calendar checkmark, clears that date. If you move From past the existing To, choose To again.

**Clear filters** returns to the selected month with all journal types. Lists show 25 records per page; search covers all matching records, including other pages. These extra filters are only on Transactions; Investments keeps its monthly view.

### Edit or delete an entry

Use **Edit** or **Delete** beside an entry on Overview, Transactions, or Investments. On a phone, tap **Details** first.

**Edit** opens the saved entry. Change it and save, or cancel to keep it as it is. **Delete** asks for confirmation; confirming removes that entry from your Google Sheet and totals.

### Track payment methods

**Payment method** is how you paid, such as Bank transfer, Card, UPI, Cash, or Wallet. **Payment account / app** is the specific account, card, or app you used. For example: **Card → Example credit card** or **UPI → Example UPI app**.

For expenses and investments, payment tracking is optional. Leave **Not recorded**, or choose a payment method. Income has no payment fields.

- **Bank transfer, Card, UPI:** choose the bank, card, or app name after selecting the method.
- **Cash:** no extra name is needed.
- **Custom methods:** add a method such as Wallet or Cheque. A payment account / app is optional for custom methods.

Use **+ Add payment method** or **+ Add account / app** in the transaction form, or open **Manage → Payment methods**. Names are enough; do not enter card numbers, CVVs, passwords, or account credentials.

Removing a payment account / app deletes it from the reusable list and shows that account or app as blank in the app’s past transactions. The payment method remains visible, and the original transaction record stays in the sheet.

### Organize descriptions, categories, and expense groups

**Manage → Descriptions:** choose the journal, enter a description, and choose its category. For any journal, **+ Add new category** lets you create the category without leaving this section.

**Manage → Categories:** add categories for expenses, income, or investments. Use **Edit** or **Remove** beside any saved description or category, including the initial choices. Editing a description lets you change its name and category. Removing a category asks for a replacement if saved descriptions use it; add another category first if needed. Confirm removals in the pop-up.

**Manage → Payment methods:** use **Edit** or **Remove** on a payment method or saved payment account / app. You can remove initial methods such as UPI, Card, Bank transfer, or Cash. Removing a method also removes all names saved under it. Add it again later if needed.

These changes update reusable choices for future entries. Existing transactions keep their recorded descriptions, categories, and payment history in the sheet. Removed payment choices display as blank in the app. Renamed payment choices are new labels for future entries; old labels remain in the transaction history and display as blank unless added again.

**Manage → Expense groups:** add a group for an event, project, or trip. All saved groups appear below the form. Click **Remove**, then confirm, to remove a group from saved choices and dashboard group cards. Existing expenses and their recorded group tags stay unchanged.

Select a saved group when adding an expense. **Dashboards → Expense groups → Manage groups** takes you to the same Manage section. Creating a group does not add an expense. Income and investments do not use expense groups.

### Read your dashboards

**Overview** shows the selected month’s recorded income, expenses, investment contributions, and surplus/shortfall. A shortfall appears red; a surplus appears green. It also shows recent activity and annual totals.

**Dashboards** contains **Expense groups**, **Spending insights**, and **Cash flow**. Expense-group totals cover all months. Spending insights and Cash flow use their month selector.

Investment totals show money contributed, not current portfolio value or returns. Surplus/shortfall is recorded income minus expenses and investment contributions, not your bank balance. Avoid counting an aggregate group payment and its itemized expenses twice.

### Review possible duplicates

Open **Review**. A possible duplicate means the same journal has matching date, description, amount, and recorded payment details. Repeating a description on another day or for a different amount is allowed.

| Action                    | What happens                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Okay**                  | Accepts the matching duplicate group. All entries and amounts stay.                                                                             |
| **Correct transaction**   | Opens the chosen entry for editing.                                                                                                             |
| **Delete duplicate**      | Asks for confirmation before removing that chosen entry.                                                                                        |
| **Okay all**              | Asks for confirmation, then accepts the current review entries without deleting amounts.                                                        |
| **Delete all duplicates** | Asks for confirmation, then removes extra copies in each pending duplicate group, keeping the earliest sheet row. Already accepted groups stay. |

Other problems, such as a missing category, still need correction even after Okay. Kashlo does not automatically delete entries. If a save or deletion has an uncertain result, refresh and check the sheet before starting another attempt.

### Mark a month complete

Open **Review**, scroll below the flagged entries to **Monthly completeness**, and choose the status beside each month. Mark a month **Complete** after checking that all its transactions have been entered.

### Use Kashlo on your phone and refresh data

Open your bookmarked web app URL while signed in to your Google account. Tap the menu beside the logo to change pages. Transaction cards show description, amount, and date; **Details** reveals the other fields and available actions.

Tap **Refresh**, or scroll to the top and pull down until **Release to refresh** appears, then release. This reads the latest sheet data; it does not install new app code. If you change the sheet directly, refresh the app afterward.

**In progress…** means Kashlo is working. Wait for **Completed** before repeating an action. Failed refreshes keep the previous data and mark it potentially stale.

### Change your profile

On a computer, click your avatar/name at the bottom of the sidebar. On a phone, use the profile icon beside the logo. Open **Profile & settings** to update your name, workspace label, and preferences.

Currency changes how amounts look in the app; it does not convert money or change sheet number formats. Time zone changes apply to the workbook. The year stays fixed after connection. Refresh other open app tabs after changing settings.

## Update your app

Your copied app is a snapshot. It does not automatically receive later updates. **New users do not need these steps:** the shared template already includes the app. Use this section only to update an existing copy while keeping its records.

1. Open **your sheet → Extensions → Apps Script**.
2. Replace the four app files using the instructions below, then save them.
3. Choose **Deploy → Manage deployments**.
4. Select your existing web app and click the **pencil** to edit it.
5. Under **Version**, choose **New version**. Add a description and click **Deploy**.
6. Reload your bookmarked app URL. Keep the same workbook and year to retain your records.

You do not need to copy a new workbook for an ordinary app update. If the welcome screen appears after an older-version upgrade, connect your existing Kashlo sheet. Profile preference changes do not require deployment.

### Replace files for an existing app update

Use this only when updating an app you already use. It is not part of first-time setup.

For each file below, open its GitHub link and choose **Copy raw file**. If that button is unavailable, choose **Raw**, select all the text, and copy it. In Apps Script, open the matching file, select all its contents, paste the copied text, and save. Use all four files from the same repository version.

| File on GitHub                     | Matching file in Apps Script |
| ---------------------------------- | ---------------------------- |
| [Code.gs](Code.gs)                 | **Code.gs**                  |
| [Config.gs](Config.gs)             | **Config.gs**                |
| [Index.html](Index.html)           | **Index.html**               |
| [appsscript.json](appsscript.json) | **appsscript.json**          |

If the manifest is hidden, open **Project settings** using the gear in the left sidebar, enable **Show "appsscript.json" manifest file in editor**, and return to the **Editor**. Do not paste personal settings into the files; keep those in Profile & settings.

After replacing the files, continue with **Deploy → Manage deployments → pencil → New version → Deploy**, then reload your app.

## Start another year

Repeat the setup with a **fresh copy of the empty shared template**, a new private app deployment, and the new year. The app code comes with the new copy, so no code copying is needed. Keep the earlier workbook and app for historical records. Transactions, custom descriptions, payment accounts/apps, expense groups, and review statuses are not copied forward automatically.

## If something goes wrong

| Problem                                            | What to try                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cannot copy the template                           | Sign in to Google. If access is restricted, ask the template owner.                                                                                                      |
| Apps Script or Extensions is missing on your phone | Use a computer browser for setup.                                                                                                                                        |
| Google blocks authorization                        | Check that you are using your own copied project and the same Google account. For a work/school account, ask your administrator; do not bypass an administrator’s block. |
| The welcome screen rejects the URL                 | Paste your copied **Google Sheet URL**, not the shared template URL or web app URL. A blank sheet alone is not compatible.                                               |
| App is blank or missing new features               | Reload your `/exec` URL first. For an older copy, follow [Update your app](#update-your-app), including deployment of a **New version**.                                 |
| Saved entry seems missing                          | Check its recorded date, journal type, active filters, and page. Then Refresh.                                                                                           |
| Sheet changed while saving                         | Refresh before retrying. Another open tab or direct sheet edit may have changed the record.                                                                              |
| Save/delete result is uncertain                    | Refresh and check whether the action already happened before starting a new attempt.                                                                                     |
| App opens an access error                          | Use the Google account that owns that copy. Keep the deployment set to **Me / Only myself**.                                                                             |

Keep your own workbook private. To invite someone else to use Kashlo, share the [GitHub repository](https://github.com/deepukv97/kashlo) and the empty template—not your financial workbook or private app.

For developers and custom workbook layouts, see [DEVELOPMENT.md](DEVELOPMENT.md). Google’s references: [web app deployment](https://developers.google.com/apps-script/guides/web), [copied bound scripts](https://developers.google.com/apps-script/guides/bound), and [updating deployments](https://developers.google.com/apps-script/concepts/deployments).
