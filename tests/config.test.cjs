// Run with: node --test tests/config.test.cjs
// Exercise real server/client functions with in-memory Apps Script and DOM adapters.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const configSource = fs.readFileSync("Config.gs", "utf8");
const serverSource = fs.readFileSync("Code.gs", "utf8");
const browserSource = fs
  .readFileSync("Index.html", "utf8")
  .match(/<script>\s*([\s\S]*?)<\/script>/)[1];

class Sheet {
  constructor() {
    this.cells = Array.from({ length: 30 }, () => Array(30).fill(""));
    this.copies = [];
    this.validations = new Map();
    this.operations = [];
  }
  getMaxRows() {
    return this.cells.length;
  }
  getRange(row, col, height = 1, width = 1) {
    const values = () =>
      Array.from({ length: height }, (_, r) =>
        Array.from(
          { length: width },
          (_, c) => this.cells[row - 1 + r][col - 1 + c],
        ),
      );
    const range = {
      row,
      col,
      height,
      width,
      getValues: values,
      getDataValidations: () =>
        Array.from({ length: height }, (_, r) =>
          Array.from(
            { length: width },
            (_, c) => this.validations.get(`${row + r}:${col + c}`) || null,
          ),
        ),
      setDataValidations: (rules) => {
        rules.forEach((line, r) =>
          line.forEach((rule, c) =>
            this.validations.set(`${row + r}:${col + c}`, rule),
          ),
        );
        this.copies.push({ type: "PASTE_DATA_VALIDATION" });
        return range;
      },
      copyFormatToRange: () => this.copies.push({ type: "PASTE_FORMAT" }),
      autoFill: (destination) =>
        range.copyTo({ ...destination, repeat: true }, "PASTE_FORMULA"),
      getA1Notation: () => {
        const column = (n) => {
          let text = "";
          while (n) {
            n--;
            text = String.fromCharCode(65 + (n % 26)) + text;
            n = Math.floor(n / 26);
          }
          return text;
        };
        return (
          column(col) +
          row +
          (height === 1 && width === 1
            ? ""
            : ":" + column(col + width - 1) + (row + height - 1))
        );
      },
      getFormula: () => range.getFormulas()[0][0],
      setFormula: (formula) => range.setValue(formula),
      getFormulas: () =>
        values().map((row) =>
          row.map((value) =>
            typeof value === "string" && value.startsWith("=") ? value : "",
          ),
        ),
      getDisplayValues: () => values().map((r) => r.map(String)),
      setValue: (value) => {
        this.cells[row - 1][col - 1] = value;
        return range;
      },
      setRichTextValue: (value) => range.setValue(value),
      setRichTextValues: (matrix) => {
        this.operations.push({ kind: "richText", row, col, height, width });
        matrix.forEach((line, r) =>
          line.forEach((value, c) => {
            this.cells[row - 1 + r][col - 1 + c] = value;
          }),
        );
        return range;
      },
      setNumberFormat: () => range,
      setWrap: () => range,
      sort: (specs) => {
        const entries = this.cells
          .slice(row - 1, row - 1 + height)
          .map((r) => r.slice(col - 1, col - 1 + width));
        entries.sort((a, b) => {
          for (const spec of specs) {
            const index = spec.column - col;
            const compared = String(a[index]).localeCompare(String(b[index]));
            if (compared) return spec.ascending ? compared : -compared;
          }
          return 0;
        });
        entries.forEach((r, i) =>
          r.forEach((v, j) => {
            this.cells[row - 1 + i][col - 1 + j] = v;
          }),
        );
        return range;
      },
      setBackground: () => range,
      setFontColor: () => range,
      setFontWeight: () => range,
      clearContent: () => {
        for (let r = 0; r < height; r++)
          for (let c = 0; c < width; c++)
            this.cells[row - 1 + r][col - 1 + c] = "";
        return range;
      },
      copyTo: (destination, type) => {
        this.copies.push({ row, col, height, width, destination, type });
        if (type !== "PASTE_FORMULA") return;
        const source = values();
        for (
          let r = 0;
          r < (destination.repeat ? destination.height : height);
          r++
        )
          for (
            let c = 0;
            c < (destination.repeat ? destination.width : width);
            c++
          ) {
            const formula = source[r % height][c % width];
            if (typeof formula !== "string" || !formula.startsWith("="))
              continue;
            const dr = destination.row + r - (row + (r % height)),
              dc = destination.col + c - (col + (c % width));
            this.cells[destination.row - 1 + r][destination.col - 1 + c] =
              formula.replace(
                /(\$?)([A-Z]+)(\$?)(\d+)/g,
                (_, absCol, letters, absRow, number) => {
                  let n =
                      [...letters].reduce(
                        (v, x) => v * 26 + x.charCodeAt(0) - 64,
                        0,
                      ) + (absCol ? 0 : dc),
                    label = "";
                  while (n > 0) {
                    n--;
                    label = String.fromCharCode(65 + (n % 26)) + label;
                    n = Math.floor(n / 26);
                  }
                  return (
                    absCol +
                    label +
                    absRow +
                    (Number(number) + (absRow ? 0 : dr))
                  );
                },
              );
          }
      },
    };
    return range;
  }
  getRangeList(addresses) {
    this.operations.push({ kind: "rangeList", addresses: [...addresses] });
    return {
      setValue: (value) => {
        this.operations.push({
          kind: "rangeListWrite",
          value,
          addresses: [...addresses],
        });
        for (const address of addresses) {
          const match = address.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
          assert.ok(match, address);
          const col = [...match[1]].reduce(
            (n, char) => n * 26 + char.charCodeAt(0) - 64,
            0,
          );
          assert.equal(match[1], match[3]);
          for (let row = Number(match[2]); row <= Number(match[4]); row++)
            this.cells[row - 1][col - 1] = value;
        }
      },
    };
  }
  deleteRows(row, count) {
    this.operations.push({ kind: "deleteRows", row, count });
    this.cells.splice(row - 1, count);
  }
  deleteRow(row) {
    this.cells.splice(row - 1, 1);
  }
  getMaxColumns() {
    return this.cells[0].length;
  }
  insertColumnsAfter(after, count) {
    this.cells.forEach((row) => row.splice(after, 0, ...Array(count).fill("")));
  }
  insertRowsAfter(after, count = 1) {
    this.cells.splice(
      after,
      0,
      ...Array.from({ length: count }, () =>
        Array(this.getMaxColumns()).fill(""),
      ),
    );
  }
  autoResizeRows() {}
  setColumnWidth() {}
  setFrozenRows() {}
}

function fixture(overrides = {}) {
  const configContext = vm.createContext({});
  vm.runInContext(configSource, configContext);
  const config = JSON.parse(
    vm.runInContext("JSON.stringify(FINANCE)", configContext),
  );
  // A connected fixture has saved profile settings; product Config.gs contains no personal data.
  Object.assign(config, {
    year: 2026,
    spreadsheetId: "test-workbook-000000000000000000",
    ownerEmail: "owner@example.test",
  });
  Object.assign(config.display, {
    ownerName: "Test Owner",
    ownerInitials: "TO",
    locale: "en-IN",
    currency: "INR",
  });
  overrides.apply?.(config);
  const sheets = {};
  const resolve = (name) => name.replace(/\{year\}/g, String(config.year));
  for (const name of [
    ...Object.values(config.sheets),
    ...Object.values(config.lookupSheets),
    config.dashboardSheet,
    config.groupSummarySheet,
  ])
    sheets[resolve(name)] = new Sheet();
  const journal = config.layout.journal,
    lookup = config.layout.lookup;
  for (const name of Object.values(config.lookupSheets)) {
    const sheet = sheets[resolve(name)];
    sheet
      .getRange(lookup.firstDataRow, lookup.description)
      .setValue("Known item");
    const category =
      name === config.lookupSheets.investment
        ? config.categories.investment
        : "Food";
    sheet.getRange(lookup.firstDataRow, lookup.category).setValue(category);
    sheet
      .getRange(lookup.firstDataRow, lookup.categoryOptions)
      .setValue(category);
    sheet
      .getRange(lookup.firstDataRow, lookup.trips)
      .setValue(config.year + " Holiday");
  }
  const expense = sheets[resolve(config.sheets.expense)];
  for (const [key, value] of Object.entries({
    description: "Known item",
    amount: 50,
    date: new Date(Date.UTC(config.year, 0, 4)),
    category: "Food",
    trip: config.year + " Holiday",
    duplicateIssue: "Possible duplicate",
  }))
    expense.getRange(journal.firstDataRow, journal[key]).setValue(value);
  const properties = {
    "kashlo:workspace:v1": JSON.stringify({
      year: config.year,
      spreadsheetId: config.spreadsheetId,
      ownerEmail: config.ownerEmail,
      ...config.display,
      timeZone: "Asia/Kolkata",
      revision: 1,
    }),
  };
  let zone = "Asia/Kolkata";
  let activeEmail = config.ownerEmail,
    lockCount = 0;
  const book = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => (sheets[name] = new Sheet()),
    getSpreadsheetTimeZone: () => zone,
    setSpreadsheetTimeZone: (value) => {
      zone = value;
    },
    getUrl: () => "https://example.test/workbook",
  };
  const books = new Map([[config.spreadsheetId, book]]);
  const sandbox = {
    Date,
    console,
    Session: {
      getEffectiveUser: () => ({ getEmail: () => config.ownerEmail }),
      getActiveUser: () => ({ getEmail: () => activeEmail }),
    },
    SpreadsheetApp: {
      AutoFillSeries: { DEFAULT_SERIES: "DEFAULT_SERIES" },
      CopyPasteType: {
        PASTE_FORMAT: "PASTE_FORMAT",
        PASTE_DATA_VALIDATION: "PASTE_DATA_VALIDATION",
        PASTE_FORMULA: "PASTE_FORMULA",
      },
      openById: (id) => {
        if (!books.has(id)) throw new Error("Workbook unavailable");
        return books.get(id);
      },
      flush() {},
      newRichTextValue: () => ({
        setText(value) {
          this.value = value;
          return this;
        },
        build() {
          return this.value;
        },
      }),
    },
    Utilities: {
      formatDate: (date, timeZone = "Asia/Kolkata") =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(date),
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_, value) =>
        crypto.createHash("sha256").update(value).digest(),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url"),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key],
        setProperty: (key, value) => {
          properties[key] = value;
        },
        getProperties: () => ({ ...properties }),
        deleteProperty: (key) => {
          delete properties[key];
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: (timeout) => {
          assert.equal(timeout, config.limits.writeLockTimeoutMs);
          lockCount++;
        },
        releaseLock: () => {
          lockCount--;
        },
      }),
    },
  };
  const context = vm.createContext(sandbox);
  // Deliberately evaluate Code.gs first to catch cross-file initialization dependencies.
  vm.runInContext(serverSource, context);
  vm.runInContext("const FINANCE = " + JSON.stringify(config), context);
  return {
    config,
    context: new Proxy(context, {
      get(target, key) {
        const value = target[key];
        const writes = [
          "addTransaction",
          "updateTransaction",
          "deleteTransaction",
          "setReview",
          "bulkReview",
          "setMonthStatus",
          "createExpenseGroup",
          "managePaymentOption",
          "addPaymentType",
          "addLookupOption",
        ];
        if (writes.includes(key))
          return (input) =>
            value(
              input && {
                ...input,
                workspaceRevision:
                  input.workspaceRevision ??
                  JSON.parse(properties["kashlo:workspace:v1"] || "{}")
                    .revision,
              },
            );
        return value;
      },
    }),
    rawContext: context,
    properties,
    books,
    book,
    clearSetup: () => {
      delete properties["kashlo:workspace:v1"];
      vm.runInContext("workspaceConfigCache_ = null", context);
    },
    sheets,
    expense,
    resolve,
    setActiveEmail: (value) => {
      activeEmail = value;
    },
    getLockCount: () => lockCount,
  };
}

for (const year of [2026, 2027, 2028]) {
  test(`configured ${year} workbook: reads, dates, writes, retries, and reviews`, () => {
    const f = fixture({
      apply(config) {
        config.year = year;
        config.ownerEmail = "new.owner@example.test";
        config.spreadsheetId = "different-workbook";
        config.display.ownerName = "New Owner";
        config.sheets.income = "Salary {year}";
        config.lookupSheets.income = "Income sources";
        config.categories.investment = "Long term savings";
      },
    });
    const api = f.context,
      c = f.config;
    const data = api.getData();
    assert.equal(data.year, year);
    assert.equal(data.config.ownerName, "New Owner");
    assert.equal(data.transactions[0].date, `${year}-01-04`);
    assert.equal(data.transactions[0].issues[0], "Possible duplicate");
    assert.equal(data.categories.investment[0], "Long term savings");
    assert.equal("ownerEmail" in data.config, false);
    assert.equal("spreadsheetId" in data.config, false);
    assert.throws(() => api.dateSerial_(`${year - 1}-01-01`), /Choose a date/);
    assert.throws(() => api.dateSerial_(`${year}-02-30`), /Invalid date/);
    if (year === 2028) assert.ok(api.dateSerial_("2028-02-29") > 0);
    else assert.throws(() => api.dateSerial_(`${year}-02-29`), /Invalid date/);
    const input = {
      requestId: `expense_request_${year}`,
      type: "expense",
      description: "New item",
      amount: 125,
      date: `${year}-02-01`,
      category: "Food",
      notes: "=not a formula",
      trip: `${year} Holiday`,
    };
    const saved = api.addTransaction(input);
    assert.equal(saved.row, 3);
    assert.equal(
      f.expense.cells[2][c.layout.journal.notes - 1],
      "=not a formula",
    );
    assert.equal(api.addTransaction(input).row, 3);
    assert.equal(api.getData().transactions.length, 2);
    assert.equal(api.getData().mappings.expense.length, 2);
    const investment = api.addTransaction({
      ...input,
      requestId: `investment_request_${year}`,
      type: "investment",
      category: "",
    });
    assert.equal(
      f.sheets[f.resolve(c.sheets.investment)].cells[investment.row - 1][
        c.layout.journal.category - 1
      ],
      c.categories.investment,
    );
    api.addTransaction({
      ...input,
      requestId: `income_request_${year}`,
      type: "income",
      amount: -10,
      trip: "",
    });
    api.setReview({
      requestId: `review_request_${year}`,
      type: "expense",
      row: 2,
      fingerprint: data.transactions[0].fingerprint,
      decision: "Okay",
      note: "Expected",
    });
    assert.equal(api.getData().transactions[0].issues.length, 0);
    f.expense.getRange(2, c.layout.journal.amount).setValue(99);
    assert.throws(
      () =>
        api.setReview({
          requestId: `changed_review_${year}`,
          type: "expense",
          row: 2,
          fingerprint: data.transactions[0].fingerprint,
          decision: "Okay",
        }),
      /changed in the sheet/,
    );
    api.setMonthStatus({
      requestId: `month_request_${year}`,
      month: 12,
      status: "Complete",
    });
    assert.equal(api.getData().monthStatus[11], "Complete");
    assert.equal(f.getLockCount(), 0);
    f.setActiveEmail("someone.else@example.test");
    assert.throws(() => api.getData(), /private to the owner/);
  });
}

test("configured worksheet coordinates control reads and writes", () => {
  const f = fixture({
    apply(c) {
      Object.assign(c.layout.journal, {
        firstDataRow: 4,
        description: 4,
        amount: 5,
        date: 10,
        category: 11,
        notes: 12,
        trip: 13,
        duplicateIssue: 22,
        otherIssues: [23, 24],
        decision: 25,
        reviewNote: 26,
        fingerprintColumns: [4, 5, 10, 11, 12, 13],
      });
      Object.assign(c.layout.lookup, {
        firstDataRow: 3,
        description: 2,
        category: 3,
        categoryOptions: 5,
        trips: 9,
      });
      Object.assign(c.layout.dashboard, { firstMonthRow: 5, statusColumn: 7 });
    },
  });
  const api = f.context;
  const data = api.getData();
  assert.equal(data.transactions[0].row, 4);
  const result = api.addTransaction({
    requestId: "moved_columns_request",
    type: "expense",
    description: "New item",
    amount: 7,
    date: "2026-01-01",
    category: "Food",
  });
  assert.equal(result.row, 5);
  assert.equal(f.expense.cells[4][3], "New item");
  api.setReview({
    requestId: "moved_review_request",
    type: "expense",
    row: 4,
    fingerprint: data.transactions[0].fingerprint,
    decision: "Okay",
    note: "Checked",
  });
  assert.equal(f.expense.cells[3][25], "Checked");
  api.setMonthStatus({
    requestId: "moved_status_request",
    month: 1,
    status: "Complete",
  });
  assert.equal(api.getData().monthStatus[0], "Complete");
});

test("browser uses configured year, profile, currency, dates, and investment category", async () => {
  const f = fixture({
    apply(c) {
      c.year = 2027;
      c.display.ownerName = "Another Owner";
      c.display.currency = "USD";
      c.display.locale = "en-US";
      c.categories.investment = "Savings";
    },
  });
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: selector === "#entryType" ? "investment" : "",
        innerHTML: "",
        textContent: "",
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute(name, value) {
          this[name] = value;
        },
        focus() {},
      });
    return elements.get(selector);
  };
  const browser = vm.createContext({
    console,
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    window: {},
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  });
  // Run the entire initialization path to check that the disconnected preview still works.
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element("#monthSelect").disabled, true);
  browser.data = JSON.parse(JSON.stringify(f.context.getData()));
  // Exercise the RPC refresh path, including first-load month selection.
  const runner = {
    withSuccessHandler(handler) {
      this.success = handler;
      return this;
    },
    withFailureHandler() {
      return this;
    },
    getData() {
      browser.data = JSON.parse(JSON.stringify(f.context.getData()));
      this.success(browser.data);
    },
    updateTransaction(input) {
      this.success(f.context.updateTransaction(input));
    },
    deleteTransaction(input) {
      this.success(f.context.deleteTransaction(input));
    },
  };
  browser.google = { script: { run: runner } };
  browser.window.google = browser.google;
  await vm.runInContext("refresh()", browser);
  assert.equal(
    vm.runInContext("state.month", browser),
    Number(browser.data.config.defaultDate.slice(5, 7)) - 1,
  );
  vm.runInContext("state.month = 0; render();", browser);
  assert.equal(element("#ownerName").textContent, "Another Owner");
  assert.match(element("#monthSelect").innerHTML, /January 2027/);
  assert.match(element("#content").innerHTML, /2027/);
  assert.equal(vm.runInContext('monthly("expense").length', browser), 1);
  assert.equal(vm.runInContext("money(123)", browser), "$123.00");
  vm.runInContext('state.view = "investments"; openEntry()', browser);
  assert.equal(element("#entryDate").min, "2027-01-01");
  assert.equal(element("#entryDate").max, "2027-12-31");
  assert.equal(element("#entryDate").value, "");
  assert.equal(element("#entryCategory").value, "Savings");
  const transaction = browser.data.transactions[0];
  browser.transaction = transaction;
  vm.runInContext("openEntry(transaction)", browser);
  assert.equal(element("#entryType").disabled, true);
  assert.equal(element("#entryDescription").value, transaction.description);
  assert.equal(element("#entryDate").value, transaction.date);
  element("#entryAmount").value = "90";
  element("#entryPaymentMethod").value = "Cash";
  await element("#entryForm").onsubmit({ preventDefault() {} });
  assert.equal(f.context.getData().transactions[0].amount, 90);
  browser.transaction = browser.data.transactions[0];
  vm.runInContext("openDelete(transaction)", browser);
  assert.match(element("#modalContainer").innerHTML, /Delete this transaction/);
  // Opening and canceling confirmation must not remove anything.
  element("#cancelDelete").onclick();
  assert.equal(f.context.getData().transactions.length, 1);
  vm.runInContext("openDelete(transaction)", browser);
  await element("#confirmDelete").onclick();
  assert.equal(f.context.getData().transactions.length, 0);
  for (const view of [
    "overview",
    "transactions",
    "investments",
    "trips",
    "review",
  ])
    vm.runInContext(`navigate(${JSON.stringify(view)})`, browser);
});

