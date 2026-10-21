# Kashlo

**Your money. Your flow.**

Track your expenses, income, and investment contributions in a private app backed by your own Google Sheet. Use expense groups for a trip, wedding, home project, or another shared purpose.

## Start here

You need a Google account and a computer browser for setup. After setup, you can use Kashlo on your phone or computer.

1. Copy the [Kashlo — Personal Finances workbook](https://docs.google.com/spreadsheets/d/1DUx9pc11orQe0zhirA-l80z3VWRYEyGoILiw7znh77s/edit) into **your own Google Drive**.
2. Open **Extensions → Apps Script** in your copy. The app code is already included.
3. Deploy it as a private web app: **Execute as Me → Only myself**.
4. Open the app, paste **your copied sheet’s URL**, and complete the welcome screen.
5. Bookmark your app and add your first transaction.

**[Follow the step-by-step setup guide →](SETUP.md)**

No programming, code copying, or software installation is needed for first-time setup. The guide explains deployment, Google’s authorization screen, and which URL goes where. Each person sets up their own workbook and private app. Share this repository and the empty template with friends.

## What you can do

| Page                   | Use it to                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **Overview**           | See income, spending, investments, surplus/shortfall, and recent activity.                               |
| **Transactions**       | Find records using search, month/quarter/year/custom dates, category, payment method, and expense group. |
| **Investments**        | Track contributions separately from expenses.                                                            |
| **Dashboards**         | Explore expense groups, spending insights, and cash flow.                                                |
| **Review**             | Check possible duplicates and mark each month complete.                                                  |
| **Manage**             | Add descriptions, categories, payment types, and bank/card/UPI names.                                    |
| **Profile & settings** | Update your name, workspace label, and display preferences.                                              |

Add, edit, and delete transactions from the app. Payment tracking is optional for expenses and investments; income has no payment fields. Kashlo asks only for payment names, never card numbers or CVVs.

On a phone, open the menu beside the logo to change pages. Tap **Details** on a transaction card for more information and available actions. Pull down from the top to refresh sheet data.

**[Read the everyday-use guide →](SETUP.md#use-kashlo)** — includes custom-calendar checkmarks, payment choices, expense groups, bulk duplicate review, and month completeness.

## Before you start

- **One workbook and one private app per calendar year.** Choose the year during setup. Start another year with a fresh template copy.
- **Your data stays in your own workbook.** Keep the workbook private and the app set to **Only myself**.
- **Updates are manual.** Existing copies do not update when GitHub changes. Follow [Update your app](SETUP.md#update-your-app).
- **Journals grow automatically** when you add transactions through Kashlo. The prepared template is required; an empty Google Sheet alone will not work.
- **Surplus is recorded income minus expenses and investment contributions.** It is not your bank balance. Investment totals are contributions, not portfolio value or returns.

## For developers

See [DEVELOPMENT.md](DEVELOPMENT.md) for workbook layout, formula maintenance, configuration, deployment tools, and validation details.

Run the regression checks with Node.js:

```sh
node --test tests/config.test.cjs
```