for (const type of ["expense", "income", "investment"]) {
  test(`${type}: delete the actual row, preserve the remaining entry, and retry safely`, () => {
    const f = fixture(),
      api = f.context,
      c = f.config.layout.journal;
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    if (type !== "expense") sheet.cells[1] = [...f.expense.cells[1]];
    // Identical neighboring values must not allow a stale view to delete the shifted entry.
    sheet.cells[1][0] = "=ROW()";
    sheet.cells[1][3] = "=MONTH(F2)";
    sheet.cells[2] = [...sheet.cells[1]];
    const before = api
      .getData()
      .transactions.find((t) => t.type === type && t.row === 2);
    const neighbor = [...sheet.cells[2]];
    const shifted = api
      .getData()
      .transactions.find((t) => t.type === type && t.row === 3);
    const input = {
      requestId: `delete_duplicate_${type}`,
      type,
      row: 2,
      fingerprint: before.fingerprint,
      confirmed: true,
    };
    assert.throws(
      () => api.deleteTransaction({ ...input, confirmed: false }),
      /Confirm/,
    );
    assert.throws(
      () =>
        api.deleteTransaction({
          ...input,
          requestId: `stale_delete_${type}`,
          fingerprint: "stale",
        }),
      /changed/,
    );
    assert.equal(sheet.cells[1][c.amount - 1], 50);
    api.deleteTransaction(input);
    assert.equal(sheet.getMaxRows(), 29);
    assert.deepEqual(sheet.cells[1], neighbor);
    api.deleteTransaction(input);
    assert.equal(sheet.getMaxRows(), 29);
    assert.deepEqual(sheet.cells[1], neighbor);
    // The old fingerprint must fail even though the newly shifted row is identical.
    assert.throws(
      () =>
        api.deleteTransaction({ ...input, requestId: `second_delete_${type}` }),
      /changed/,
    );
    assert.throws(
      () =>
        api.updateTransaction({
          ...input,
          requestId: `shifted_edit_${type}`,
          amount: 999,
        }),
      /changed/,
    );
    assert.throws(
      () =>
        api.setReview({
          ...input,
          requestId: `shifted_review_${type}`,
          decision: "Okay",
        }),
      /changed/,
    );
    assert.throws(
      () =>
        api.deleteTransaction({
          ...input,
          requestId: `old_neighbor_${type}`,
          row: shifted.row,
          fingerprint: shifted.fingerprint,
        }),
      /changed/,
    );
    assert.equal(
      api.getData().transactions.filter((t) => t.type === type).length,
      1,
    );
    f.setActiveEmail("unauthorized@example.test");
    assert.throws(
      () =>
        api.deleteTransaction({
          ...input,
          requestId: `unauthorized_delete_${type}`,
        }),
      /private/,
    );
    assert.equal(f.getLockCount(), 0);
  });
}

test("corrections validate fields, preserve other rows and formulas, reset review, and reject stale writes", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal;
  f.expense.cells[1][3] = "=MONTH(F2)";
  f.expense.cells[1][c.decision - 1] = "Okay";
  f.expense.cells[1][c.reviewNote - 1] = "Keep this review note";
  const before = api.getData().transactions[0];
  const input = {
    requestId: "correct_transaction_request",
    type: "expense",
    row: before.row,
    fingerprint: before.fingerprint,
    description: "Corrected item",
    amount: 75,
    date: "2026-02-05",
    category: "Food",
    trip: "2026 Holiday",
    notes: "=literal text",
  };
  assert.throws(
    () =>
      api.updateTransaction({
        ...input,
        requestId: "invalid_correction_request",
        amount: -1,
      }),
    /positive/,
  );
  assert.equal(f.expense.cells[1][c.amount - 1], 50);
  const neighbor = [...f.expense.cells[2]];
  api.updateTransaction(input);
  api.updateTransaction(input);
  const after = api.getData().transactions[0];
  assert.equal(after.row, before.row);
  assert.equal(after.amount, 75);
  assert.equal(after.description, "Corrected item");
  assert.equal(after.date, "2026-02-05");
  assert.equal(after.notes, "=literal text");
  assert.equal(after.decision, "Pending");
  assert.equal(after.reviewNote, "Keep this review note");
  assert.equal(f.expense.cells[1][3], "=MONTH(F2)");
  assert.deepEqual(f.expense.cells[2], neighbor);
  assert.throws(
    () =>
      api.updateTransaction({
        ...input,
        requestId: "stale_correction_request",
      }),
    /changed/,
  );
  f.setActiveEmail("unauthorized@example.test");
  assert.throws(
    () =>
      api.updateTransaction({
        ...input,
        requestId: "unauthorized_correction_request",
      }),
    /private/,
  );
  assert.equal(f.getLockCount(), 0);
});

test("review groups duplicates together and all action buttons target the displayed transaction", async () => {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key))
      elements.set(key, {
        value: key,
        innerHTML: "",
        textContent: "",
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute(name, value) {
          this[name] = value;
        },
        focus() {},
      });
    return elements.get(key);
  };
  const buttons = Object.fromEntries(
    ["okay", "correct", "delete"].map((action) => [
      action,
      Array.from({ length: 4 }, (_, i) => ({
        dataset: { [action]: String(i) },
      })),
    ]),
  );
  const browser = vm.createContext({
    console,
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    window: {},
    document: {
      querySelector: element,
      querySelectorAll: (selector) => {
        const action = selector.match(/^\[data-(okay|correct|delete)\]$/)?.[1];
        return action ? buttons[action] : [];
      },
      addEventListener() {},
    },
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  const record = (description, row, amount) => ({
    type: "investment",
    description,
    row,
    amount,
    date: "2026-01-01",
    category: "Investments",
    issues: ["Possible duplicate"],
    reviewNote: "",
    fingerprint: `fingerprint-${row}`,
    duplicateGroup: description.trim().toLowerCase(),
  });
  browser.data = {
    config: { year: 2026, locale: "en-IN", currency: "INR", monthStatuses: [] },
    transactions: [
      record("Gold", 2, 4000),
      record("BitSave", 3, 1000),
      record("BitSave", 5, 1000),
      record(" gold ", 6, 4000),
    ],
  };
  vm.runInContext(
    'state.data = data; state.view = "review"; render();',
    browser,
  );
  assert.deepEqual(
    Array.from(vm.runInContext("reviewRows().map(t => t.row)", browser)),
    [3, 5, 2, 6],
  );
  const html = element("#content").innerHTML;
  assert.ok(html.indexOf("row 3") < html.indexOf("row 5"));
  assert.ok(html.indexOf("row 5") < html.indexOf("row 2"));
  assert.ok(html.indexOf("row 2") < html.indexOf("row 6"));
  vm.runInContext(
    "openEntry = t => { selected = t; }; openDelete = t => { selected = t; }; rpc = async (name, payload) => { captured = {name, payload}; }; refresh = async () => {};",
    browser,
  );
  const expected = [3, 5, 2, 6];
  for (let i = 0; i < expected.length; i++) {
    buttons.correct[i].onclick();
    assert.equal(browser.selected.row, expected[i]);
    buttons.delete[i].onclick();
    assert.equal(browser.selected.row, expected[i]);
    await buttons.okay[i].onclick();
    assert.equal(browser.captured.payload.row, expected[i]);
    assert.equal(
      browser.captured.payload.fingerprint,
      `fingerprint-${expected[i]}`,
    );
    assert.equal(browser.captured.payload.note, `#note_${i}`);
    assert.deepEqual(
      Array.from(browser.captured.payload.entries, (entry) => entry.row),
      i < 2 ? [3, 5] : [2, 6],
    );
  }
  assert.deepEqual(
    browser.data.transactions.map((t) => t.row),
    [2, 3, 5, 6],
  );
});

for (const type of ["expense", "income", "investment"]) {
  test(`${type}: Okay accepts all exact duplicates without changing totals or unrelated entries`, () => {
    const f = fixture(),
      api = f.context,
      c = f.config.layout.journal;
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    if (type !== "expense") sheet.cells[1] = [...f.expense.cells[1]];
    sheet.cells[2] = [...sheet.cells[1]];
    sheet.cells[2][c.reviewNote - 1] = "Preserve the other note";
    sheet.cells[3] = [...sheet.cells[1]];
    sheet.cells[3][c.amount - 1] = 100;
    sheet.cells[4] = [...sheet.cells[1]];
    sheet.cells[4][c.date - 1] = new Date(Date.UTC(2026, 0, 5));
    const before = api.getData().transactions.filter((t) => t.type === type);
    const selected = before[0];
    const entries = before
      .filter((t) => t.duplicateGroup === selected.duplicateGroup)
      .map((t) => ({ row: t.row, fingerprint: t.fingerprint }));
    const input = {
      type,
      row: selected.row,
      fingerprint: selected.fingerprint,
      entries,
      requestId: `accept_exact_group_${type}`,
      decision: "Okay",
      note: "Both payments are valid",
    };
    assert.deepEqual(Array.from(api.setReview(input).reviewedRows), [2, 3]);
    api.setReview(input);
    const after = api.getData().transactions.filter((t) => t.type === type);
    assert.equal(after.filter((t) => t.issues.length).length, 2);
    assert.equal(after[1].reviewNote, "Preserve the other note");
    assert.equal(after[0].reviewNote, "Both payments are valid");
    assert.deepEqual(
      Array.from(after, (t) => t.amount),
      Array.from(before, (t) => t.amount),
    );
    assert.equal(sheet.cells[3][c.decision - 1], "");
    assert.equal(sheet.cells[4][c.decision - 1], "");
  });
}

test("investments use exact groups rather than monthly description rules and preserve other issues", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal;
  const sheet = f.sheets[f.resolve(f.config.sheets.investment)];
  for (let i = 1; i <= 5; i++) sheet.cells[i] = [...f.expense.cells[1]];
  for (const [row, description, day, month, amount] of [
    [2, "Gold", 1, 0, 4000],
    [3, "Gold", 20, 0, 5000],
    [4, "BitSave", 1, 0, 1000],
    [5, "Gold", 1, 1, 4000],
    [6, " Gold ", 1, 0, 4000],
  ]) {
    sheet.cells[row - 1][c.description - 1] = description;
    sheet.cells[row - 1][c.date - 1] = new Date(Date.UTC(2026, month, day));
    sheet.cells[row - 1][c.amount - 1] = amount;
  }
  sheet.cells[2][c.otherIssues[0] - 1] = "Missing category";
  const records = api
    .getData()
    .transactions.filter((t) => t.type === "investment");
  const clicked = records[0];
  const entries = records
    .filter((t) => t.duplicateGroup === clicked.duplicateGroup)
    .map((t) => ({ row: t.row, fingerprint: t.fingerprint }));
  api.setReview({
    type: "investment",
    row: 2,
    fingerprint: clicked.fingerprint,
    entries,
    requestId: "accept_exact_investment_group",
    decision: "Okay",
  });
  const after = api
    .getData()
    .transactions.filter((t) => t.type === "investment");
  assert.equal(after[0].issues.length, 0);
  assert.deepEqual(Array.from(after[1].issues), [
    "Possible duplicate",
    "Missing category",
  ]);
  assert.equal(after[1].decision, "Pending");
  assert.equal(after[4].decision, "Okay");
  assert.equal(after[2].decision, "Pending");
  assert.equal(after[3].decision, "Pending");
  assert.deepEqual(
    Array.from(after, (t) => t.amount),
    [4000, 5000, 1000, 4000, 4000],
  );
});

test("changed duplicate group is rejected before any review decisions are written", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal;
  f.expense.cells[2] = [...f.expense.cells[1]];
  const before = api.getData().transactions;
  const input = {
    type: "expense",
    row: 2,
    fingerprint: before[0].fingerprint,
    entries: before.map((t) => ({ row: t.row, fingerprint: t.fingerprint })),
    requestId: "stale_group_acceptance",
    decision: "Okay",
  };
  f.expense.cells[2][c.amount - 1] = 99;
  assert.throws(() => api.setReview(input), /group changed/);
  assert.equal(f.expense.cells[1][c.decision - 1], "");
  assert.equal(f.expense.cells[2][c.decision - 1], "");
  f.expense.cells[2][c.amount - 1] = 50;
  f.expense.cells[3] = [...f.expense.cells[1]];
  assert.throws(
    () => api.setReview({ ...input, requestId: "new_member_acceptance" }),
    /group changed/,
  );
  assert.equal(f.expense.cells[1][c.decision - 1], "");
});

test("new transactions require an explicitly selected date before any cells are written", () => {
  const f = fixture(),
    api = f.context;
  const before = JSON.stringify(f.expense.cells);
  assert.throws(
    () =>
      api.addTransaction({
        requestId: "blank_date_submission",
        type: "expense",
        description: "New item",
        amount: 20,
        category: "Food",
        date: "",
      }),
    /Choose a date/,
  );
  assert.equal(JSON.stringify(f.expense.cells), before);
  assert.match(browserSource, /id="entryDate" type="date" required/);
});

test("Overview, Transactions, and Investments edit and delete the selected journal row with confirmation and cancel", async () => {
  const f = fixture(),
    c = f.config.layout.journal;
  // All journals deliberately share row 2, so a row number alone cannot identify an entry.
  for (const type of ["income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    sheet.cells[1] = [...f.expense.cells[1]];
    sheet.cells[1][c.description - 1] =
      type === "income" ? "Salary" : "Savings";
    sheet.cells[1][c.duplicateIssue - 1] = "";
    if (type === "investment")
      sheet.cells[1][c.category - 1] = f.config.categories.investment;
  }
  f.expense.cells[1][c.duplicateIssue - 1] = "";
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: "",
        innerHTML: "",
        textContent: "",
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute(name, value) {
          this[name] = value;
        },
        focus() {},
      });
    return elements.get(selector);
  };
  let editButtons = [];
  let deleteButtons = [];
  const runner = {
    withSuccessHandler(handler) {
      this.success = handler;
      return this;
    },
    withFailureHandler(handler) {
      this.failure = handler;
      return this;
    },
    getData() {
      this.success(JSON.parse(JSON.stringify(f.context.getData())));
    },
    deleteTransaction(payload) {
      try {
        this.success(f.context.deleteTransaction(payload));
      } catch (error) {
        this.failure(error);
      }
    },
    updateTransaction(payload) {
      try {
        this.success(f.context.updateTransaction(payload));
      } catch (error) {
        this.failure(error);
      }
    },
  };
  const google = { script: { run: runner } };
  const browser = vm.createContext({
    console,
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    google,
    window: { google },
    document: {
      querySelector: element,
      querySelectorAll: (selector) => {
        if (selector === "[data-delete-row]") {
          deleteButtons = Array.from(
            element("#content").innerHTML.matchAll(
              /data-delete-type="([^"]+)" data-delete-row="(\d+)"/g,
            ),
            (match) => ({
              dataset: { deleteType: match[1], deleteRow: match[2] },
            }),
          );
          return deleteButtons;
        }
        if (selector !== "[data-edit-row]") return [];
        editButtons = Array.from(
          element("#content").innerHTML.matchAll(
            /data-edit-type="([^"]+)" data-edit-row="(\d+)"/g,
          ),
          (match) => ({ dataset: { editType: match[1], editRow: match[2] } }),
        );
        return editButtons;
      },
      addEventListener() {},
    },
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  for (const [view, type] of [
    ["overview", "expense"],
    ["transactions", "income"],
    ["investments", "investment"],
  ]) {
    vm.runInContext(
      `state.month = 0; navigate(${JSON.stringify(view)})`,
      browser,
    );
    assert.match(element("#content").innerHTML, /<th>Actions<\/th>/);
    const button = editButtons.find(
      (b) => b.dataset.editType === type && b.dataset.editRow === "2",
    );
    assert.ok(button, `${view} must show an Edit button for ${type} row 2`);
    const before = f.context
      .getData()
      .transactions.find((t) => t.type === type);
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    const original = JSON.stringify(sheet.cells);
    button.onclick();
    assert.equal(element("#entryTitle").textContent, "Edit transaction");
    assert.equal(element("#entryDescription").value, before.description);
    assert.equal(element("#entryDate").value, before.date);
    assert.equal(element("#entryAmount").value, before.amount);
    assert.equal(element("#entryType").value, type);
    assert.equal(element("#entryType").disabled, true);
    element("#cancelEntry").onclick();
    assert.equal(JSON.stringify(sheet.cells), original);
    button.onclick();
    element("#entryAmount").value = "77";
    element("#entryPaymentMethod").value = "Cash";
    await element("#entryForm").onsubmit({ preventDefault() {} });
    assert.equal(sheet.cells[1][c.amount - 1], 77);
    assert.equal(f.context.getData().transactions.length, 3);
    assert.equal(element("#modalContainer").innerHTML, "");
  }
  // Trip tables remain read-only; the requested pages opt into the Actions column.
  vm.runInContext(
    'state.view = "trips"; state.trip = "2026 Holiday"; render()',
    browser,
  );
  assert.equal(editButtons.length, 0);
  // Existing entries retain the same stale-write protection when edited outside Review.
  vm.runInContext('state.month = 0; navigate("transactions")', browser);
  editButtons.find((b) => b.dataset.editType === "expense").onclick();
  f.expense.cells[1][c.amount - 1] = 88;
  element("#entryAmount").value = "99";
  element("#entryPaymentMethod").value = "Cash";
  await element("#entryForm").onsubmit({ preventDefault() {} });
  assert.equal(f.expense.cells[1][c.amount - 1], 88);
  assert.match(element("#formError").textContent, /changed in the sheet/);
  element("#cancelEntry").onclick();
  await vm.runInContext("refresh()", browser);
  for (const [view, type] of [
    ["overview", "expense"],
    ["transactions", "income"],
    ["investments", "investment"],
  ]) {
    vm.runInContext(
      `state.month = 0; navigate(${JSON.stringify(view)})`,
      browser,
    );
    assert.match(
      element("#content").innerHTML,
      /Edit<\/button><button[^>]+data-delete-type=/,
    );
    const button = deleteButtons.find(
      (b) => b.dataset.deleteType === type && b.dataset.deleteRow === "2",
    );
    assert.ok(button, `${view} must show Delete for ${type} row 2`);
    const before = JSON.stringify(f.context.getData().transactions);
    button.onclick();
    assert.match(
      element("#modalContainer").innerHTML,
      /Delete this transaction\?/,
    );
    assert.match(
      element("#modalContainer").innerHTML,
      /This permanently removes the selected transaction from your journal and totals. Other entries are kept./,
    );
    assert.equal(JSON.stringify(f.context.getData().transactions), before);
    element("#cancelDelete").onclick();
    assert.equal(element("#modalContainer").innerHTML, "");
    assert.equal(JSON.stringify(f.context.getData().transactions), before);
    button.onclick();
    await element("#confirmDelete").onclick();
    assert.equal(
      f.context.getData().transactions.some((t) => t.type === type),
      false,
    );
    assert.equal(element("#modalContainer").innerHTML, "");
    assert.equal(
      deleteButtons.some((b) => b.dataset.deleteType === type),
      false,
    );
  }
  assert.equal(f.context.getData().transactions.length, 0);
});

test("expense groups create literal names, reuse existing names, validate inputs, and preserve old tags", () => {
  const f = fixture(),
    api = f.context;
  api.getData(); // Initialize additive payment headers before comparing journal cells.
  const before = JSON.stringify(f.expense.cells);
  const first = api.createExpenseGroup({
    name: " Wedding ",
    requestId: "create_wedding_group",
  });
  assert.equal(first.name, "Wedding");
  assert.equal(first.created, true);
  assert.equal(
    api.createExpenseGroup({
      name: "Wedding",
      requestId: "create_wedding_group",
    }).name,
    "Wedding",
  );
  const duplicate = api.createExpenseGroup({
    name: "wedding",
    requestId: "existing_wedding_group",
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.name, "Wedding");
  assert.equal(duplicate.groups.filter((name) => name === "Wedding").length, 1);
  api.createExpenseGroup({
    name: "House construction",
    requestId: "create_house_group",
  });
  const literal = "=SUM(A1:A9)";
  api.createExpenseGroup({ name: literal, requestId: "create_literal_group" });
  assert.ok(api.getData().trips.includes(literal));
  assert.ok(api.getData().trips.includes("2026 Holiday"));
  assert.equal(JSON.stringify(f.expense.cells), before);
  assert.throws(
    () =>
      api.createExpenseGroup({ name: " ", requestId: "empty_group_request" }),
    /group name/,
  );
  assert.throws(
    () =>
      api.createExpenseGroup({
        name: "x".repeat(101),
        requestId: "long_group_request",
      }),
    /group name/,
  );
  f.setActiveEmail("someone.else@example.test");
  assert.throws(
    () =>
      api.createExpenseGroup({
        name: "Private",
        requestId: "unauthorized_group_request",
      }),
    /private/,
  );
});

test("expense groups use configured lookup coordinates and expand master/summary capacity", () => {
  const f = fixture({
    apply(c) {
      c.layout.lookup.trips = 10;
      c.groupSummarySheet = "Projects {year}";
    },
  });
  const lookup = f.sheets[f.resolve(f.config.lookupSheets.expense)];
  const column = f.config.layout.lookup.trips;
  lookup.cells[lookup.cells.length - 1][column - 1] = "Last prepared group";
  const summary = f.sheets[f.resolve(f.config.groupSummarySheet)];
  summary.cells = Array.from({ length: 8 }, () => Array(6).fill(""));
  f.context.createExpenseGroup({
    name: "Construction",
    requestId: "expanded_group_request",
  });
  assert.equal(lookup.getMaxRows(), 31);
  assert.equal(lookup.cells[30][column - 1], "Construction");
  assert.ok(summary.getMaxRows() >= 50);
  assert.ok(summary.getMaxColumns() >= 10);
});

test("UI creates groups from the group page and within an unfinished expense form", async () => {
  const f = fixture();
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: selector === "#entryType" ? "expense" : "",
        innerHTML: "",
        textContent: "",
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(type, handler) {
          this["on" + type] = handler;
        },
        setAttribute(name, value) {
          this[name] = value;
        },
        focus() {},
        click() {
          this.onclick?.();
        },
      });
    return elements.get(selector);
  };
  const runner = {
    withSuccessHandler(handler) {
      this.success = handler;
      return this;
    },
    withFailureHandler(handler) {
      this.failure = handler;
      return this;
    },
    getData() {
      this.success(JSON.parse(JSON.stringify(f.context.getData())));
    },
    createExpenseGroup(input) {
      try {
        this.success(
          JSON.parse(JSON.stringify(f.context.createExpenseGroup(input))),
        );
      } catch (error) {
        this.failure(error);
      }
    },
    addTransaction(input) {
      try {
        this.success(f.context.addTransaction(input));
      } catch (error) {
        this.failure(error);
      }
    },
  };
  const google = { script: { run: runner } };
  const browser = vm.createContext({
    console,
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    google,
    window: { google },
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext('navigate("trips")', browser);
  assert.equal(element("#breadcrumb").textContent, "Dashboards");
  assert.match(element("#content").innerHTML, /New group/);
  element("#newGroupButton").onclick();
  element("#groupName").value = "Wedding";
  await element("#groupForm").onsubmit({ preventDefault() {} });
  assert.ok(f.context.getData().trips.includes("Wedding"));
  assert.match(element("#content").innerHTML, /Wedding/);
  element("#addGroupExpense").onclick();
  assert.equal(element("#entryTrip").value, "Wedding");
  assert.equal(element("#entryDate").value, "");
  element("#entryDate").value = "2026-10-14";
  element("#entryDescription").value = "Flowers";
  element("#entryAmount").value = "88";
  element("#entryCategory").value = "Food";
  element("#entryNotes").value = "Keep this unsaved note";
  element("#newEntryGroup").onclick();
  element("#inlineGroupName").value = "House construction";
  await element("#saveInlineGroup").onclick();
  assert.equal(element("#entryTrip").value, "House construction");
  assert.equal(element("#entryDescription").value, "Flowers");
  assert.equal(element("#entryAmount").value, "88");
  assert.equal(element("#entryDate").value, "2026-10-14");
  assert.equal(element("#entryNotes").value, "Keep this unsaved note");
  element("#entryPaymentMethod").value = "Cash";
  await element("#entryForm").onsubmit({ preventDefault() {} });
  const saved = f.context
    .getData()
    .transactions.find((t) => t.description === "Flowers");
  assert.equal(saved.trip, "House construction");
  assert.equal(vm.runInContext("state.trip", browser), "House construction");
  assert.equal(saved.amount, 88);
  assert.equal(
    f.context.getData().transactions.find((t) => t.row === 2).trip,
    "2026 Holiday",
  );
});

test("payment names delete and re-add without changing journal history; methods validate and fingerprint", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal;
  api.getData();
  assert.equal(f.expense.cells[0][c.paymentMethod - 1], "Payment method");
  let n = 0;
  const manage = (action, method, name) =>
    api.managePaymentOption({
      action,
      method,
      name,
      requestId: `payment_option_${++n}`,
    });
  for (const [method, name] of [
    ["Bank transfer", "SBI Savings"],
    ["Card", "HDFC Card"],
    ["UPI", "Google Pay"],
  ]) {
    manage("add", method, name);
    manage("add", method, name.toUpperCase());
    assert.equal(api.getData().paymentOptions[method].length, 1);
  }
  const payload = {
    type: "expense",
    description: "Known item",
    amount: "90",
    date: "2026-10-14",
    category: "Food",
    paymentMethod: "Bank transfer",
    paymentDetail: "SBI Savings",
  };
  api.addTransaction({ ...payload, requestId: "bank_payment_transaction" });
  const bank = api.getData().transactions.find((t) => t.amount === 90);
  assert.equal(bank.paymentDetail, "SBI Savings");
  const before = JSON.stringify(f.expense.cells);
  const master = f.sheets[f.config.paymentMethodsSheet];
  const masterRowsBefore = master.getMaxRows();
  const removeRequest = {
    action: "remove",
    method: "Bank transfer",
    name: "SBI Savings",
    requestId: "delete_payment_master_row",
  };
  api.managePaymentOption(removeRequest);
  assert.equal(master.getMaxRows(), masterRowsBefore - 1);
  assert.equal(
    master.cells.some((row) => row[1] === "SBI Savings"),
    false,
  );
  const afterRemoval = JSON.stringify(master.cells);
  api.managePaymentOption(removeRequest); // Retrying must not delete a shifted neighbour.
  assert.equal(JSON.stringify(master.cells), afterRemoval);
  assert.equal(JSON.stringify(f.expense.cells), before);
  assert.equal(api.getData().paymentOptions["Bank transfer"].length, 0);
  api.updateTransaction({
    ...payload,
    row: bank.row,
    fingerprint: bank.fingerprint,
    amount: "91",
    requestId: "retain_archived_payment",
  });
  assert.equal(
    api.getData().transactions.find((t) => t.row === bank.row).paymentDetail,
    "SBI Savings",
  );
  assert.throws(
    () =>
      api.addTransaction({ ...payload, requestId: "reject_archived_payment" }),
    /available payment name/,
  );
  manage("add", "Bank transfer", "SBI Savings");
  assert.equal(api.getData().paymentOptions["Bank transfer"][0], "SBI Savings");
  for (const method of ["Card", "UPI", "Cash"]) {
    const detail = method === "Card" ? "HDFC Card" : "Google Pay";
    api.addTransaction({
      ...payload,
      paymentMethod: method,
      paymentDetail: detail,
      requestId: `add_payment_${method}`,
    });
    const entry = api
      .getData()
      .transactions.find((t) => t.paymentMethod === method);
    assert.equal(entry.paymentDetail, method === "Cash" ? "" : detail);
  }
  api.addTransaction({
    ...payload,
    paymentMethod: "",
    paymentDetail: "",
    requestId: "empty_payment_method",
  });
  assert.throws(
    () =>
      api.addTransaction({
        ...payload,
        paymentMethod: "UPI",
        paymentDetail: "",
        requestId: "missing_upi_app_name",
      }),
    /available payment name/,
  );
  assert.throws(
    () => manage("add", "Cash", "Wallet"),
    /Choose an available payment type/,
  );
  assert.throws(() => manage("add", "Card", " "), /enter a name/);
  const current = api.getData().transactions.find((t) => t.row === bank.row);
  f.expense.cells[bank.row - 1][c.paymentDetail - 1] = "Changed directly";
  assert.throws(
    () =>
      api.deleteTransaction({
        ...current,
        confirmed: true,
        requestId: "stale_payment_delete",
      }),
    /changed in the sheet/,
  );
  manage("add", "Card", "=SUM(A1:A9)");
  assert.ok(api.getData().paymentOptions.Card.includes("=SUM(A1:A9)"));
});

test("payment UI manages names and conditionally requires details without losing transaction fields", async () => {
  const f = fixture(),
    elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: selector === "#entryType" ? "expense" : "",
        innerHTML: "",
        textContent: "",
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute(name, value) {
          this[name] = value;
        },
        focus() {},
        click() {
          return this.onclick?.();
        },
      });
    return elements.get(selector);
  };
  let removeButtons = [];
  const runner = {
    withSuccessHandler(fn) {
      this.success = fn;
      return this;
    },
    withFailureHandler(fn) {
      this.failure = fn;
      return this;
    },
  };
  for (const name of [
    "getData",
    "managePaymentOption",
    "addPaymentType",
    "addTransaction",
    "updateTransaction",
  ])
    runner[name] = function (input) {
      try {
        this.success(JSON.parse(JSON.stringify(f.context[name](input))));
      } catch (error) {
        this.failure(error);
      }
    };
  const google = { script: { run: runner } };
  const browser = vm.createContext({
    console,
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    google,
    window: { google },
    document: {
      querySelector: element,
      addEventListener() {},
      querySelectorAll(selector) {
        if (selector !== "[data-remove-payment-name]") return [];
        removeButtons = Array.from(
          element("#content").innerHTML.matchAll(
            /data-remove-payment-method="([^"]+)" data-remove-payment-name="([^"]+)"/g,
          ),
          (m) => ({
            dataset: { removePaymentMethod: m[1], removePaymentName: m[2] },
          }),
        );
        return removeButtons;
      },
    },
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext(
    'state.manageSection = "payments"; navigate("payments")',
    browser,
  );
  assert.equal(element("#monthSelect").hidden, true);
  element("#managePaymentTypeName").value = "Wallet";
  await element("#manageSavePaymentType").onclick();
  assert.equal(element("#paymentOptionType").value, "Wallet");
  assert.match(element("#content").innerHTML, /<h2>Wallet<\/h2>/);
  assert.ok(f.context.getData().config.paymentMethods.includes("Wallet"));
  for (const [method, name] of [
    ["Bank transfer", "Savings"],
    ["Card", "Visa"],
    ["UPI", "PhonePe"],
  ]) {
    element("#paymentOptionType").value = method;
    element("#paymentOptionType").onchange({ target: { value: method } });
    element("#paymentOptionName").value = name;
    await element("#paymentOptionForm").onsubmit({ preventDefault() {} });
    assert.ok(f.context.getData().paymentOptions[method].includes(name));
    assert.equal(element("#paymentOptionType").value, method);
    assert.ok(
      element("#content").innerHTML.includes(
        `<option value="${method}" selected>`,
      ),
    );
  }
  vm.runInContext('navigate("transactions"); openEntry()', browser);
  assert.doesNotMatch(
    element("#modalContainer").innerHTML,
    /id="entryPaymentMethod" required/,
  );
  assert.equal(element("#entryPaymentMethod").required, false);
  assert.equal(element("#paymentNameControls").hidden, false);
  element("#entryDescription").value = "Unsubmitted purchase";
  element("#entryAmount").value = "234";
  element("#newEntryPaymentType").onclick();
  element("#entryPaymentTypeName").value = "Cheque";
  await element("#entrySavePaymentType").onclick();
  assert.equal(element("#entryPaymentMethod").value, "Cheque");
  assert.equal(element("#entryPaymentDetail").required, false);
  assert.equal(element("#entryPaymentTypeCreator").hidden, true);
  assert.equal(element("#entryDescription").value, "Unsubmitted purchase");
  assert.equal(element("#entryAmount").value, "234");
  assert.ok(f.context.getData().config.paymentMethods.includes("Cheque"));
  element("#entryPaymentMethod").value = "";
  element("#entryPaymentMethod").onchange();
  // Create a reusable choice without selecting a payment method first.
  element("#newPaymentName").onclick();
  element("#inlinePaymentType").value = "Card";
  element("#inlinePaymentName").value = "New debit card";
  await element("#saveInlinePayment").onclick();
  assert.equal(element("#entryPaymentMethod").value, "Card");
  assert.equal(element("#entryPaymentDetail").value, "New debit card");
  assert.ok(f.context.getData().paymentOptions.Card.includes("New debit card"));
  element("#entryPaymentMethod").value = "";
  element("#entryPaymentMethod").onchange();
  assert.equal(element("#entryPaymentMethod").value, "");
  for (const [method, label, name] of [
    ["Bank transfer", "Which bank?", "Savings"],
    ["Card", "Which card?", "Visa"],
    ["UPI", "Which UPI app?", "PhonePe"],
  ]) {
    element("#entryPaymentMethod").value = method;
    element("#entryPaymentMethod").onchange();
    assert.equal(element("#paymentDetailField").hidden, false);
    assert.equal(element("#entryPaymentDetail").required, true);
    assert.equal(element("#paymentDetailLabel").textContent, label);
    assert.match(element("#entryPaymentDetail").innerHTML, new RegExp(name));
    assert.equal(element("#entryPaymentDetail").value, "");
  }
  vm.runInContext(
    `state.data.mappings.expense = [
    {description:"Jio recharge", category:"Food"},
    {description:"January rent", category:"Food"},
    {description:"Enjoy lunch", category:"Food"},
    {description:"Known item", category:"Food"},
    {description:"Train", category:"Food"},
    {description:"Train ticket", category:"Food"}
  ]`,
    browser,
  );
  element("#entryDescription").value = "";
  element("#entryDescription").oninput();
  assert.equal(element("#knownDescriptions").innerHTML, "");
  for (const query of ["j", "J", " j "]) {
    element("#entryDescription").value = query;
    element("#entryDescription").oninput();
    assert.match(element("#knownDescriptions").innerHTML, /Jio recharge/);
    assert.match(element("#knownDescriptions").innerHTML, /January rent/);
    assert.doesNotMatch(
      element("#knownDescriptions").innerHTML,
      /Enjoy lunch|Known item/,
    );
  }
  for (const query of ["xyz", "", "   "]) {
    element("#entryDescription").value = query;
    element("#entryDescription").oninput();
    assert.equal(element("#knownDescriptions").innerHTML, "");
  }
  element("#entryDescription").value = "Tra";
  element("#entryDescription").oninput();
  assert.match(element("#knownDescriptions").innerHTML, /Train/);
  assert.match(element("#knownDescriptions").innerHTML, /Train ticket/);
  for (const selected of ["Train", "train", " TRAIN "]) {
    element("#entryDescription").value = selected;
    element("#entryDescription").oninput();
    assert.equal(element("#knownDescriptions").innerHTML, "");
    assert.equal(element("#entryCategory").value, "Food");
  }
  // Editing back to a partial prefix should make suggestions available again.
  element("#entryDescription").value = "Tra";
  element("#entryDescription").oninput();
  assert.match(element("#knownDescriptions").innerHTML, /Train ticket/);
  element("#entryDescription").value = "J";
  element("#entryType").value = "income";
  element("#entryType").onchange();
  assert.equal(element("#paymentMethodField").hidden, true);
  assert.equal(element("#paymentDetailField").hidden, true);
  assert.equal(element("#paymentNameControls").hidden, true);
  assert.equal(element("#entryPaymentMethod").required, false);
  assert.equal(element("#entryPaymentDetail").required, false);
  assert.equal(element("#knownDescriptions").innerHTML, "");
  element("#entryType").value = "expense";
  element("#entryType").onchange();
  assert.equal(element("#paymentMethodField").hidden, false);
  assert.equal(element("#entryPaymentMethod").required, false);
  element("#entryPaymentMethod").value = "UPI";
  element("#entryPaymentMethod").onchange();
  assert.match(element("#knownDescriptions").innerHTML, /Jio recharge/);
  element("#entryCategory").value = "";
  element("#entryDescription").value = "known item";
  element("#entryDescription").oninput();
  assert.equal(element("#entryCategory").value, "Food");
  element("#entryDescription").value = "Known item";
  element("#entryDate").value = "2026-10-14";
  element("#entryAmount").value = "135";
  element("#entryCategory").value = "Food";
  element("#newPaymentName").onclick();
  element("#inlinePaymentName").value = "Google Pay";
  await element("#saveInlinePayment").onclick();
  assert.equal(element("#entryPaymentDetail").value, "Google Pay");
  assert.equal(element("#entryAmount").value, "135");
  assert.equal(element("#entryDate").value, "2026-10-14");
  await element("#entryForm").onsubmit({ preventDefault() {} });
  let entry = f.context.getData().transactions.find((t) => t.amount === 135);
  assert.equal(entry.paymentMethod, "UPI");
  assert.equal(entry.paymentDetail, "Google Pay");
  f.context.addTransaction({
    type: "investment",
    description: "Paid investment",
    amount: "246",
    date: "2026-10-14",
    paymentMethod: "UPI",
    paymentDetail: "Google Pay",
    requestId: "investment_upi_visibility",
  });
  await vm.runInContext("refresh()", browser);
  for (const view of ["overview", "transactions", "investments"]) {
    vm.runInContext(
      `state.month = 9; navigate(${JSON.stringify(view)})`,
      browser,
    );
    assert.match(element("#content").innerHTML, /Google Pay/);
  }
  vm.runInContext(
    'state.manageSection = "payments"; navigate("payments")',
    browser,
  );
  await removeButtons
    .find((b) => b.dataset.removePaymentName === "Google Pay")
    .onclick();
  assert.equal(
    f.context.getData().paymentOptions.UPI.includes("Google Pay"),
    false,
  );
  for (const view of ["overview", "transactions", "investments"]) {
    vm.runInContext(
      `state.month = 9; navigate(${JSON.stringify(view)})`,
      browser,
    );
    assert.doesNotMatch(element("#content").innerHTML, /Google Pay/);
    assert.match(
      element("#content").innerHTML,
      /id="transaction-[^"]+-method"><span class="mobile-field-label">Payment method<\/span>UPI<\/td><td[^>]+id="transaction-[^"]+-detail"><span class="mobile-field-label">Bank \/ card \/ UPI app<\/span><\/td>/,
    );
  }
  browser.entry = JSON.parse(JSON.stringify(entry));
  vm.runInContext("openEntry(entry)", browser);
  assert.equal(element("#entryPaymentMethod").value, "UPI");
  assert.equal(element("#entryPaymentDetail").value, "");
  assert.doesNotMatch(element("#entryPaymentDetail").innerHTML, /Google Pay/);
  assert.match(element("#entryPaymentDetail").innerHTML, /PhonePe/);
  element("#entryPaymentMethod").value = "Cash";
  element("#entryPaymentMethod").onchange();
  assert.equal(element("#paymentDetailField").hidden, true);
  assert.equal(element("#paymentNameControls").hidden, false);
  assert.equal(element("#entryPaymentDetail").required, false);
  assert.equal(element("#entryPaymentDetail").value, "");
  await element("#entryForm").onsubmit({ preventDefault() {} });
  entry = f.context.getData().transactions.find((t) => t.amount === 135);
  assert.equal(entry.paymentMethod, "Cash");
  assert.equal(entry.paymentDetail, "");
  vm.runInContext('state.month = 9; navigate("transactions")', browser);
  assert.match(element("#content").innerHTML, /Payment method/);
  assert.match(element("#content").innerHTML, /Cash/);
  vm.runInContext('navigate("investments"); openEntry()', browser);
  element("#entryType").value = "investment";
  element("#entryType").onchange();
  element("#entryDate").value = "2026-10-15";
  element("#entryDescription").value = "Future fund";
  element("#entryAmount").value = "200";
  element("#entryPaymentMethod").value = "Cash";
  await element("#entryForm").onsubmit({ preventDefault() {} });
  assert.match(
    element("#celebrationContainer").innerHTML,
    /Future you says thanks/,
  );
  assert.match(element("#celebrationContainer").innerHTML, /200/);
  element("#celebrationContainer").innerHTML = "";
  browser.investment = JSON.parse(
    JSON.stringify(
      f.context
        .getData()
        .transactions.find((t) => t.description === "Future fund"),
    ),
  );
  vm.runInContext("openEntry(investment)", browser);
  element("#entryAmount").value = "300";
  await element("#entryForm").onsubmit({ preventDefault() {} });
  assert.equal(element("#celebrationContainer").innerHTML, "");
  vm.runInContext("openEntry()", browser);
  element("#entryType").value = "investment";
  element("#entryType").onchange();
  element("#entryDate").value = "";
  element("#entryDescription").value = "Failed contribution";
  element("#entryAmount").value = "100";
  element("#entryPaymentMethod").value = "Cash";
  await element("#entryForm").onsubmit({ preventDefault() {} });
  assert.equal(element("#celebrationContainer").innerHTML, "");
  assert.match(element("#formError").textContent, /Choose a date/);
});

test("payment storage expands trimmed journals without moving existing cells and works in every journal", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal;
  const snapshots = {};
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    sheet.cells.forEach((row) => row.splice(21));
    snapshots[type] = JSON.stringify(sheet.cells);
  }
  api.getData();
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    assert.equal(sheet.getMaxColumns(), 23);
    assert.equal(
      JSON.stringify(sheet.cells.map((row) => row.slice(0, 21))),
      snapshots[type],
    );
    const result = api.addTransaction({
      type,
      description: "Paid in cash",
      amount: "25",
      date: "2026-10-15",
      category: "Food",
      paymentMethod: "Cash",
      paymentDetail: "",
      requestId: `cash_journal_${type}`,
    });
    assert.equal(
      sheet.cells[result.row - 1][c.paymentMethod - 1],
      type === "income" ? "" : "Cash",
    );
    assert.equal(sheet.cells[result.row - 1][c.paymentDetail - 1], "");
  }
  const after = JSON.stringify(f.expense.cells);
  api.getData();
  assert.equal(JSON.stringify(f.expense.cells), after);
});

test("shared activity status covers initial load, chained refresh, overlap, failure, and stale timers", async () => {
  const f = fixture(),
    elements = new Map(),
    requests = [],
    timers = [];
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: "",
        innerHTML: "",
        textContent: "",
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute(name, value) {
          this[name] = value;
        },
        focus() {},
      });
    return elements.get(selector);
  };
  const google = {
    script: {
      get run() {
        const request = {};
        return {
          withSuccessHandler(fn) {
            request.success = fn;
            return this;
          },
          withFailureHandler(fn) {
            request.failure = fn;
            return this;
          },
          getData() {
            request.name = "getData";
            requests.push(request);
          },
          addTransaction() {
            request.name = "addTransaction";
            requests.push(request);
          },
          deleteTransaction() {
            request.name = "deleteTransaction";
            requests.push(request);
          },
        };
      },
    },
  };
  const browser = vm.createContext({
    Intl,
    Date,
    crypto,
    google,
    window: { google },
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const runTimer = (delay) => {
    const index = timers.findIndex((timer) => timer.delay === delay);
    assert.notEqual(index, -1, `Expected a ${delay}ms timer`);
    timers.splice(index, 1)[0].fn();
  };
  const snapshot = () => JSON.parse(JSON.stringify(f.context.getData()));
  vm.runInContext(browserSource, browser);
  assert.equal(requests[0].name, "getData");
  assert.match(element("#activityContainer").innerHTML, /In progress/);
  requests.shift().success(snapshot());
  await flush();
  runTimer(150);
  assert.match(element("#activityContainer").innerHTML, /Completed/);

  vm.runInContext(
    'var work = (async () => { await rpc("addTransaction", {}); await refresh(); })()',
    browser,
  );
  assert.match(element("#activityContainer").innerHTML, /In progress/);
  // An old completion's hide timer must never hide a newer operation.
  runTimer(3000);
  assert.match(element("#activityContainer").innerHTML, /In progress/);
  requests.shift().success({ ok: true });
  await flush();
  assert.equal(requests[0].name, "getData");
  runTimer(150); // Save finished, but its follow-up refresh is still pending.
  assert.match(element("#activityContainer").innerHTML, /In progress/);
  requests.shift().success(snapshot());
  await browser.work;
  runTimer(150);
  assert.match(element("#activityContainer").innerHTML, /Completed/);

  vm.runInContext(
    'var first = rpc("deleteTransaction", {}); var second = rpc("addTransaction", {}).catch(() => {});',
    browser,
  );
  requests.shift().success({ ok: true });
  await browser.first;
  assert.match(element("#activityContainer").innerHTML, /In progress/);
  runTimer(3000);
  assert.match(element("#activityContainer").innerHTML, /In progress/);
  requests.shift().failure({ message: "Request failed" });
  await browser.second;
  runTimer(150);
  assert.match(element("#activityContainer").innerHTML, /Couldn’t complete/);
  assert.doesNotMatch(
    element("#activityContainer").innerHTML,
    /Completed|In progress/,
  );
  runTimer(3000);
  assert.equal(element("#activityContainer").innerHTML, "");

  vm.runInContext("var invalidRefresh = refresh()", browser);
  requests.shift().success({ transactions: null });
  await browser.invalidRefresh;
  runTimer(150);
  assert.match(element("#activityContainer").innerHTML, /Couldn’t complete/);
  assert.match(element("#toastContainer").innerHTML, /unexpected response/);
});

test("Kashlo checkpoints and cash-flow states reflect records without changing financial data", () => {
  const f = fixture();
  const browser = vm.createContext({
    Intl,
    Date,
    crypto,
    document: {
      querySelector: () => ({ classList: { toggle() {} }, setAttribute() {} }),
      querySelectorAll: () => [],
      addEventListener() {},
    },
  });
  vm.runInContext(
    browserSource.replace(/render\(\);\s*refresh\(\);\s*$/, ""),
    browser,
  );
  browser.data = JSON.parse(JSON.stringify(f.context.getData()));
  vm.runInContext("state.data = data; state.month = 0", browser);
  assert.match(vm.runInContext("overview()", browser), /flow-vault shortfall/);
  assert.match(vm.runInContext("overview()", browser), /1 \/ 3/);
  vm.runInContext(
    `state.data.transactions.push(
    {type:"income", date:"2026-01-05", description:"Salary", amount:1000, row:2, issues:[]},
    {type:"investment", date:"2026-01-05", description:"Savings", amount:100, row:2, issues:[]}
  ); state.data.monthStatus[0] = "Complete"`,
    browser,
  );
  const before = vm.runInContext("JSON.stringify(state.data)", browser);
  assert.match(vm.runInContext("overview()", browser), /flow-vault positive/);
  assert.match(vm.runInContext("overview()", browser), /3 \/ 3/);
  assert.match(
    vm.runInContext("investmentJourney()", browser),
    /1 month with contributions/,
  );
  assert.match(
    vm.runInContext("investmentJourney()", browser),
    /1 recorded contribution/,
  );
  assert.equal(vm.runInContext("JSON.stringify(state.data)", browser), before);
  assert.doesNotMatch(
    vm.runInContext("transactions(true)", browser),
    /<th>Expense group/,
  );
  vm.runInContext("state.month = 1", browser);
  assert.match(vm.runInContext("overview()", browser), /flow-vault neutral/);
  assert.match(vm.runInContext("overview()", browser), /0 \/ 3/);
  vm.runInContext("state.data = null", browser);
  assert.match(
    vm.runInContext("overview()", browser),
    /Waiting for your sheet/,
  );
});

test("legacy No payment rows are deleted bottom-up and a header-only master sheet stays usable", () => {
  const f = fixture(),
    api = f.context;
  api.getData();
  const master = f.sheets[f.config.paymentMethodsSheet];
  master.cells.splice(6);
  const entries = [
    ["Bank transfer", "Super Money", "No"],
    ["Bank transfer", "SBI", "Yes"],
    ["UPI", "Super Money", "No"],
    ["Card", "Old card", " no "],
    ["UPI", "PhonePe", "Yes"],
  ];
  entries.forEach((values, i) =>
    values.forEach((value, j) => (master.cells[i + 1][j] = value)),
  );
  const journalBefore = JSON.stringify(f.expense.cells);
  const result = api.getData();
  assert.equal(master.getMaxRows(), 3);
  assert.equal(master.cells[0][0], "Payment method");
  assert.equal(master.cells[1][1], "SBI");
  assert.equal(master.cells[2][1], "PhonePe");
  assert.equal(result.paymentOptions["Bank transfer"][0], "SBI");
  assert.equal(result.paymentOptions.UPI[0], "PhonePe");
  assert.equal(JSON.stringify(f.expense.cells), journalBefore);
  for (const [method, name] of [
    ["Bank transfer", "SBI"],
    ["UPI", "PhonePe"],
  ])
    api.managePaymentOption({
      action: "remove",
      method,
      name,
      requestId: `delete_last_${name}`,
    });
  assert.equal(master.getMaxRows(), 1);
  assert.equal(api.getData().paymentOptions.UPI.length, 0);
  api.managePaymentOption({
    action: "add",
    method: "Card",
    name: "New card",
    requestId: "add_after_last_deleted",
  });
  assert.equal(master.getMaxRows(), 2);
  assert.equal(master.cells[1][1], "New card");
  assert.equal(master.cells[1][2], "Yes");
});

test("Dashboards nests the existing groups and calculates spending comparisons and cash flow", () => {
  const f = fixture(),
    elements = new Map();
  let buttons = [];
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: "",
        value: "",
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute() {},
      });
    return elements.get(selector);
  };
  const browser = vm.createContext({
    Intl,
    Date,
    crypto,
    document: {
      querySelector: element,
      querySelectorAll(selector) {
        if (selector !== "[data-dashboard]") return [];
        buttons = Array.from(
          element("#content").innerHTML.matchAll(/data-dashboard="([^"]+)"/g),
          (match) => ({ dataset: { dashboard: match[1] } }),
        );
        return buttons;
      },
      addEventListener() {},
    },
  });
  vm.runInContext(
    browserSource.replace(/render\(\);\s*refresh\(\);\s*$/, ""),
    browser,
  );
  browser.data = JSON.parse(JSON.stringify(f.context.getData()));
  vm.runInContext(
    'state.data = data; state.month = 0; navigate("dashboards")',
    browser,
  );
  assert.equal(element("#breadcrumb").textContent, "Dashboards");
  assert.equal(element("#monthSelect").hidden, true);
  assert.equal(buttons.length, 3);
  assert.ok(vm.runInContext("dashboards().endsWith(trips())", browser));
  buttons.find((b) => b.dataset.dashboard === "spending").onclick();
  assert.equal(element("#monthSelect").hidden, false);
  assert.match(element("#content").innerHTML, /January has no previous month/);
  assert.match(element("#content").innerHTML, /No repeated descriptions/);
  vm.runInContext(
    `state.data.transactions.push(
    {type:"expense",description:"Known item",amount:30,date:"2026-01-05",category:"Food",row:3,issues:[]},
    {type:"expense",description:"February item",amount:100,date:"2026-02-02",category:"Food",row:4,issues:[]},
    {type:"income",description:"Salary",amount:200,date:"2026-02-01",row:2,issues:[]},
    {type:"investment",description:"Savings",amount:50,date:"2026-02-02",row:2,issues:[]}
  ); render()`,
    browser,
  );
  assert.match(element("#content").innerHTML, /Known item/);
  assert.match(element("#content").innerHTML, /<td>2<\/td>/);
  vm.runInContext("state.month = 1; render()", browser);
  assert.match(element("#content").innerHTML, /Up 25.0% compared with January/);
  buttons.find((b) => b.dataset.dashboard === "cashflow").onclick();
  assert.equal(element("#monthSelect").hidden, false);
  assert.match(element("#content").innerHTML, /Month by month/);
  assert.match(element("#content").innerHTML, /₹50.00/);
  assert.match(element("#content").innerHTML, /style="color:var\(--red\)"/);
  buttons.find((b) => b.dataset.dashboard === "groups").onclick();
  assert.equal(element("#monthSelect").hidden, true);
  assert.ok(vm.runInContext("dashboards().endsWith(trips())", browser));
});

test("income saves without payment metadata and expenses can leave payment optional", () => {
  const f = fixture(),
    api = f.context;
  api.getData();
  const payload = {
    type: "income",
    description: "Income source",
    amount: "500",
    date: "2026-10-15",
    category: "Food",
  };
  const saved = api.addTransaction({
    ...payload,
    requestId: "income_without_payment",
  });
  let entry = api.getData().transactions.find((t) => t.type === "income");
  assert.equal(entry.paymentMethod, "");
  assert.equal(entry.paymentDetail, "");
  api.updateTransaction({
    ...payload,
    row: saved.row,
    fingerprint: entry.fingerprint,
    amount: "600",
    paymentMethod: "UPI",
    paymentDetail: "Old app",
    requestId: "income_clears_payment",
  });
  entry = api.getData().transactions.find((t) => t.type === "income");
  assert.equal(entry.amount, 600);
  assert.equal(entry.paymentMethod, "");
  assert.equal(entry.paymentDetail, "");
  api.addTransaction({
    ...payload,
    type: "expense",
    paymentMethod: "",
    paymentDetail: "",
    requestId: "expense_optional_payment",
  });
  assert.ok(
    api
      .getData()
      .transactions.some(
        (t) =>
          t.type === "expense" &&
          t.description === "Income source" &&
          t.paymentMethod === "",
      ),
  );
});

test("investment descriptions are learned separately and sorted without moving adjacent lists", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.lookup;
  const expense = f.sheets[f.config.lookupSheets.expense],
    investment = f.sheets[f.config.lookupSheets.investment];
  const oldExpense = JSON.stringify(expense.cells);
  investment.cells[c.firstDataRow - 1][c.description - 1] = "Zeta fund";
  investment.cells[c.firstDataRow][c.description - 1] = "Alpha fund";
  investment.cells[c.firstDataRow][c.category - 1] =
    f.config.categories.investment;
  const optionsBefore = investment.cells.map((r) => r[c.categoryOptions - 1]);
  const groupsBefore = investment.cells.map((r) => r[c.trips - 1]);
  const payload = {
    type: "investment",
    description: "Beta fund",
    amount: "250",
    date: "2026-10-16",
    paymentMethod: "Cash",
  };
  api.addTransaction({ ...payload, requestId: "learn_investment_beta" });
  assert.deepEqual(
    api
      .getData()
      .mappings.investment.map((r) => r.description)
      .join(","),
    "Alpha fund,Beta fund,Zeta fund",
  );
  assert.equal(JSON.stringify(expense.cells), oldExpense);
  assert.deepEqual(
    investment.cells.map((r) => r[c.categoryOptions - 1]),
    optionsBefore,
  );
  assert.deepEqual(
    investment.cells.map((r) => r[c.trips - 1]),
    groupsBefore,
  );
  api.addTransaction({ ...payload, requestId: "reuse_investment_beta" });
  assert.equal(
    api
      .getData()
      .mappings.investment.filter((r) => r.description === "Beta fund").length,
    1,
  );
});

test("legacy descriptions remain recordable without reintroducing old names into the expense master", () => {
  const f = fixture(),
    api = f.context;
  const alias = (f.sheets[f.config.legacyItemAliasesSheet] = new Sheet());
  alias.cells[1][0] = "Traval Insurance";
  const saved = api.addTransaction({
    type: "expense",
    description: "Traval Insurance",
    category: "Food",
    amount: "30",
    date: "2026-10-16",
    paymentMethod: "Cash",
    requestId: "legacy_description_entry",
  });
  const data = api.getData();
  assert.equal(
    data.transactions.find((t) => t.row === saved.row).description,
    "Traval Insurance",
  );
  assert.equal(
    data.mappings.expense.some((t) => t.description === "Traval Insurance"),
    false,
  );
});

test("Manage adds journal-specific choices, rejects remapping, and preserves adjacent data", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.lookup;
  api.getData(); // Initialize payment headers before checking that Manage preserves journals.
  const journalsBefore = Object.values(f.config.sheets).map((name) =>
    JSON.stringify(f.sheets[f.resolve(name)].cells),
  );
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.config.lookupSheets[type]],
      groupBefore = sheet.cells.map((r) => r[c.trips - 1]);
    const request = {
      kind: "description",
      type,
      name: "  New choice  ",
      category: type === "investment" ? "Investments" : "Food",
      requestId: "manage_description_" + type,
    };
    assert.equal(api.addLookupOption(request).created, true);
    assert.equal(api.addLookupOption(request).created, true); // Cached receipt, no second write.
    const data = api.getData();
    assert.equal(
      data.mappings[type].filter((r) => r.description === "New choice").length,
      1,
    );
    assert.deepEqual(
      sheet.cells.map((r) => r[c.trips - 1]),
      groupBefore,
    );
    assert.equal(
      api.addLookupOption({
        ...request,
        name: "new CHOICE",
        requestId: "manage_duplicate_" + type,
      }).created,
      false,
    );
  }
  assert.deepEqual(
    Object.values(f.config.sheets).map((name) =>
      JSON.stringify(f.sheets[f.resolve(name)].cells),
    ),
    journalsBefore,
  );
  const category = {
    kind: "category",
    type: "income",
    name: " Freelance ",
    requestId: "manage_income_category",
  };
  assert.equal(api.addLookupOption(category).created, true);
  assert.equal(
    api.addLookupOption({
      ...category,
      name: "FREELANCE",
      requestId: "manage_existing_category",
    }).created,
    false,
  );
  assert.equal(api.getData().categories.expense.includes("Freelance"), false);
  assert.equal(
    api.getData().categories.income.filter((v) => v === "Freelance").length,
    1,
  );
  api.addLookupOption({
    kind: "description",
    type: "income",
    name: "Design work",
    category: "freelance",
    requestId: "manage_canonical_category",
  });
  assert.equal(
    api.getData().mappings.income.find((r) => r.description === "Design work")
      .category,
    "Freelance",
  );
  api.addLookupOption({
    kind: "description",
    type: "expense",
    name: "Books",
    newCategory: "Education",
    requestId: "manage_inline_category",
  });
  assert.ok(api.getData().categories.expense.includes("Education"));
  assert.equal(
    api.getData().mappings.expense.find((r) => r.description === "Books")
      .category,
    "Education",
  );
  assert.throws(
    () =>
      api.addLookupOption({
        kind: "description",
        type: "expense",
        name: "Known item",
        category: "Education",
        requestId: "manage_conflicting_category",
      }),
    /different category/,
  );
  assert.throws(
    () =>
      api.addLookupOption({
        kind: "description",
        type: "income",
        name: "Invalid",
        category: "Unknown",
        requestId: "manage_invalid_category",
      }),
    /valid category/,
  );
  assert.throws(
    () =>
      api.addLookupOption({
        kind: "category",
        type: "investment",
        name: "Stocks",
        requestId: "manage_investment_category",
      }),
    /Investments category/,
  );
  assert.throws(
    () =>
      api.addLookupOption({
        kind: "category",
        type: "toString",
        name: "Unsafe",
        requestId: "manage_invalid_journal",
      }),
    /valid journal/,
  );
  assert.throws(
    () =>
      api.addLookupOption({
        kind: "category",
        type: "expense",
        name: " ",
        requestId: "manage_blank_category",
      }),
    /Enter a name/,
  );
  f.setActiveEmail("someone@example.test");
  assert.throws(
    () =>
      api.addLookupOption({
        kind: "category",
        type: "expense",
        name: "Private",
        requestId: "manage_private_category",
      }),
    /private/,
  );
});

test("Manage grows only the target list and protects historical aliases", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.lookup,
    sheet = f.sheets[f.config.lookupSheets.expense];
  sheet.getRange(sheet.getMaxRows(), c.description).setValue("Last entry");
  sheet.getRange(sheet.getMaxRows(), c.category).setValue("Food");
  api.addLookupOption({
    kind: "description",
    type: "expense",
    name: "=literal name",
    category: "Food",
    requestId: "manage_full_master",
  });
  assert.equal(sheet.getMaxRows(), 31);
  assert.ok(
    api
      .getData()
      .mappings.expense.some((r) => r.description === "=literal name"),
  );
  api
    .book_()
    .insertSheet(f.config.legacyItemAliasesSheet)
    .getRange(2, 1)
    .setValue("Old spelling");
  assert.throws(
    () =>
      api.addLookupOption({
        kind: "description",
        type: "expense",
        name: "old SPELLING",
        newCategory: "Unused category",
        requestId: "manage_legacy_alias",
      }),
    /historical description/,
  );
  assert.equal(
    api.getData().categories.expense.includes("Unused category"),
    false,
  );
});

test("optional payment saves in each spending journal and can be cleared on an edit", () => {
  for (const type of ["expense", "investment"]) {
    const f = fixture(),
      api = f.context;
    api.getData();
    const payload = {
      type,
      description: "Optional payment",
      category: type === "expense" ? "Food" : "Investments",
      amount: "250",
      date: "2026-10-18",
    };
    const result = api.addTransaction({
      ...payload,
      paymentMethod: "",
      paymentDetail: "Stale detail",
      requestId: "optional_" + type,
    });
    let entry = api
      .getData()
      .transactions.find((t) => t.type === type && t.row === result.row);
    assert.equal(entry.paymentMethod, "");
    assert.equal(entry.paymentDetail, "");
    api.updateTransaction({
      ...payload,
      row: entry.row,
      fingerprint: entry.fingerprint,
      paymentMethod: "Cash",
      requestId: "add_cash_" + type,
    });
    entry = api
      .getData()
      .transactions.find((t) => t.type === type && t.row === result.row);
    assert.equal(entry.paymentMethod, "Cash");
    api.updateTransaction({
      ...payload,
      row: entry.row,
      fingerprint: entry.fingerprint,
      paymentMethod: "",
      paymentDetail: "",
      requestId: "clear_payment_" + type,
    });
    entry = api
      .getData()
      .transactions.find((t) => t.type === type && t.row === result.row);
    assert.equal(entry.paymentMethod, "");
    assert.equal(entry.paymentDetail, "");
    assert.equal(entry.amount, 250);
    assert.throws(
      () =>
        api.addTransaction({
          ...payload,
          paymentMethod: "Unsupported",
          requestId: "bad_method_" + type,
        }),
      /valid payment method/,
    );
    assert.throws(
      () =>
        api.addTransaction({
          ...payload,
          paymentMethod: "UPI",
          paymentDetail: "",
          requestId: "missing_name_" + type,
        }),
      /available payment name/,
    );
  }
});

test("custom payment types persist separately, deduplicate, and work with optional names", () => {
  const f = fixture(),
    api = f.context;
  api.getData();
  const journalBefore = Object.values(f.config.sheets).map((s) =>
    JSON.stringify(f.sheets[f.resolve(s)].cells),
  );
  const create = { name: " Wallet ", requestId: "create_wallet_type" };
  assert.equal(api.addPaymentType(create).name, "Wallet");
  assert.equal(api.addPaymentType(create).created, true); // Receipt replay is the same.
  assert.equal(
    api.addPaymentType({ name: "wALLET", requestId: "duplicate_wallet_type" })
      .created,
    false,
  );
  assert.equal(
    api.addPaymentType({ name: " cash ", requestId: "reuse_cash_type" }).name,
    "Cash",
  );
  const types = f.sheets[f.config.paymentTypesSheet];
  assert.equal(
    types.cells.flat().filter((value) => value === "Wallet").length,
    1,
  );
  assert.deepEqual(
    Object.values(f.config.sheets).map((s) =>
      JSON.stringify(f.sheets[f.resolve(s)].cells),
    ),
    journalBefore,
  );
  assert.ok(api.getData().config.paymentMethods.includes("Wallet"));
  for (const type of ["expense", "investment"]) {
    const payload = {
      type,
      description: "Custom type purchase",
      amount: "200",
      date: "2026-10-18",
      category: type === "expense" ? "Food" : "Investments",
      paymentMethod: "Wallet",
      paymentDetail: "",
    };
    const result = api.addTransaction({
      ...payload,
      requestId: "save_custom_type_" + type,
    });
    let entry = api
      .getData()
      .transactions.find((t) => t.type === type && t.row === result.row);
    assert.equal(entry.paymentMethod, "Wallet");
    assert.equal(entry.paymentDetail, "");
    api.managePaymentOption({
      action: "add",
      method: "Wallet",
      name: "Travel wallet",
      requestId: "name_custom_type_" + type,
    });
    api.updateTransaction({
      ...payload,
      row: entry.row,
      fingerprint: entry.fingerprint,
      paymentDetail: "Travel wallet",
      requestId: "update_custom_type_" + type,
    });
    entry = api
      .getData()
      .transactions.find((t) => t.type === type && t.row === result.row);
    assert.equal(entry.paymentDetail, "Travel wallet");
  }
  api.managePaymentOption({
    action: "remove",
    method: "Wallet",
    name: "Travel wallet",
    requestId: "remove_custom_type_name",
  });
  assert.ok(api.getData().config.paymentMethods.includes("Wallet"));
  assert.equal(api.getData().paymentOptions.Wallet.length, 0);
  assert.throws(
    () => api.addPaymentType({ name: " ", requestId: "empty_custom_type" }),
    /Enter a payment type/,
  );
  assert.throws(
    () =>
      api.addPaymentType({
        name: "X".repeat(61),
        requestId: "long_custom_type",
      }),
    /Enter a payment type/,
  );
  assert.throws(
    () =>
      api.addPaymentType({
        name: "__proto__",
        requestId: "reserved_custom_type",
      }),
    /Enter a payment type/,
  );
  f.setActiveEmail("other@example.test");
  assert.throws(
    () =>
      api.addPaymentType({
        name: "Private",
        requestId: "unauthorized_custom_type",
      }),
    /private/,
  );
});

test("custom payment types expand a header-only list and store formula-like names literally", () => {
  const f = fixture(),
    api = f.context;
  api.getData();
  const sheet = f.sheets[f.config.paymentTypesSheet];
  sheet.cells = sheet.cells.slice(0, 1);
  api.addPaymentType({
    name: "=literal type",
    requestId: "literal_custom_type",
  });
  assert.equal(sheet.getMaxRows(), 2);
  assert.equal(sheet.cells[1][0], "=literal type");
  assert.ok(api.getData().config.paymentMethods.includes("=literal type"));
});

for (const type of ["expense", "income", "investment"]) {
  test(`${type}: duplicate review respects recorded payment details and normalized text`, () => {
    const f = fixture(),
      api = f.context,
      c = f.config.layout.journal;
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    for (let i = 1; i <= 8; i++) sheet.cells[i] = [...f.expense.cells[1]];
    for (let i = 1; i <= 8; i++) {
      sheet.cells[i][c.description - 1] = "Regular contribution";
      sheet.cells[i][c.paymentMethod - 1] = "UPI";
      sheet.cells[i][c.paymentDetail - 1] = "Google Pay";
    }
    sheet.cells[2][c.description - 1] = " REGULAR   contribution ";
    sheet.cells[2][c.paymentMethod - 1] = " upi ";
    sheet.cells[2][c.paymentDetail - 1] = " google   PAY ";
    sheet.cells[3][c.paymentDetail - 1] = "PhonePe";
    sheet.cells[4][c.paymentMethod - 1] = "Card";
    sheet.cells[5][c.paymentDetail - 1] = "";
    sheet.cells[6][c.paymentMethod - 1] = "";
    sheet.cells[6][c.paymentDetail - 1] = "";
    sheet.cells[7][c.amount - 1] = 75;
    sheet.cells[8][c.date - 1] = new Date(Date.UTC(2026, 0, 5));
    sheet.cells[2][c.otherIssues[0] - 1] = "Missing category";
    const before = api
        .getData()
        .transactions.filter((entry) => entry.type === type),
      clicked = before[0];
    assert.equal(before[1].duplicateGroup, clicked.duplicateGroup);
    for (const entry of before.slice(2))
      assert.notEqual(entry.duplicateGroup, clicked.duplicateGroup);
    api.setReview({
      type,
      row: clicked.row,
      fingerprint: clicked.fingerprint,
      entries: before
        .slice(0, 2)
        .map((entry) => ({ row: entry.row, fingerprint: entry.fingerprint })),
      decision: "Okay",
      requestId: "payment_aware_review_" + type,
    });
    const after = api
      .getData()
      .transactions.filter((entry) => entry.type === type);
    assert.equal(after[0].issues.length, 0);
    assert.deepEqual(Array.from(after[1].issues), ["Missing category"]);
    for (const entry of after.slice(2)) assert.equal(entry.decision, "Pending");
    assert.deepEqual(
      Array.from(after, (t) => t.amount),
      Array.from(before, (t) => t.amount),
    );
  });
}

test("duplicate formulas use generic literal matches and configured journal coordinates", () => {
  const f = fixture({
    apply(config) {
      config.layout.journal.paymentMethod = 25;
      config.layout.journal.paymentDetail = 26;
    },
  });
  const formula = f.context.duplicateFormula_(3, 80);
  assert.match(formula, /SUMPRODUCT\(ARRAYFORMULA/);
  assert.match(formula, /\$Y\$2:\$Y\$80/);
  assert.match(formula, /\$Z3/);
  assert.match(formula, /ISNUMBER\(\$C3\)/);
  assert.match(formula, /INT\(\$F3\)/);
  assert.doesNotMatch(formula, /IIFL|Gold|BitSave|COUNTIF|MONTH/i);
  assert.doesNotMatch(
    configSource,
    /monthlyInvestmentDescriptions|Repeated IIFL|Gold and BitSave/,
  );
  assert.throws(
    () => f.context.duplicateFormula_(1, 80),
    /prepared journal row/,
  );
});

test("review keeps payment-aware duplicate groups adjacent without reordering journals", () => {
  const records = [
    {
      type: "expense",
      description: "Train",
      date: "2026-10-18",
      amount: 100,
      paymentMethod: "UPI",
      paymentDetail: "Google Pay",
      row: 2,
      issues: ["Possible duplicate"],
    },
    {
      type: "expense",
      description: "Train",
      date: "2026-10-18",
      amount: 100,
      paymentMethod: "UPI",
      paymentDetail: "PhonePe",
      row: 3,
      issues: ["Possible duplicate"],
    },
    {
      type: "expense",
      description: " TRAIN ",
      date: "2026-10-18",
      amount: 100,
      paymentMethod: " upi ",
      paymentDetail: " google   PAY ",
      row: 4,
      issues: ["Possible duplicate"],
    },
  ];
  const reviewSource = browserSource.match(
    /function reviewRows\(\) \{[\s\S]*?\n      \}/,
  )[0];
  const context = vm.createContext({ rows: () => records });
  vm.runInContext(reviewSource, context);
  assert.deepEqual(
    Array.from(context.reviewRows(), (r) => r.row),
    [2, 4, 3],
  );
  assert.deepEqual(
    records.map((r) => r.row),
    [2, 3, 4],
  );
  const f = fixture();
  assert.equal(f.context.duplicateText_("  GOOGLE\t  pay  "), "google pay");
  // Nonbreaking spaces remain literal in both JavaScript and Sheets/RE2.
  assert.equal(
    f.context.duplicateText_("\u00a0Name\u00a0"),
    "\u00a0name\u00a0",
  );
});

function prepareProfileWorkbook(f) {
  for (const name of Object.values(f.config.sheets)) {
    const sheet = f.sheets[f.resolve(name)];
    sheet
      .getRange(
        f.config.layout.journal.firstDataRow,
        f.config.layout.journal.duplicateIssue,
      )
      .setValue(f.rawContext.duplicateFormula_(2, sheet.getMaxRows()));
  }
}
function profileInput(f, additions = {}) {
  return {
    requestId: "profile_settings_request_" + crypto.randomUUID(),
    revision: 1,
    ownerName: "Jordan Doe",
    workspaceLabel: "My finances",
    workbook: f.config.spreadsheetId,
    currency: "EUR",
    locale: "fr-FR",
    timeZone: "Europe/Paris",
    year: f.config.year,
    ...additions,
  };
}

test("first-time setup derives the owner and connects a validated existing workbook", () => {
  const f = fixture(),
    api = f.rawContext;
  f.clearSetup();
  const beforeSheets = Object.keys(f.sheets);
  const initial = api.getData();
  assert.equal(initial.setupRequired, true);
  assert.equal(initial.profile.ownerName, "");
  assert.equal(initial.profile.ownerEmail, f.config.ownerEmail);
  assert.equal(initial.profile.workbook, "");
  assert.deepEqual(Object.keys(f.sheets), beforeSheets);
  assert.throws(
    () =>
      api.addPaymentType({
        name: "Wallet",
        requestId: "before_setup_payment_type",
      }),
    /Complete Profile/,
  );
  prepareProfileWorkbook(f);
  const amounts = Object.values(f.config.sheets).map((name) =>
    f.sheets[f.resolve(name)].cells.map(
      (row) => row[f.config.layout.journal.amount - 1],
    ),
  );
  const payload = profileInput(f, {
    revision: 0,
    currency: "eur",
    ownerEmail: "attacker@example.test",
    workbook:
      "https://docs.google.com/spreadsheets/d/" +
      f.config.spreadsheetId +
      "/edit#gid=0",
  });
  const result = api.saveWorkspaceSettings(payload);
  assert.equal(result.profile.ownerEmail, f.config.ownerEmail);
  assert.equal(result.profile.revision, 1);
  assert.equal(result.profile.setupRequired, false);
  assert.equal(api.saveWorkspaceSettings(payload).profile.revision, 1);
  const data = api.getData();
  assert.equal(data.workspaceRevision, 1);
  assert.equal(data.config.ownerName, "Jordan Doe");
  assert.equal(data.config.ownerInitials, "JD");
  assert.equal(data.config.currency, "EUR");
  assert.equal(data.config.locale, "fr-FR");
  assert.equal(data.config.timeZone, "Europe/Paris");
  assert.equal(f.book.getSpreadsheetTimeZone(), "Europe/Paris");
  assert.deepEqual(
    Object.values(f.config.sheets).map((name) =>
      f.sheets[f.resolve(name)].cells.map(
        (row) => row[f.config.layout.journal.amount - 1],
      ),
    ),
    amounts,
  );
  assert.equal(f.getLockCount(), 0);
  assert.doesNotMatch(
    configSource,
    /deepukv97|1zmB0UwS24|ownerName: "Deepak"|year: 2026/,
  );
});

test("settings validation rejects inaccessible or incompatible workbooks and leaves the connection unchanged", () => {
  const f = fixture(),
    api = f.rawContext;
  prepareProfileWorkbook(f);
  const previous = f.properties["kashlo:workspace:v1"],
    zone = f.book.getSpreadsheetTimeZone();
  for (const invalid of [
    { ownerName: "" },
    { workspaceLabel: "" },
    { currency: "INVALID" },
    { locale: "not_a_locale" },
    { locale: "zz-ZZ" },
    { timeZone: "Mars/Olympus" },
    { year: 2027 },
    { year: 2026.5 },
    { workbook: "https://example.com/sheet" },
    { workbook: "not-a-workbook-000000000000000" },
  ]) {
    assert.throws(() => api.saveWorkspaceSettings(profileInput(f, invalid)));
    assert.equal(f.properties["kashlo:workspace:v1"], previous);
    assert.equal(f.book.getSpreadsheetTimeZone(), zone);
    assert.equal(f.getLockCount(), 0);
  }
  f.sheets[f.config.lookupSheets.income].cells = f.sheets[
    f.config.lookupSheets.income
  ].cells.slice(0, 1);
  assert.throws(
    () => api.saveWorkspaceSettings(profileInput(f)),
    /required rows/,
  );
  assert.equal(f.properties["kashlo:workspace:v1"], previous);
});

test("workbook/year switches reject stale tabs and route new saves to the chosen workbook", () => {
  const f = fixture(),
    api = f.rawContext,
    next = fixture({
      apply(c) {
        c.year = 2027;
      },
    });
  prepareProfileWorkbook(f);
  prepareProfileWorkbook(next);
  const initial = api.getData(),
    oldEntry = initial.transactions[0];
  const nextId = "next-workbook-000000000000000000";
  f.books.set(nextId, next.book);
  const before = JSON.stringify(f.expense.cells);
  api.saveWorkspaceSettings(
    profileInput(f, {
      workbook: nextId,
      year: 2027,
      currency: "USD",
      locale: "en-US",
    }),
  );
  assert.equal(api.getWorkspaceSettings().revision, 2);
  assert.throws(
    () => api.saveWorkspaceSettings(profileInput(f)),
    /changed in another tab/,
  );
  const payload = {
    requestId: "stale_workspace_transaction",
    workspaceRevision: 1,
    type: "expense",
    description: "Known item",
    category: "Food",
    date: "2027-01-10",
    amount: 10,
    paymentMethod: "",
  };
  assert.throws(
    () => api.addTransaction(payload),
    /Workspace settings changed/,
  );
  assert.throws(
    () =>
      api.addTransaction({
        ...payload,
        requestId: "missing_workspace_revision",
        workspaceRevision: undefined,
      }),
    /Workspace settings changed/,
  );
  const loaded = api.getData();
  assert.equal(loaded.config.year, 2027);
  assert.equal(loaded.workspaceRevision, 2);
  const result = api.addTransaction({
    ...payload,
    requestId: "current_workspace_transaction",
    workspaceRevision: 2,
  });
  assert.equal(
    next.expense.cells[result.row - 1][next.config.layout.journal.amount - 1],
    10,
  );
  assert.equal(JSON.stringify(f.expense.cells), before);
  assert.throws(
    () =>
      api.deleteTransaction({
        type: "expense",
        row: oldEntry.row,
        fingerprint: oldEntry.fingerprint,
        confirmed: true,
        workspaceRevision: 1,
        requestId: "stale_workspace_deletion",
      }),
    /Workspace settings changed/,
  );
});

test("profile setup cannot change access identity or silently reuse another owner's saved workbook", () => {
  const f = fixture(),
    api = f.rawContext;
  prepareProfileWorkbook(f);
  f.setActiveEmail("other@example.test");
  assert.throws(() => api.getWorkspaceSettings(), /private/);
  assert.throws(() => api.saveWorkspaceSettings(profileInput(f)), /private/);
  f.setActiveEmail(f.config.ownerEmail);
  const record = JSON.parse(f.properties["kashlo:workspace:v1"]);
  record.ownerEmail = "previous.owner@example.test";
  f.properties["kashlo:workspace:v1"] = JSON.stringify(record);
  vm.runInContext("workspaceConfigCache_=null", api);
  assert.equal(api.getData().setupRequired, true);
  assert.equal(api.getWorkspaceSettings().workbook, "");
  api.saveWorkspaceSettings(profileInput(f, { revision: 0 }));
  assert.equal(api.getWorkspaceSettings().ownerEmail, f.config.ownerEmail);
});

test("profile validation requires prepared formulas before changing workbook settings", () => {
  const f = fixture(),
    api = f.rawContext;
  const previous = f.properties["kashlo:workspace:v1"];
  assert.throws(
    () => api.saveWorkspaceSettings(profileInput(f)),
    /prepared duplicate-check formulas/,
  );
  assert.equal(f.properties["kashlo:workspace:v1"], previous);
  assert.equal(f.book.getSpreadsheetTimeZone(), "Asia/Kolkata");
});

test("profile save rolls the workbook time zone back if settings persistence fails", () => {
  const f = fixture(),
    api = f.rawContext;
  prepareProfileWorkbook(f);
  const before = f.properties["kashlo:workspace:v1"],
    original = api.PropertiesService.getScriptProperties;
  api.PropertiesService.getScriptProperties = () => {
    const store = original();
    return {
      ...store,
      setProperty(key, value) {
        if (key === "kashlo:workspace:v1")
          throw new Error("Settings storage unavailable");
        store.setProperty(key, value);
      },
    };
  };
  assert.throws(
    () => api.saveWorkspaceSettings(profileInput(f)),
    /storage unavailable/,
  );
  assert.equal(f.properties["kashlo:workspace:v1"], before);
  assert.equal(f.book.getSpreadsheetTimeZone(), "Asia/Kolkata");
  assert.equal(f.getLockCount(), 0);
});

test("profile validation rejects a read-only workbook even when its time zone already matches", () => {
  const f = fixture(),
    api = f.rawContext;
  prepareProfileWorkbook(f);
  const previous = f.properties["kashlo:workspace:v1"],
    readOnlyId = "readonly-workbook-000000000000000";
  f.books.set(readOnlyId, {
    ...f.book,
    setSpreadsheetTimeZone() {
      throw new Error("Read only");
    },
  });
  assert.throws(
    () =>
      api.saveWorkspaceSettings(
        profileInput(f, { workbook: readOnlyId, timeZone: "Asia/Kolkata" }),
      ),
    /must be editable/,
  );
  assert.equal(f.properties["kashlo:workspace:v1"], previous);
  assert.equal(
    api.getWorkspaceSettings().workbook.includes(f.config.spreadsheetId),
    true,
  );
});

for (const type of ["expense", "income", "investment"]) {
  test(`${type}: adding beyond prepared rows grows safely and remains retry-safe`, () => {
    const f = fixture(),
      api = f.context,
      c = f.config.layout.journal;
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    sheet.getRange(30, c.description).setValue("Existing final entry");
    sheet.getRange(30, c.amount).setValue(77);
    sheet.getRange(30, c.date).setValue(46023);
    sheet.getRange(30, c.decision).setValue("Okay");
    sheet.getRange(30, c.reviewNote).setValue("Keep this note");
    const dateRule = { condition: "DATE_IS_VALID" };
    sheet.getRange(30, c.date).setDataValidations([[dateRule]]);
    sheet.getRange(2, 10).setValue("Unrelated summary");
    sheet.getRange(2, c.category).setValue("Manual category");
    sheet.getRange(3, c.category).setFormula('=IF(B3="","","Food")');
    sheet
      .getRange(2, c.otherIssues[0])
      .setFormula('=IF(B2="","","Missing category")');
    sheet
      .getRange(2, c.otherIssues[1])
      .setFormula('=IF(F2="","Incomplete entry","")');
    sheet
      .getRange(2, c.dateDerived.year)
      .setFormula('=ARRAYFORMULA(IF(F2:F30="","",YEAR(F2:F30)))');
    const before = sheet.cells.map((row) => [...row]);
    const input = {
      requestId: `journal_growth_${type}`,
      type,
      description: "New entry",
      amount: 25,
      date: "2026-02-01",
      category: type === "investment" ? "Investments" : "Food",
    };
    const saved = api.addTransaction(input);
    assert.equal(saved.row, 31);
    assert.equal(sheet.getMaxRows(), 280);
    assert.equal(sheet.getRange(32, c.description).getValues()[0][0], "");
    assert.equal(sheet.getRange(31, c.decision).getValues()[0][0], "");
    assert.equal(sheet.getRange(31, c.reviewNote).getValues()[0][0], "");
    assert.match(sheet.getRange(32, c.category).getFormula(), /B32/);
    assert.match(sheet.getRange(280, c.otherIssues[0]).getFormula(), /B280/);
    assert.match(sheet.getRange(2, c.dateDerived.year).getFormula(), /F2:F280/);
    assert.equal(
      sheet.getRange(2, c.duplicateIssue).getFormula(),
      api.duplicateArrayFormula_(280),
    );
    assert.ok(sheet.copies.some((copy) => copy.type === "PASTE_FORMAT"));
    assert.deepEqual(sheet.getRange(280, c.date).getDataValidations(), [
      [dateRule],
    ]);
    assert.ok(
      sheet.copies.some((copy) => copy.type === "PASTE_DATA_VALIDATION"),
    );
    const editable = [
      c.description,
      c.amount,
      c.date,
      c.category,
      c.notes,
      c.trip,
      c.paymentMethod,
      c.paymentDetail,
      c.decision,
      c.reviewNote,
      10,
    ];
    before.forEach((row, i) =>
      editable.forEach((column) =>
        assert.equal(sheet.cells[i][column - 1], row[column - 1]),
      ),
    );
    assert.equal(api.addTransaction(input).row, 31);
    assert.equal(sheet.getMaxRows(), 280);
    sheet.getRange(280, c.description).setValue("Another final entry");
    assert.equal(
      api.addTransaction({ ...input, requestId: `grow_again_${type}` }).row,
      281,
    );
    assert.equal(sheet.getMaxRows(), 530);
  });
}

test("capacity growth preserves incomplete rows and works beyond 20,000 entries", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal,
    sheet = f.expense;
  sheet.insertRowsAfter(30, 19970);
  sheet.getRange(20000, c.amount).setValue(42);
  const result = api.addTransaction({
    requestId: "large_journal_growth",
    type: "expense",
    description: "New entry",
    amount: 10,
    date: "2026-02-01",
    category: "Food",
  });
  assert.equal(result.row, 20001);
  assert.equal(sheet.getMaxRows(), 20250);
  assert.equal(sheet.getRange(20000, c.amount).getValues()[0][0], 42);
  assert.match(
    sheet.getRange(20001, c.otherIssues[0]).getFormula(),
    /Missing category/,
  );
  assert.match(
    sheet.getRange(20250, c.otherIssues[1]).getFormula(),
    /Incomplete entry/,
  );
});

test("invalid submissions cannot expand a journal", () => {
  const f = fixture(),
    c = f.config.layout.journal;
  f.expense.getRange(30, c.description).setValue("Final entry");
  assert.throws(
    () =>
      f.context.addTransaction({
        requestId: "invalid_grow",
        type: "expense",
        description: "New",
        amount: 10,
        date: "",
        category: "Food",
      }),
    /date/i,
  );
  assert.equal(f.expense.getMaxRows(), 30);
});

test("deleting the first entry restores generated spill anchors and preserves remaining values", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal,
    sheet = f.expense;
  sheet.getRange(3, c.description).setValue("Remaining entry");
  sheet.getRange(3, c.amount).setValue(17);
  sheet.getRange(3, c.date).setValue(46024);
  sheet.getRange(3, c.reviewNote).setValue("Preserve note");
  api.installDuplicateArray_(sheet);
  sheet
    .getRange(2, c.dateDerived.year)
    .setFormula('=ARRAYFORMULA(IF(F2:F30="","",YEAR(F2:F30)))');
  const entry = api
    .getData()
    .transactions.find((t) => t.type === "expense" && t.row === 2);
  api.deleteTransaction({
    requestId: "delete_array_anchor",
    type: "expense",
    row: 2,
    fingerprint: entry.fingerprint,
    confirmed: true,
  });
  assert.equal(sheet.getMaxRows(), 29);
  assert.equal(
    sheet.getRange(2, c.description).getValues()[0][0],
    "Remaining entry",
  );
  assert.equal(
    sheet.getRange(2, c.reviewNote).getValues()[0][0],
    "Preserve note",
  );
  assert.equal(
    sheet.getRange(2, c.duplicateIssue).getFormula(),
    api.duplicateArrayFormula_(29),
  );
  assert.match(sheet.getRange(2, c.dateDerived.year).getFormula(), /F2:F29/);
});

test("large-journal checks preserve configured columns without per-row full scans", () => {
  const f = fixture({
    apply(config) {
      config.layout.journal.paymentMethod = 25;
      config.layout.journal.paymentDetail = 26;
    },
  });
  const formula = f.context.duplicateArrayFormula_(20001);
  assert.match(formula, /\$Y\$2:\$Y\$20001/);
  assert.match(formula, /\$Z\$2:\$Z\$20001/);
  assert.match(formula, /SORT\(HSTACK/);
  assert.doesNotMatch(formula, /SUMPRODUCT|COUNTIF|MAP\(/);
  assert.equal(
    f.context.duplicateArrayFormula_(2),
    '=LET(descriptions,"",IF(TRUE,"",""))',
  );
});

test("journal growth expands the optional native review sheet and its entry links", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal;
  const review = f.book.insertSheet(f.resolve(f.config.reviewSheet));
  review
    .getRange(5, 8)
    .setFormula(
      '=MAP(A5:A30,G5:G30,LAMBDA(journal,sourceRow,IF(journal="","",sourceRow)))',
    );
  review.getRange(1, 1).setValue("Review heading");
  f.expense.getRange(30, c.description).setValue("Final entry");
  api.addTransaction({
    requestId: "review_capacity_growth",
    type: "expense",
    description: "New entry",
    amount: 10,
    date: "2026-02-01",
    category: "Food",
  });
  assert.equal(review.getMaxRows(), 341);
  assert.match(review.getRange(5, 8).getFormula(), /A5:A341,G5:G341/);
  assert.equal(review.getRange(1, 1).getValues()[0][0], "Review heading");
});

// Model the blank distributable template without rewriting an existing user's journals.
function freshYearTemplate() {
  const f = fixture();
  prepareProfileWorkbook(f);
  f.clearSetup();
  for (const template of [
    ...Object.values(f.config.sheets),
    f.config.dashboardSheet,
    f.config.groupSummarySheet,
  ]) {
    const old = f.resolve(template);
    f.sheets[template] = f.sheets[old];
    delete f.sheets[old];
  }
  for (const template of Object.values(f.config.sheets)) {
    const sheet = f.sheets[template];
    const c = f.config.layout.journal;
    for (const column of [
      c.description,
      c.amount,
      c.date,
      c.category,
      c.notes,
      c.trip,
      c.decision,
      c.reviewNote,
      c.paymentMethod,
      c.paymentDetail,
    ])
      sheet
        .getRange(
          c.firstDataRow,
          column,
          sheet.getMaxRows() - c.firstDataRow + 1,
          1,
        )
        .clearContent();
  }
  const guide = f.book.insertSheet(f.config.workbookYear.sheet);
  guide.getRange(16, 1).setValue("Workbook year");
  f.sheets["{year} Expense Summary"] = new Sheet();
  for (const [initial, sheet] of Object.entries(f.sheets)) {
    let name = initial;
    sheet.getName = () => name;
    sheet.setName = (next) => {
      if (f.sheets[next]) throw new Error("Sheet already exists");
      delete f.sheets[name];
      name = next;
      f.sheets[name] = sheet;
      return sheet;
    };
  }
  f.book.getSheets = () => Object.values(f.sheets);
  return { ...f, guide };
}
for (const year of [2027, 2028, 2031]) {
  test(`fresh template initializes for ${year} and remains a single-year workbook`, () => {
    const f = freshYearTemplate(),
      api = f.rawContext;
    const input = profileInput(f, { revision: 0, year });
    const response = api.saveWorkspaceSettings(input);
    assert.equal(response.profile.year, year);
    assert.equal(f.guide.getRange(16, 2).getValues()[0][0], year);
    assert.ok(f.sheets[`${year} Expense Summary`]);
    assert.equal(
      Object.keys(f.sheets).some((name) => name.includes("{year}")),
      false,
    );
    assert.equal(api.saveWorkspaceSettings(input).profile.year, year);
    assert.throws(
      () => api.saveWorkspaceSettings(profileInput(f, { year: year + 1 })),
      /fresh Kashlo workbook/,
    );
    const entry = api.addTransaction({
      requestId: `new_year_${year}`,
      workspaceRevision: 1,
      type: "expense",
      description: "Known item",
      category: "Food",
      amount: 21,
      date: year === 2028 ? "2028-02-29" : `${year}-02-28`,
    });
    assert.equal(entry.row, 2);
    assert.equal(
      api.getData().transactions.find((t) => t.type === "expense").date,
      year === 2028 ? "2028-02-29" : `${year}-02-28`,
    );
    f.guide.getRange(16, 2).setValue(year + 1);
    assert.throws(() => api.getData(), /workbook year does not match/);
  });
}
test("fresh setup refuses entries, naming collisions, and missing formulas before changing the template", () => {
  for (const problem of ["entries", "collision", "formulas"]) {
    const f = freshYearTemplate(),
      c = f.config.layout.journal;
    if (problem === "entries")
      f.sheets[f.config.sheets.expense].getRange(5, c.amount).setValue(12);
    if (problem === "collision") {
      const sheet = new Sheet();
      sheet.getName = () => "2027 Expense Summary";
      f.sheets["2027 Expense Summary"] = sheet;
    }
    if (problem === "formulas")
      f.sheets[f.config.sheets.income]
        .getRange(c.firstDataRow, c.duplicateIssue)
        .clearContent();
    const before = Object.keys(f.sheets);
    assert.throws(
      () =>
        f.rawContext.saveWorkspaceSettings(
          profileInput(f, { revision: 0, year: 2027 }),
        ),
      /contains entries|already exist|formulas are missing/,
    );
    assert.deepEqual(Object.keys(f.sheets), before);
    assert.equal(f.guide.getRange(16, 2).getValues()[0][0], "");
    assert.equal(f.book.getSpreadsheetTimeZone(), "Asia/Kolkata");
    assert.equal(f.rawContext.getWorkspaceSettings().setupRequired, true);
  }
});
test("fresh setup rolls back tab names, year, and time zone if saving fails", () => {
  const f = freshYearTemplate(),
    api = f.rawContext;
  const original = api.PropertiesService.getScriptProperties;
  api.PropertiesService.getScriptProperties = () => {
    const store = original();
    return {
      ...store,
      setProperty(key, value) {
        if (key === "kashlo:workspace:v1")
          throw new Error("Settings storage unavailable");
        store.setProperty(key, value);
      },
    };
  };
  const before = Object.keys(f.sheets).sort();
  assert.throws(
    () =>
      api.saveWorkspaceSettings(profileInput(f, { revision: 0, year: 2028 })),
    /storage unavailable/,
  );
  assert.deepEqual(Object.keys(f.sheets).sort(), before);
  assert.equal(f.guide.getRange(16, 2).getValues()[0][0], "");
  assert.equal(f.book.getSpreadsheetTimeZone(), "Asia/Kolkata");
});
test("a previously assigned workbook cannot be reinterpreted after a new deployment", () => {
  const f = freshYearTemplate(),
    api = f.rawContext;
  api.saveWorkspaceSettings(profileInput(f, { revision: 0, year: 2027 }));
  f.clearSetup();
  const before = Object.keys(f.sheets);
  assert.throws(
    () =>
      api.saveWorkspaceSettings(profileInput(f, { revision: 0, year: 2028 })),
    /belongs to 2027/,
  );
  assert.deepEqual(Object.keys(f.sheets), before);
  assert.equal(f.guide.getRange(16, 2).getValues()[0][0], 2027);
});

test("fresh setup restores earlier renames if a later tab rename fails", () => {
  const f = freshYearTemplate(),
    api = f.rawContext;
  const sheet = f.sheets[f.config.dashboardSheet],
    rename = sheet.setName;
  sheet.setName = (name) => {
    if (name === "2028 Dashboard") throw new Error("Rename unavailable");
    return rename(name);
  };
  const before = Object.keys(f.sheets).sort();
  assert.throws(
    () =>
      api.saveWorkspaceSettings(profileInput(f, { revision: 0, year: 2028 })),
    /Rename unavailable/,
  );
  assert.deepEqual(Object.keys(f.sheets).sort(), before);
  assert.equal(f.guide.getRange(16, 2).getValues()[0][0], "");
  assert.equal(f.book.getSpreadsheetTimeZone(), "Asia/Kolkata");
  assert.equal(api.getWorkspaceSettings().setupRequired, true);
});

test("fresh setup checks edit access before assigning a year or renaming tabs", () => {
  const f = freshYearTemplate(),
    api = f.rawContext;
  f.book.setSpreadsheetTimeZone = () => {
    throw new Error("Read only");
  };
  const before = Object.keys(f.sheets).sort();
  assert.throws(
    () =>
      api.saveWorkspaceSettings(profileInput(f, { revision: 0, year: 2028 })),
    /must be editable/,
  );
  assert.deepEqual(Object.keys(f.sheets).sort(), before);
  assert.equal(f.guide.getRange(16, 2).getValues()[0][0], "");
  assert.equal(api.getWorkspaceSettings().setupRequired, true);
});

test("snapshot reuses lookup reads and date conversions without retaining stale data", () => {
  const f = fixture(),
    c = f.config.layout.journal;
  f.context.managePaymentOption({
    action: "add",
    method: "UPI",
    name: "Sample app",
    requestId: "optimization_payment_seed",
  });
  f.expense.insertRowsAfter(30, 971);
  for (let row = 2; row <= 1001; row++) {
    f.expense.getRange(row, c.description).setValue("Synthetic entry");
    f.expense.getRange(row, c.amount).setValue(row);
    f.expense.getRange(row, c.date).setValue(new Date(Date.UTC(2026, 0, 4)));
  }
  const before = JSON.stringify(f.expense.cells);
  const reads = new Map();
  let metadataReads = 0,
    dateFormats = 0;
  for (const [name, sheet] of Object.entries(f.sheets)) {
    const range = sheet.getRange.bind(sheet),
      maxRows = sheet.getMaxRows.bind(sheet);
    sheet.getMaxRows = () => {
      metadataReads++;
      return maxRows();
    };
    sheet.getRange = (...args) => {
      const value = range(...args),
        display = value.getDisplayValues;
      value.getDisplayValues = () => {
        reads.set(name, (reads.get(name) || 0) + 1);
        return display();
      };
      return value;
    };
  }
  const format = f.rawContext.Utilities.formatDate;
  f.rawContext.Utilities.formatDate = (...args) => {
    dateFormats++;
    return format(...args);
  };
  const snapshot = f.context.getData();
  assert.equal(snapshot.transactions.length, 1000);
  assert.equal(snapshot.transactions[0].date, "2026-01-04");
  assert.ok(dateFormats <= 2, `formatted dates ${dateFormats} times`);
  assert.ok(metadataReads < 50, `read row metadata ${metadataReads} times`);
  for (const name of [
    ...Object.values(f.config.lookupSheets),
    f.config.paymentMethodsSheet,
    f.config.paymentTypesSheet,
  ])
    assert.equal(reads.get(name), 1, name);
  assert.deepEqual(Array.from(snapshot.paymentOptions.UPI), ["Sample app"]);
  assert.equal(JSON.stringify(f.expense.cells), before);
  const fingerprint = snapshot.transactions[0].fingerprint;
  f.expense.getRange(2, c.amount).setValue(987);
  f.book.setSpreadsheetTimeZone("America/Los_Angeles");
  const updated = f.context.getData();
  assert.equal(updated.transactions[0].amount, 987);
  assert.equal(updated.transactions[0].date, "2026-01-03");
  assert.notEqual(updated.transactions[0].fingerprint, fingerprint);
  assert.equal(JSON.stringify(snapshot.transactions[0].amount), "2");
});

async function optimizationBrowser(intl = Intl) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute() {},
        focus() {},
        setSelectionRange() {},
      });
    return elements.get(selector);
  };
  const browser = vm.createContext({
    console,
    Intl: intl,
    Date,
    crypto,
    setTimeout: () => 0,
    window: {},
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  browser.data = JSON.parse(JSON.stringify(fixture().context.getData()));
  vm.runInContext("state.data=data;state.month=0;", browser);
  return browser;
}

test("browser reuses number/date formatters and responds to in-place regional setting changes", async () => {
  let numbers = 0,
    dates = 0;
  const browser = await optimizationBrowser({
    NumberFormat: function (...args) {
      numbers++;
      return new Intl.NumberFormat(...args);
    },
    DateTimeFormat: function (...args) {
      dates++;
      return new Intl.DateTimeFormat(...args);
    },
    supportedValuesOf: Intl.supportedValuesOf,
  });
  const formatted = vm.runInContext(
    'Array.from({length:1000},()=>[money(1234.5),short(1234.5),currencySymbol(),dateLabel("2026-01-04")])',
    browser,
  );
  assert.equal(
    formatted[0][0],
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(1234.5),
  );
  assert.deepEqual(Array.from(formatted[999]), Array.from(formatted[0]));
  assert.equal(numbers, 3);
  assert.equal(dates, 1);
  assert.equal(
    vm.runInContext(
      'state.data.config.locale="en-US";state.data.config.currency="USD";money(1234.5)',
      browser,
    ),
    "$1,234.50",
  );
  assert.equal(numbers, 4);
  assert.equal(
    vm.runInContext('dateLabel("2026-01-04")', browser),
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date("2026-01-04T12:00:00")),
  );
  assert.equal(dates, 2);
});

test("single-pass cash flow keeps monthly and all-recorded totals including refunds and missing dates", async () => {
  const browser = await optimizationBrowser();
  browser.entries = Array.from({ length: 2000 }, (_, i) => ({
    type: ["expense", "income", "investment"][i % 3],
    date:
      i % 31 === 0
        ? ""
        : `${i % 37 === 0 ? 2025 : 2026}-${String((i % 12) + 1).padStart(2, "0")}-04`,
    amount: i % 19 === 0 ? null : i % 17 === 0 ? -2.5 : 3.25,
  }));
  vm.runInContext("state.data.transactions=entries;", browser);
  const totals = vm.runInContext("cashFlowTotals()", browser);
  for (const type of ["expense", "income", "investment"]) {
    for (let month = 0; month < 12; month++)
      assert.equal(
        totals.months[type][month],
        vm.runInContext(
          `sum(monthly(${JSON.stringify(type)},${month}))`,
          browser,
        ),
      );
    assert.equal(
      totals.annual[type],
      browser.entries
        .filter((t) => t.type === type)
        .reduce((value, t) => value + (Number(t.amount) || 0), 0),
    );
  }
  const chart = vm.runInContext("chart()", browser);
  assert.equal((chart.match(/<rect /g) || []).length, 36);
  const before = JSON.stringify(browser.entries);
  vm.runInContext("chart();cashFlowDashboard();overview();", browser);
  assert.equal(JSON.stringify(browser.entries), before);
});

test("phone navigation opens a focus-contained drawer, closes on selection, and resets on desktop", async () => {
  const elements = new Map(),
    listeners = new Map();
  let resize;
  const media = {
    matches: true,
    addEventListener(type, callback) {
      assert.equal(type, "change");
      resize = callback;
    },
  };
  let document;
  const element = (selector) => {
    if (!elements.has(selector)) {
      const classes = new Set();
      const node = {
        value: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        attributes: {},
        classList: {
          add(name) {
            classes.add(name);
          },
          remove(name) {
            classes.delete(name);
          },
          toggle(name, on) {
            on ? classes.add(name) : classes.delete(name);
          },
          contains(name) {
            return classes.has(name);
          },
        },
        addEventListener() {},
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        removeAttribute(key) {
          delete this.attributes[key];
        },
        focus() {
          document.activeElement = this;
        },
        setSelectionRange() {},
      };
      elements.set(selector, node);
    }
    return elements.get(selector);
  };
  const views = [
    "overview",
    "transactions",
    "investments",
    "dashboards",
    "review",
    "payments",
  ];
  const buttons = views.map((view) => {
    const button = element("nav:" + view);
    button.dataset.view = view;
    return button;
  });
  element("#navigationPanel").querySelectorAll = () => [
    element("#closeMobileMenu"),
    ...buttons,
  ];
  document = {
    body: element("body"),
    activeElement: null,
    querySelector: element,
    querySelectorAll: (selector) => (selector === "[data-view]" ? buttons : []),
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
  };
  const browser = vm.createContext({
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    window: {},
    matchMedia: () => media,
    document,
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  browser.data = JSON.parse(JSON.stringify(fixture().context.getData()));
  vm.runInContext("state.data=data;render();", browser);
  const toggle = element("#mobileMenuButton"),
    panel = element("#navigationPanel"),
    backdrop = element("#navigationBackdrop");
  assert.equal(panel.inert, true);
  toggle.onclick();
  assert.equal(toggle.attributes["aria-expanded"], "true");
  assert.equal(panel.inert, false);
  assert.equal(panel.attributes["aria-modal"], "true");
  assert.equal(element("#mainWorkspace").inert, true);
  assert.equal(document.body.classList.contains("mobile-menu-open"), true);
  assert.equal(backdrop.hidden, false);
  assert.equal(document.activeElement, element("#closeMobileMenu"));
  let prevented = 0;
  buttons.at(-1).focus();
  listeners.get("keydown")({
    key: "Tab",
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(document.activeElement, element("#closeMobileMenu"));
  listeners.get("keydown")({
    key: "Tab",
    shiftKey: true,
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(document.activeElement, buttons.at(-1));
  listeners.get("keydown")({
    key: "Escape",
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 3);
  assert.equal(toggle.attributes["aria-expanded"], "false");
  assert.equal(document.activeElement, toggle);
  for (const [index, view] of views.entries()) {
    toggle.onclick();
    buttons[index].onclick();
    assert.equal(vm.runInContext("state.view", browser), view);
    assert.equal(toggle.attributes["aria-expanded"], "false");
    assert.equal(element("#mainWorkspace").inert, false);
  }
  toggle.onclick();
  backdrop.onclick();
  assert.equal(backdrop.hidden, true);
  toggle.onclick();
  element("#closeMobileMenu").onclick();
  assert.equal(panel.inert, true);
  toggle.onclick();
  media.matches = false;
  resize();
  assert.equal(panel.inert, false);
  assert.equal(panel.attributes.role, undefined);
  assert.equal(document.body.classList.contains("mobile-menu-open"), false);
  toggle.onclick();
  assert.equal(toggle.attributes["aria-expanded"], "false");
  media.matches = true;
  resize();
  assert.equal(panel.inert, true);
});

async function pullRefreshBrowser() {
  const elements = new Map(),
    listeners = new Map(),
    changes = new Map(),
    requests = [];
  let drafts = [];
  const media = {
    matches: true,
    addEventListener(type, callback) {
      changes.set(type, callback);
    },
  };
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        attributes: {},
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        removeAttribute(key) {
          delete this.attributes[key];
        },
        focus() {},
        setSelectionRange() {},
      });
    return elements.get(selector);
  };
  const document = {
    body: element("body"),
    activeElement: null,
    scrollingElement: { scrollTop: 0 },
    querySelector: element,
    querySelectorAll: (selector) =>
      selector === "#content form input, #content form textarea" ? drafts : [],
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
  };
  const browser = vm.createContext({
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    window: {},
    matchMedia: () => media,
    document,
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  browser.data = JSON.parse(JSON.stringify(fixture().context.getData()));
  vm.runInContext(
    'state.data=data;state.view="transactions";state.month=4;state.search="Known";render();',
    browser,
  );
  const runner = {
    withSuccessHandler(handler) {
      this.success = handler;
      return this;
    },
    withFailureHandler(handler) {
      this.failure = handler;
      return this;
    },
    getData() {
      requests.push({ success: this.success, failure: this.failure });
    },
  };
  browser.google = { script: { run: runner } };
  browser.window.google = browser.google;
  const target = {
    closest() {
      return null;
    },
  };
  const event = (x, y, extra = {}) => ({
    target,
    touches: [{ clientX: x, clientY: y }],
    cancelable: true,
    preventDefault() {
      this.prevented = true;
    },
    ...extra,
  });
  return {
    browser,
    element,
    listeners,
    requests,
    media,
    document,
    event,
    changes,
    setDrafts(value) {
      drafts = value;
    },
  };
}

test("pull-to-refresh requests one snapshot, shows progress, and preserves page, month, and search", async () => {
  const f = await pullRefreshBrowser();
  f.listeners.get("touchstart")(f.event(100, 100));
  const pull = f.event(100, 140);
  f.listeners.get("touchmove")(pull);
  assert.equal(pull.prevented, true);
  assert.equal(f.element("#pullRefreshLabel").textContent, "Pull to refresh");
  f.listeners.get("touchmove")(f.event(100, 200));
  assert.equal(
    f.element("#pullRefreshLabel").textContent,
    "Release to refresh",
  );
  const finished = f.listeners.get("touchend")(
    f.event(100, 200, { touches: [] }),
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.element("#pullRefreshLabel").textContent, "Refreshing…");
  assert.equal(f.element("#pullRefreshIndicator").hidden, false);
  f.listeners.get("touchstart")(f.event(100, 100));
  f.listeners.get("touchmove")(f.event(100, 220));
  await f.listeners.get("touchend")(f.event(100, 220, { touches: [] }));
  assert.equal(f.requests.length, 1);
  const updated = JSON.parse(JSON.stringify(f.browser.data));
  updated.transactions[0].amount = 321;
  f.requests[0].success(updated);
  await finished;
  assert.equal(f.element("#pullRefreshIndicator").hidden, true);
  assert.equal(f.element("#refreshButton").disabled, false);
  assert.equal(
    vm.runInContext("state.data.transactions[0].amount", f.browser),
    321,
  );
  assert.equal(vm.runInContext("state.view", f.browser), "transactions");
  assert.equal(vm.runInContext("state.month", f.browser), 4);
  assert.equal(vm.runInContext("state.search", f.browser), "Known");
});

test("pull-to-refresh ignores short, cancelled, horizontal, nested, busy, draft, and desktop gestures", async () => {
  const f = await pullRefreshBrowser(),
    start = f.listeners.get("touchstart"),
    move = f.listeners.get("touchmove"),
    end = f.listeners.get("touchend");
  const finish = () => end(f.event(100, 220, { touches: [] }));
  start(f.event(100, 100));
  move(f.event(100, 140));
  await finish();
  start(f.event(100, 100));
  move(f.event(100, 220));
  move(f.event(100, 130));
  await finish();
  start(f.event(100, 100));
  move(f.event(230, 120));
  await finish();
  start(f.event(100, 100));
  move(f.event(100, 220));
  f.listeners.get("touchcancel")();
  await finish();
  start(f.event(100, 100));
  move(f.event(100, 220, { cancelable: false }));
  await finish();
  start(f.event(100, 100, { touches: [{}, {}] }));
  move(f.event(100, 220));
  await finish();
  for (const reason of [
    "scroll",
    "target",
    "focus",
    "modal",
    "drawer",
    "busy",
    "loading",
    "profile",
    "draft",
    "desktop",
  ]) {
    if (reason === "scroll") f.document.scrollingElement.scrollTop = 100;
    if (reason === "focus")
      f.document.activeElement = {
        closest() {
          return {};
        },
      };
    if (reason === "modal")
      f.element("#modalContainer").innerHTML = "<form>Draft</form>";
    if (reason === "drawer") f.element("#mobileMenuButton").onclick();
    if (reason === "busy") vm.runInContext("state.saveBusy=true", f.browser);
    if (reason === "loading") vm.runInContext("state.loading=true", f.browser);
    if (reason === "profile")
      vm.runInContext('state.view="profile"', f.browser);
    if (reason === "draft") {
      vm.runInContext('state.view="payments"', f.browser);
      f.setDrafts([{ value: "Unfinished description" }]);
    }
    if (reason === "desktop") f.media.matches = false;
    const target =
      reason === "target"
        ? {
            closest() {
              return {};
            },
          }
        : undefined;
    start(f.event(100, 100, target ? { target } : {}));
    move(f.event(100, 220));
    await finish();
    f.document.scrollingElement.scrollTop = 0;
    f.document.activeElement = null;
    f.element("#modalContainer").innerHTML = "";
    if (reason === "drawer") f.element("#closeMobileMenu").onclick();
    vm.runInContext(
      'state.loading=false;state.saveBusy=false;state.view="transactions"',
      f.browser,
    );
    f.setDrafts([]);
    f.media.matches = true;
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.element("#pullRefreshIndicator").hidden, true);
});

test("failed pull-to-refresh retains data, clears progress, and permits a new pull", async () => {
  const f = await pullRefreshBrowser();
  const pull = () => {
    f.listeners.get("touchstart")(f.event(100, 100));
    f.listeners.get("touchmove")(f.event(100, 220));
    return f.listeners.get("touchend")(f.event(100, 220, { touches: [] }));
  };
  const failed = pull();
  f.requests[0].failure(new Error("Synthetic connection failure"));
  await failed;
  assert.equal(f.element("#pullRefreshIndicator").hidden, true);
  assert.equal(vm.runInContext("state.loading", f.browser), false);
  assert.equal(
    vm.runInContext("state.data.transactions[0].amount", f.browser),
    50,
  );
  assert.match(
    f.element("#toastContainer").innerHTML,
    /Synthetic connection failure/,
  );
  const retry = pull();
  assert.equal(f.requests.length, 2);
  f.requests[1].success(f.browser.data);
  await retry;
  assert.equal(f.element("#pullRefreshIndicator").hidden, true);
});

function bulkFixture() {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal;
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    sheet.cells[1] = [...f.expense.cells[1]];
    sheet.cells[2] = [...sheet.cells[1]];
    sheet.cells[3] = [...sheet.cells[1]];
    sheet.cells[4] = [...sheet.cells[1]];
    sheet.cells[4][c.amount - 1] = 987;
    sheet.cells[4][c.duplicateIssue - 1] = "";
  }
  const entries = api
    .getData()
    .transactions.map(
      ({ type, row, fingerprint, decision, reviewNote, duplicateGroup }) => ({
        type,
        row,
        fingerprint,
        decision,
        reviewNote,
        duplicateGroup,
      }),
    );
  return { ...f, api, c, entries };
}

test("bulk Okay accepts all exact groups and preserves amounts and other validation issues", () => {
  const f = bulkFixture();
  f.expense.cells[4][f.c.otherIssues[0] - 1] = "Missing category";
  f.entries = f.api
    .getData()
    .transactions.map(
      ({ type, row, fingerprint, decision, reviewNote, duplicateGroup }) => ({
        type,
        row,
        fingerprint,
        decision,
        reviewNote,
        duplicateGroup,
      }),
    );
  f.entries[0].note = "Intentional payments";
  const before = f.api.getData().transactions.map((t) => t.amount);
  const input = {
    action: "okay",
    entries: f.entries,
    requestId: "bulk_okay_request",
  };
  assert.equal(f.api.bulkReview(input).count, 10);
  assert.equal(f.api.bulkReview(input).count, 10);
  const after = f.api.getData().transactions;
  assert.deepEqual(
    Array.from(after, (t) => t.amount),
    Array.from(before),
  );
  assert.equal(
    after.filter((t) => t.issues.includes("Possible duplicate")).length,
    0,
  );
  assert.equal(
    after.filter((t) => t.issues.includes("Missing category")).length,
    1,
  );
  assert.equal(after[0].reviewNote, "Intentional payments");
});

test("bulk delete keeps one per group across all journals, preserves unrelated records and retries safely", () => {
  const f = bulkFixture();
  const input = {
    action: "delete",
    entries: f.entries,
    confirmed: true,
    requestId: "bulk_delete_request",
  };
  assert.equal(f.api.bulkReview(input).count, 6);
  assert.equal(f.api.bulkReview(input).count, 6);
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    assert.equal(
      sheet.cells[1][f.c.amount - 1],
      f.expense.cells[1][f.c.amount - 1],
    );
    assert.equal(sheet.cells[2][f.c.amount - 1], 987);
    assert.equal(sheet.getMaxRows(), 28);
  }
});

test("bulk deletion validates confirmation and the entire snapshot before any deletion", () => {
  for (const mutation of [
    "changed",
    "new",
    "removed",
    "missing",
    "confirmation",
    "reviewed",
  ]) {
    const f = bulkFixture();
    const input = {
      action: "delete",
      entries: f.entries,
      confirmed: true,
      requestId: "bulk_guard_" + mutation,
    };
    if (mutation === "reviewed") f.expense.cells[2][f.c.decision - 1] = "Okay";
    if (mutation === "changed") f.expense.cells[2][f.c.amount - 1] = 999;
    if (mutation === "new") f.expense.cells[5] = [...f.expense.cells[1]];
    if (mutation === "removed") f.expense.cells[2] = Array(30).fill("");
    if (mutation === "missing") input.entries = input.entries.slice(1);
    if (mutation === "confirmation") input.confirmed = false;
    const before = JSON.stringify(f.expense.cells);
    assert.throws(() => f.api.bulkReview(input), /changed|Confirm/);
    assert.equal(JSON.stringify(f.expense.cells), before);
    assert.equal(f.expense.getMaxRows(), 30);
  }
});

test("bulk deletion excludes accepted groups and distinguishes payment details", () => {
  const f = bulkFixture();
  for (let i = 1; i <= 3; i++) f.expense.cells[i][f.c.decision - 1] = "Okay";
  const investment = f.sheets[f.resolve(f.config.sheets.investment)];
  investment.cells[3][f.c.paymentDetail - 1] = "Other fictional source";
  const entries = f.api
    .getData()
    .transactions.map(
      ({ type, row, fingerprint, decision, reviewNote, duplicateGroup }) => ({
        type,
        row,
        fingerprint,
        decision,
        reviewNote,
        duplicateGroup,
      }),
    );
  assert.equal(
    f.api.bulkReview({
      action: "delete",
      entries,
      confirmed: true,
      requestId: "bulk_scope_request",
    }).count,
    3,
  );
  assert.equal(f.expense.getMaxRows(), 30);
  assert.equal(investment.getMaxRows(), 29);
  assert.equal(
    investment.cells[2][f.c.paymentDetail - 1],
    "Other fictional source",
  );
});

test("bulk review rejects oversized notes and wrong workspace without writing decisions", () => {
  for (const invalid of ["note", "workspace"]) {
    const f = bulkFixture();
    const input = {
      action: "okay",
      entries: f.entries,
      requestId: "bulk_invalid_" + invalid,
    };
    if (invalid === "note")
      input.entries[0].note = "x".repeat(f.config.limits.noteLength + 1);
    else input.workspaceRevision = 999;
    const before = JSON.stringify(f.expense.cells);
    assert.throws(() => f.api.bulkReview(input), /note|Workspace/);
    assert.equal(JSON.stringify(f.expense.cells), before);
  }
});

test("bulk Review UI confirms counts, sends notes and snapshot, and reuses request ID on retry", async () => {
  const nodes = new Map();
  const element = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        innerHTML: "",
        textContent: "",
        value: "",
        hidden: false,
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute() {},
        focus() {},
      });
    return nodes.get(key);
  };
  const browser = vm.createContext({
    console,
    Intl,
    Date,
    crypto,
    setTimeout: () => 0,
    window: {},
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  });
  vm.runInContext(browserSource, browser);
  await new Promise((resolve) => setImmediate(resolve));
  browser.snapshot = {
    config: { year: 2026, locale: "en-US", currency: "USD", monthStatuses: [] },
    transactions: [2, 3, 4].map((row) => ({
      type: "expense",
      row,
      description: "Fictional snack",
      date: "2026-01-05",
      amount: 20,
      category: "Food",
      issues: ["Possible duplicate"],
      decision: "Pending",
      reviewNote: "",
      duplicateGroup: "group-a",
      fingerprint: "fp-" + row,
    })),
  };
  vm.runInContext(
    'state.data = snapshot; state.view = "review"; render(); refresh = async () => {}; var calls = []; rpc = async (name, payload) => { calls.push({name,payload}); if (calls.length === 1) throw new Error("Network failure"); return {count:2}; };',
    browser,
  );
  assert.match(element("#content").innerHTML, /id="okayAll"/);
  assert.match(element("#content").innerHTML, /id="deleteAllDuplicates"/);
  element("#note_0").value = "Keep this review note";
  vm.runInContext('openBulkReview("delete", reviewRows());', browser);
  assert.match(
    element("#modalContainer").innerHTML,
    /Permanently delete 2 extra/,
  );
  assert.match(element("#modalContainer").innerHTML, /earliest entry/);
  assert.equal(browser.calls.length, 0);
  element("#cancelBulk").onclick();
  assert.equal(element("#modalContainer").innerHTML, "");
  vm.runInContext('openBulkReview("delete", reviewRows());', browser);
  await element("#confirmBulk").onclick();
  assert.match(element("#bulkError").textContent, /Network failure/);
  assert.equal(element("#confirmBulk").disabled, false);
  await element("#confirmBulk").onclick();
  assert.equal(browser.calls[0].name, "bulkReview");
  assert.equal(
    browser.calls[0].payload.requestId,
    browser.calls[1].payload.requestId,
  );
  assert.equal(browser.calls[1].payload.confirmed, true);
  assert.equal(
    browser.calls[1].payload.entries[0].note,
    "Keep this review note",
  );
  assert.equal(element("#modalContainer").innerHTML, "");
  vm.runInContext('openBulkReview("okay", reviewRows());', browser);
  assert.match(
    element("#modalContainer").innerHTML,
    /every transaction and amount unchanged/,
  );
  await element("#confirmBulk").onclick();
  assert.equal(browser.calls[2].payload.action, "okay");
});

test("edit refresh patches the current view, preserves focus/caret and scroll, and uses authoritative totals", async () => {
  const f = await pullRefreshBrowser(),
    b = f.browser;
  const search = f.element("#search"),
    viewport = { isConnected: true, scrollLeft: 85, scrollTop: 12 };
  search.isConnected = true;
  search.selectionStart = 1;
  search.selectionEnd = 4;
  search.selectionDirection = "backward";
  search.focus = (options) => {
    f.document.activeElement = search;
    search.focusOptions = options;
  };
  search.setSelectionRange = (start, end, direction) => {
    search.restored = [start, end, direction];
  };
  f.document.activeElement = search;
  f.document.querySelectorAll = (selector) =>
    selector === "#content .tablewrap, #content .chartwrap" ? [viewport] : [];
  b.scrollX = 3;
  b.scrollY = 420;
  b.scrollTo = (x, y) => {
    b.restoredScroll = [x, y];
  };
  vm.runInContext(
    "var patches = []; patchView = html => { patches.push(html); return true; };",
    b,
  );
  const content = f.element("#content").innerHTML;
  const task = vm.runInContext("refresh({incremental:true})", b);
  b.scrollX = 7;
  b.scrollY = 630;
  viewport.scrollLeft = 120;
  const updated = structuredClone(b.data);
  updated.transactions[0].amount = 321;
  f.requests[0].success(updated);
  assert.equal(await task, true);
  assert.equal(f.element("#content").innerHTML, content);
  assert.equal(b.patches.length, 1);
  assert.equal(vm.runInContext("rows()[0].amount", b), 321);
  assert.equal(f.document.activeElement, search);
  assert.deepEqual(search.restored, [1, 4, "backward"]);
  assert.equal(search.focusOptions.preventScroll, true);
  assert.equal(viewport.scrollLeft, 120);
  assert.deepEqual(b.restoredScroll, [7, 630]);
});

test("edit refresh waits for an earlier read and fetches again instead of leaving stale edited data", async () => {
  const f = await pullRefreshBrowser(),
    b = f.browser;
  const first = vm.runInContext("refresh()", b);
  const edit = vm.runInContext("refresh({incremental:true})", b);
  assert.equal(f.requests.length, 1);
  f.requests[0].success(structuredClone(b.data));
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 2);
  const fresh = structuredClone(b.data);
  fresh.transactions[0].amount = 555;
  f.requests[1].success(fresh);
  assert.equal(await edit, true);
  assert.equal(vm.runInContext("rows()[0].amount", b), 555);
});

test("incremental refresh retains stale data on read failure and fully renders a different workspace", async () => {
  const f = await pullRefreshBrowser(),
    b = f.browser;
  vm.runInContext(
    "var patches = 0; patchView = () => { patches++; return true; };",
    b,
  );
  const initial = f.element("#content").innerHTML;
  const failure = vm.runInContext("refresh({incremental:true})", b);
  f.requests[0].failure(new Error("Snapshot unavailable"));
  assert.equal(await failure, false);
  assert.equal(b.patches, 0);
  assert.equal(f.element("#content").innerHTML, initial);
  assert.match(f.element("#connectionLabel").textContent, /stale/);
  const retry = vm.runInContext("refresh({incremental:true})", b);
  const next = structuredClone(b.data);
  next.workspaceRevision++;
  f.requests[1].success(next);
  assert.equal(await retry, true);
  assert.equal(b.patches, 0);
});

test("view context does not restore old focus or scrolling after navigation", async () => {
  const f = await pullRefreshBrowser(),
    b = f.browser;
  b.scrollTo = () => {
    throw new Error("Must not restore previous page scroll");
  };
  vm.runInContext(
    'var context = captureViewContext(); state.view="overview"; restoreViewContext(context);',
    b,
  );
});

async function paginationBrowser() {
  const f = await pullRefreshBrowser();
  f.browser.data.transactions = Array.from({ length: 155 }, (_, i) => ({
    type: "expense",
    row: i + 2,
    description: i === 0 ? "Needle offpage" : "Fictional item " + i,
    date: "2026-01-10",
    amount: i + 1,
    category: "Food",
    trip: "Fictional group",
    issues: [],
    fingerprint: "test-" + i,
  }));
  vm.runInContext(
    'state.data=data;state.view="transactions";state.month=0;state.type="all";state.search="";render();',
    f.browser,
  );
  return f;
}
const tableKeys = (html) =>
  [...html.matchAll(/data-transaction-key="([^"]+)"/g)].map(
    (match) => match[1],
  );

test("pagination exposes every matching record once across bounded pages", async () => {
  const f = await paginationBrowser(),
    b = f.browser,
    all = [];
  for (let page = 1; page <= 7; page++) {
    const html = vm.runInContext(
      `state.transactionPage=${page};transactions()`,
      b,
    );
    const keys = tableKeys(html);
    all.push(...keys);
    assert.equal(keys.length, page === 7 ? 5 : 25);
    assert.match(html, new RegExp(`Page ${page} of 7`));
    if (page === 1)
      assert.match(html, /aria-label="Previous transaction page" disabled/);
    if (page === 7)
      assert.match(html, /aria-label="Next transaction page" disabled/);
  }
  assert.equal(all.length, 155);
  assert.equal(new Set(all).size, 155);
  assert.equal(all[0], "expense:156");
  assert.equal(all.at(-1), "expense:2");
});

test("search scans beyond the visible page and resets pagination while month/type changes reset it too", async () => {
  const f = await paginationBrowser(),
    b = f.browser;
  vm.runInContext("state.transactionPage=5;render();", b);
  assert.equal(
    tableKeys(f.element("#content").innerHTML).includes("expense:2"),
    false,
  );
  f.element("#search").oninput({ target: { value: "Needle offpage" } });
  assert.deepEqual(tableKeys(f.element("#content").innerHTML), ["expense:2"]);
  assert.equal(vm.runInContext("state.transactionPage", b), 1);
  assert.doesNotMatch(
    f.element("#content").innerHTML,
    /aria-label="Transaction pages"/,
  );
  vm.runInContext(
    'state.search="";transactions();state.transactionPage=6;state.type="income";transactions();',
    b,
  );
  assert.equal(vm.runInContext("state.transactionPage", b), 1);
  vm.runInContext(
    'state.type="all";transactions();state.transactionPage=6;state.month=1;transactions();',
    b,
  );
  assert.equal(vm.runInContext("state.transactionPage", b), 1);
  assert.match(vm.runInContext("transactions()", b), /No transactions/);
});

test("pagination clamps after fewer results and keeps investment totals independent of the visible page", async () => {
  const f = await paginationBrowser(),
    b = f.browser;
  vm.runInContext(
    "state.transactionPage=7;state.data.transactions=state.data.transactions.slice(0,50);var reduced=transactions();",
    b,
  );
  assert.equal(vm.runInContext("state.transactionPage", b), 2);
  assert.match(b.reduced, /Showing 26–50 of 50/);
  vm.runInContext(
    'state.data.transactions.forEach(t=>t.type="investment");state.view="investments";transactions(true);state.transactionPage=2;var html=transactions(true);',
    b,
  );
  assert.equal(tableKeys(b.html).length, 25);
  const total = vm.runInContext("money(sum(rows()))", b);
  assert.equal(b.html.split(total).length - 1, 2);
  assert.doesNotMatch(b.html, /<th>Expense group<\/th>/);
});

test("expense group records paginate while Overview keeps its six recent entries", async () => {
  const f = await paginationBrowser(),
    b = f.browser;
  vm.runInContext(
    'state.view="dashboards";state.dashboard="groups";state.trip="Fictional group";var grouped=trips();',
    b,
  );
  assert.equal(tableKeys(b.grouped).length, 25);
  assert.match(b.grouped, /Page 1 of 7/);
  vm.runInContext('state.view="overview";var overviewHtml=overview();', b);
  assert.equal(tableKeys(b.overviewHtml).length, 6);
  assert.doesNotMatch(b.overviewHtml, /aria-label="Transaction pages"/);
});

test("mobile transaction details toggle only the selected record and render accessible controls", async () => {
  const f = await pullRefreshBrowser(),
    b = f.browser;
  const entry = b.data.transactions[0],
    attributes = {},
    toggles = [];
  const button = {
    dataset: { detailsType: entry.type, detailsRow: String(entry.row) },
    firstChild: { nodeValue: "Details" },
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    closest: () => ({
      classList: { toggle: (name, open) => toggles.push([name, open]) },
    }),
  };
  f.document.querySelectorAll = (selector) =>
    selector === "[data-details-row]" ? [button] : [];
  vm.runInContext("bindContent([])", b);
  button.onclick();
  assert.equal(attributes["aria-expanded"], "true");
  assert.equal(button.firstChild.nodeValue, "Less details");
  const expanded = vm.runInContext("transactionTable(rows(),100,true)", b);
  assert.match(expanded, /transaction-record details-open/);
  assert.match(
    expanded,
    /aria-controls="transaction-expense-2-category transaction-expense-2-group transaction-expense-2-method transaction-expense-2-detail transaction-expense-2-actions"/,
  );
  assert.equal((expanded.match(/data-edit-row=/g) || []).length, 1);
  button.onclick();
  assert.equal(attributes["aria-expanded"], "false");
  assert.equal(button.firstChild.nodeValue, "Details");
  assert.deepEqual(toggles, [
    ["details-open", true],
    ["details-open", false],
  ]);
  assert.doesNotMatch(
    vm.runInContext("transactionTable(rows(),100,false)", b),
    /data-edit-row=|data-delete-row=/,
  );
  assert.doesNotMatch(
    vm.runInContext("transactionTable(rows(),100,true,false)", b),
    /Expense group/,
  );
});

test("mobile card expansion follows a successful edit but not shifted rows after deletion", async () => {
  const f = await pullRefreshBrowser(),
    b = f.browser;
  vm.runInContext(
    "var edited=rows()[0];expandedTransactions.add(transactionDetailKey(edited));",
    b,
  );
  const task = vm.runInContext(
    "refresh({incremental:true,editedTransaction:edited})",
    b,
  );
  const updated = structuredClone(b.data);
  updated.transactions[0].fingerprint = "after-edit";
  updated.transactions[0].amount = 444;
  f.requests[0].success(updated);
  assert.equal(await task, true);
  assert.equal(
    vm.runInContext(
      "expandedTransactions.has(transactionDetailKey(rows()[0]))",
      b,
    ),
    true,
  );
  const read = vm.runInContext("refresh()", b);
  const shifted = structuredClone(updated);
  shifted.transactions[0].fingerprint = "after-deleting-another-row";
  f.requests[1].success(shifted);
  assert.equal(await read, true);
  assert.equal(vm.runInContext("expandedTransactions.size", b), 0);
});

function reviewSnapshot(api) {
  return api
    .getData()
    .transactions.map(
      ({ type, row, fingerprint, decision, reviewNote, duplicateGroup }) => ({
        type,
        row,
        fingerprint,
        decision,
        reviewNote,
        duplicateGroup,
      }),
    );
}
function fragmentedDuplicates() {
  const f = fixture(),
    c = f.config.layout.journal;
  const pattern = [
    ["Group A", 50],
    ["Group A", 50],
    ["Unrelated", 999],
    ["Group A", 50],
    ["Group A", 50],
    ["Group B", 80],
    ["Group B", 80],
    ["Group B", 80],
    ["Group B", 80],
    ["Accepted", 120],
    ["Accepted", 120],
  ];
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    sheet.cells.forEach((row) => row.fill(""));
    pattern.forEach(([description, amount], i) => {
      const row = sheet.cells[i + 1];
      row[c.description - 1] = description;
      row[c.amount - 1] = amount;
      row[c.date - 1] = 46026;
      row[c.category - 1] =
        type === "investment" ? f.config.categories.investment : "Food";
      row[c.duplicateIssue - 1] =
        description === "Unrelated" ? "" : "Possible duplicate";
      row[c.decision - 1] = description === "Accepted" ? "Okay" : "";
      row[c.reviewNote - 1] = "Preserve row " + (i + 2);
    });
  }
  return { ...f, c, api: f.context };
}

test("bulk Okay uses one decision batch and one contiguous note batch per journal", () => {
  const f = bulkFixture();
  const entries = f.entries.map((entry) => ({
    ...entry,
    note: entry.row === 2 ? "=SUM(1,2)" : "Reviewed " + entry.row,
  }));
  const input = {
    action: "okay",
    entries,
    requestId: "batch_review_notes_receipt",
  };
  assert.equal(f.api.bulkReview(input).count, 9);
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    assert.equal(
      sheet.operations.filter((op) => op.kind === "rangeListWrite").length,
      1,
    );
    assert.deepEqual(
      sheet.operations.filter((op) => op.kind === "richText"),
      [{ kind: "richText", row: 2, col: f.c.reviewNote, height: 3, width: 1 }],
    );
    assert.equal(sheet.cells[1][f.c.reviewNote - 1], "=SUM(1,2)");
    assert.equal(sheet.cells[4][f.c.reviewNote - 1], "");
  }
  const counts = Object.values(f.sheets).map(
    (sheet) => sheet.operations.length,
  );
  f.api.bulkReview(input);
  assert.deepEqual(
    Object.values(f.sheets).map((sheet) => sheet.operations.length),
    counts,
  );
});

test("individual group Okay batches nonadjacent decisions and preserves other notes with relocated columns", () => {
  const f = fixture({
      apply(config) {
        config.layout.journal.decision = 28;
        config.layout.journal.reviewNote = 29;
      },
    }),
    api = f.context,
    c = f.config.layout.journal,
    sheet = f.expense;
  for (const row of [3, 5, 6]) sheet.cells[row - 1] = [...sheet.cells[1]];
  sheet.cells[3] = [...sheet.cells[1]];
  sheet.cells[3][c.amount - 1] = 999;
  sheet.cells[3][c.duplicateIssue - 1] = "";
  for (const row of [2, 3, 4, 5, 6])
    sheet.cells[row - 1][c.reviewNote - 1] = "Keep " + row;
  const snapshot = api.getData().transactions,
    clicked = snapshot.find((t) => t.row === 5);
  const members = snapshot.filter(
    (t) => t.duplicateGroup === clicked.duplicateGroup,
  );
  api.setReview({
    type: "expense",
    row: 5,
    fingerprint: clicked.fingerprint,
    entries: members.map(({ row, fingerprint }) => ({ row, fingerprint })),
    decision: "Okay",
    note: "=literal review text",
    requestId: "batch_single_group_receipt",
  });
  assert.deepEqual(
    sheet.operations
      .filter((op) => op.kind === "rangeListWrite")
      .map((op) => op.addresses),
    [["AB2:AB3", "AB5:AB6"]],
  );
  assert.equal(sheet.cells[3][c.decision - 1], "");
  assert.equal(sheet.cells[4][c.reviewNote - 1], "=literal review text");
  for (const row of [2, 3, 4, 6])
    assert.equal(sheet.cells[row - 1][c.reviewNote - 1], "Keep " + row);
});

test("bulk deletion groups consecutive extras bottom-up and repairs each journal once", () => {
  const f = fragmentedDuplicates(),
    api = f.api,
    c = f.c;
  const repairs = [],
    installs = [],
    originalRefresh = api.refreshDateArrays_,
    originalInstall = api.installDuplicateArray_;
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    api.installDuplicateArray_(sheet);
    // The adapter stores formulas without calculating spill results; supply the
    // worksheet's duplicate flags below the live anchor for this fixture.
    for (let row = 3; row <= 12; row++)
      sheet.cells[row - 1][c.duplicateIssue - 1] =
        sheet.cells[row - 1][c.description - 1] === "Unrelated"
          ? ""
          : "Possible duplicate";

    sheet
      .getRange(2, c.dateDerived.year)
      .setFormula('=ARRAYFORMULA(IF(F2:F30="","",YEAR(F2:F30)))');
  }
  api.refreshDateArrays_ = (sheet, restore) => {
    repairs.push(sheet);
    return originalRefresh(sheet, restore);
  };
  api.installDuplicateArray_ = (sheet) => {
    installs.push(sheet);
    return originalInstall(sheet);
  };
  const input = {
    action: "delete",
    entries: reviewSnapshot(api),
    confirmed: true,
    requestId: "grouped_delete_all_receipt",
  };
  assert.equal(api.bulkReview(input).count, 18);
  assert.equal(repairs.length, 3);
  assert.equal(installs.length, 3);
  for (const type of ["expense", "income", "investment"]) {
    const sheet = f.sheets[f.resolve(f.config.sheets[type])];
    assert.deepEqual(
      sheet.operations.filter((op) => op.kind === "deleteRows"),
      [
        { kind: "deleteRows", row: 8, count: 3 },
        { kind: "deleteRows", row: 5, count: 2 },
        { kind: "deleteRows", row: 3, count: 1 },
      ],
    );
    assert.deepEqual(
      sheet.cells.slice(1, 6).map((row) => row[c.description - 1]),
      ["Group A", "Unrelated", "Group B", "Accepted", "Accepted"],
    );
    assert.deepEqual(
      sheet.cells.slice(1, 6).map((row) => row[c.reviewNote - 1]),
      [
        "Preserve row 2",
        "Preserve row 4",
        "Preserve row 7",
        "Preserve row 11",
        "Preserve row 12",
      ],
    );
    assert.match(sheet.getRange(2, c.dateDerived.year).getFormula(), /F2:F24/);
    assert.match(
      sheet.getRange(2, c.duplicateIssue).getFormula(),
      /\$B\$2:\$B\$24/,
    );
  }
  api.bulkReview(input);
  assert.equal(repairs.length, 3);
  assert.equal(installs.length, 3);
});

test("fragmented review queues use bounded decision batches without writing intervening rows", () => {
  const f = fixture(),
    api = f.context,
    c = f.config.layout.journal,
    sheet = f.expense;
  sheet.insertRowsAfter(30, 1000);
  const source = [...sheet.cells[1]];
  for (let i = 0; i < 501; i++) sheet.cells[2 * i + 1] = [...source];
  const input = {
    action: "okay",
    entries: reviewSnapshot(api),
    requestId: "fragmented_review_receipt",
  };
  assert.equal(api.bulkReview(input).count, 501);
  assert.deepEqual(
    sheet.operations
      .filter((op) => op.kind === "rangeListWrite")
      .map((op) => op.addresses.length),
    [250, 250, 1],
  );
  assert.equal(
    sheet.operations.filter((op) => op.kind === "richText").length,
    0,
  );
  for (let row = 3; row < 1002; row += 2)
    assert.equal(sheet.cells[row - 1][c.decision - 1], "");
});

test("partially failed grouped deletions repair formulas and block replay before another row can be removed", () => {
  for (const failAfterWrite of [false, true]) {
    const f = fragmentedDuplicates(),
      api = f.api,
      c = f.c,
      sheet = f.expense;
    sheet
      .getRange(2, c.dateDerived.year)
      .setFormula('=ARRAYFORMULA(IF(F2:F30="","",YEAR(F2:F30)))');
    const input = {
      action: "delete",
      entries: reviewSnapshot(api),
      confirmed: true,
      requestId: "partial_batch_delete_" + failAfterWrite,
    };
    const original = sheet.deleteRows.bind(sheet);
    let calls = 0;
    sheet.deleteRows = (row, count) => {
      calls++;
      if (calls === 2 && !failAfterWrite)
        throw new Error("Simulated deletion failure");
      original(row, count);
      if (calls === 2 && failAfterWrite)
        throw new Error("Simulated lost response");
    };
    assert.throws(() => api.bulkReview(input), /Simulated/);
    const after = JSON.stringify(sheet.cells);
    assert.match(
      sheet.getRange(2, c.dateDerived.year).getFormula(),
      new RegExp("F2:F" + sheet.getMaxRows()),
    );
    assert.throws(() => api.bulkReview(input), /may already have started/);
    assert.equal(calls, 2);
    assert.equal(JSON.stringify(sheet.cells), after);
    assert.equal(
      sheet.cells.filter((row) => row[c.description - 1] === "Unrelated")
        .length,
      1,
    );
    assert.equal(
      sheet.cells.filter((row) => row[c.description - 1] === "Accepted").length,
      2,
    );
  }
});

test("partially failed decision batches block replay without rewriting notes or later journals", () => {
  const f = bulkFixture(),
    sheet = f.expense;
  const original = sheet.getRangeList.bind(sheet);
  let calls = 0;
  sheet.getRangeList = (addresses) => {
    const range = original(addresses),
      write = range.setValue;
    range.setValue = (value) => {
      calls++;
      write(value);
      throw new Error("Simulated decision response loss");
    };
    return range;
  };
  const input = {
    action: "okay",
    entries: f.entries,
    requestId: "partial_decision_receipt",
  };
  assert.throws(() => f.api.bulkReview(input), /Simulated/);
  const after = JSON.stringify(sheet.cells);
  assert.throws(() => f.api.bulkReview(input), /may already have started/);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(sheet.cells), after);
  assert.equal(
    f.sheets[f.resolve(f.config.sheets.income)].operations.length,
    0,
  );
});
