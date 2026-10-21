// Profile settings belong to this owner-only installation, not to the shared source code.
const WORKSPACE_SETTINGS_KEY_ = "kashlo:workspace:v1";
let workspaceConfigCache_ = null;
function workspaceRecord_() {
  const raw = PropertiesService.getScriptProperties().getProperty(
    WORKSPACE_SETTINGS_KEY_,
  );
  if (!raw) return null;
  const record = JSON.parse(raw);
  // A copied script cannot silently connect a different owner to the original owner's workbook.
  return record.ownerEmail ===
    normalized_(Session.getEffectiveUser().getEmail())
    ? record
    : null;
}
function workspaceConfig_() {
  if (workspaceConfigCache_) return workspaceConfigCache_;
  const saved = workspaceRecord_();
  workspaceConfigCache_ = {
    ...FINANCE,
    year: saved?.year || new Date().getFullYear(),
    spreadsheetId: saved?.spreadsheetId || "",
    display: {
      ...FINANCE.display,
      ownerName: saved?.ownerName || "Your workspace",
      ownerInitials: saved?.ownerInitials || "—",
      workspaceLabel: saved?.workspaceLabel || FINANCE.display.workspaceLabel,
      currency: saved?.currency || "USD",
      locale: saved?.locale || "en-US",
    },
  };
  return workspaceConfigCache_;
}
function getWorkspaceSettings() {
  authorize_();
  const saved = workspaceRecord_();
  return {
    setupRequired: !saved,
    revision: saved?.revision || 0,
    ownerEmail: normalized_(Session.getEffectiveUser().getEmail()),
    ownerName: saved?.ownerName || "",
    workspaceLabel: saved?.workspaceLabel || "Personal workspace",
    workbook: saved
      ? "https://docs.google.com/spreadsheets/d/" +
        saved.spreadsheetId +
        "/edit"
      : "",
    currency: saved?.currency || "",
    locale: saved?.locale || "",
    timeZone: saved?.timeZone || "",
    year: saved?.year || new Date().getFullYear(),
  };
}
function workbookId_(value) {
  const text = String(value || "").trim();
  const match = text.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})(?:[/?#].*)?$/,
  );
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
  throw new Error("Enter a Google Sheets workbook URL or ID.");
}
// A workbook is assigned once. A fresh template is the only workbook setup may rename.
function workbookYearPlan_(book, year, previous, spreadsheetId) {
  if (
    previous &&
    previous.spreadsheetId === spreadsheetId &&
    previous.year !== year
  )
    throw new Error(
      "Use a fresh Kashlo workbook and a new deployment for another year. Existing records stay in their original year.",
    );
  const schema = FINANCE.workbookYear;
  const guide = schema && book.getSheetByName(schema.sheet);
  if (
    !guide ||
    guide.getRange(schema.row, schema.labelColumn).getValues()[0][0] !==
      "Workbook year"
  )
    return null; // Older prepared workbooks keep their existing names and formulas.
  const cell = guide.getRange(schema.row, schema.yearColumn);
  const assigned = cell.getValues()[0][0];
  if (assigned !== "") {
    if (Number(assigned) !== year)
      throw new Error(
        "This workbook belongs to " +
          assigned +
          ". Use a fresh Kashlo copy for another year.",
      );
    return null;
  }
  for (const template of Object.values(FINANCE.sheets)) {
    const sheet = book.getSheetByName(template);
    if (!sheet)
      throw new Error(
        "Use a fresh, unconfigured Kashlo template for this year.",
      );
    const c = FINANCE.layout.journal;
    const columns = [
      c.description,
      c.amount,
      c.date,
      c.notes,
      c.trip,
      c.decision,
      c.reviewNote,
      c.paymentMethod,
      c.paymentDetail,
    ];
    const values = sheet
      .getRange(
        c.firstDataRow,
        1,
        sheet.getMaxRows() - c.firstDataRow + 1,
        Math.max(...columns),
      )
      .getValues();
    if (
      values.some((row) =>
        columns.some((column) => String(row[column - 1] ?? "").trim()),
      )
    )
      throw new Error(
        "This unconfigured workbook contains entries. Use an empty Kashlo template; no records were changed.",
      );
  }
  const renames = book
    .getSheets()
    .filter((sheet) => sheet.getName().includes("{year}"))
    .map((sheet) => ({
      sheet,
      before: sheet.getName(),
      after: sheet.getName().replace(/\{year\}/g, String(year)),
    }));
  if (renames.some((item) => book.getSheetByName(item.after)))
    throw new Error(
      "Year-specific tabs already exist. Use a fresh Kashlo template.",
    );
  return { cell, renames };
}
function applyWorkbookYear_(plan, year) {
  if (!plan) return;
  for (const item of plan.renames) item.sheet.setName(item.after);
  plan.cell.setValue(year);
}
function restoreWorkbookYear_(plan) {
  if (!plan) return;
  plan.cell.clearContent();
  for (const item of plan.renames.slice().reverse())
    if (item.sheet.getName() !== item.before) item.sheet.setName(item.before);
}
function validateWorkspaceWorkbook_(book, year, unassigned = false) {
  const missing = [];
  const required = [
    ...Object.values(FINANCE.sheets).map((template) => ({
      name: template.replace(/\{year\}/g, String(year)),
      template,
      rows: FINANCE.layout.journal.firstDataRow,
      columns: Math.max(
        FINANCE.layout.journal.category,
        FINANCE.layout.journal.notes,
        FINANCE.layout.journal.duplicateIssue,
        ...FINANCE.layout.journal.otherIssues,
        FINANCE.layout.journal.reviewNote,
      ),
    })),
    ...Object.entries(FINANCE.lookupSheets).map(([type, name]) => ({
      name,
      rows: FINANCE.layout.lookup.firstDataRow,
      columns: Math.max(
        FINANCE.layout.lookup.categoryOptions,
        type === "expense" ? FINANCE.layout.lookup.trips : 0,
      ),
    })),
    {
      name: FINANCE.dashboardSheet.replace(/\{year\}/g, String(year)),
      template: FINANCE.dashboardSheet,
      rows: FINANCE.layout.dashboard.firstMonthRow + 11,
      columns: FINANCE.layout.dashboard.statusColumn,
    },
  ];
  required.forEach(({ name, template, rows, columns }) => {
    const sheet =
      book.getSheetByName(name) ||
      (unassigned && template && book.getSheetByName(template));
    if (!sheet) missing.push(name);
    else if (sheet.getMaxRows() < rows || sheet.getMaxColumns() < columns)
      missing.push(name + " (required rows/columns are missing)");
  });
  if (!missing.length) {
    Object.values(FINANCE.sheets).forEach((template) => {
      const name = template.replace(/\{year\}/g, String(year));
      const sheet =
        book.getSheetByName(name) ||
        (unassigned && book.getSheetByName(template));
      if (
        !sheet
          .getRange(
            FINANCE.layout.journal.firstDataRow,
            FINANCE.layout.journal.duplicateIssue,
          )
          .getFormulas()[0][0]
      )
        missing.push(name + " (prepared duplicate-check formulas are missing)");
    });
  }
  if (missing.length)
    throw new Error(
      "This workbook is missing the required Kashlo layout: " +
        missing.join(", ") +
        ". Use a compatible Kashlo workbook for " +
        year +
        ".",
    );
}
function saveWorkspaceSettings(input) {
  if (!input || typeof input !== "object")
    throw new Error("Enter your workspace settings.");
  return withWrite_(input.requestId, () => {
    const previous = workspaceRecord_();
    if (input.revision !== (previous?.revision || 0))
      throw new Error(
        "These settings changed in another tab. Reload Profile & settings before saving.",
      );
    const ownerName = String(input.ownerName || "").trim(),
      workspaceLabel = String(input.workspaceLabel || "").trim(),
      currency = String(input.currency || "")
        .trim()
        .toUpperCase(),
      locale = String(input.locale || "").trim(),
      timeZone = String(input.timeZone || "").trim(),
      year = Number(input.year),
      spreadsheetId = workbookId_(input.workbook);
    if (
      !ownerName ||
      ownerName.length > 80 ||
      !workspaceLabel ||
      workspaceLabel.length > 80
    )
      throw new Error(
        "Enter an owner and workspace name up to 80 characters each.",
      );
    if (!Number.isInteger(year) || year < 1900 || year > 9999)
      throw new Error("Enter a valid four-digit year.");
    // Intl validates the presentation choices before any sheet or settings change.
    if (!/^[A-Z]{3}$/.test(currency))
      throw new Error(
        "Choose a three-letter currency code, such as INR or USD.",
      );
    try {
      if (
        !locale ||
        !Intl.NumberFormat.supportedLocalesOf([locale]).length ||
        !Intl.DateTimeFormat.supportedLocalesOf([locale]).length
      )
        throw new Error();
      new Intl.NumberFormat(locale, { style: "currency", currency }).format(1);
    } catch (error) {
      throw new Error("Choose a supported locale and currency code.");
    }
    try {
      if (!timeZone) throw new Error();
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    } catch (error) {
      throw new Error("Choose a valid time zone, such as Asia/Kolkata or UTC.");
    }
    let book;
    try {
      book = SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      throw new Error(
        "This Google account cannot open that workbook. Check its URL and access.",
      );
    }
    const yearPlan = workbookYearPlan_(book, year, previous, spreadsheetId);
    validateWorkspaceWorkbook_(book, year, !!yearPlan);
    const record = {
      ownerEmail: normalized_(Session.getEffectiveUser().getEmail()),
      ownerName,
      ownerInitials: ownerName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => Array.from(part)[0])
        .join("")
        .toUpperCase(),
      workspaceLabel,
      spreadsheetId,
      currency,
      locale: Intl.getCanonicalLocales(locale)[0],
      timeZone,
      year,
      revision: (previous?.revision || 0) + 1,
    };
    const previousZone = book.getSpreadsheetTimeZone();
    // Also verifies edit access when the selected time zone is unchanged.
    try {
      book.setSpreadsheetTimeZone(timeZone);
    } catch (error) {
      throw new Error(
        "This workbook must be editable by your Google account. Check workbook access and the selected time zone.",
      );
    }
    try {
      applyWorkbookYear_(yearPlan, year);
      validateWorkspaceWorkbook_(book, year);
      PropertiesService.getScriptProperties().setProperty(
        WORKSPACE_SETTINGS_KEY_,
        JSON.stringify(record),
      );
    } catch (error) {
      restoreWorkbookYear_(yearPlan);
      if (previousZone !== timeZone) book.setSpreadsheetTimeZone(previousZone);
      throw error;
    }
    workspaceConfigCache_ = null;
    return { ok: true, profile: getWorkspaceSettings() };
  });
}
// Every mutation must belong to the snapshot's workspace. An older tab cannot write to a new workbook.
function withWorkspaceWrite_(input, action, prepare) {
  const validateWorkspace = () => {
    const record = workspaceRecord_();
    if (!record) throw new Error("Complete Profile & settings before saving.");
    if (input.workspaceRevision !== record.revision)
      throw new Error(
        "Workspace settings changed. Refresh the app before saving.",
      );
    workspaceConfigCache_ = null;
  };
  return withWrite_(
    input.requestId,
    (prepared) => {
      if (!prepare) validateWorkspace();
      return action(prepared);
    },
    prepare
      ? () => {
          validateWorkspace();
          return prepare();
        }
      : undefined,
  );
}

// Config.gs supplies the shared schema; personal values come from saved profile settings.
// Read configuration inside functions so Apps Script file evaluation order does not matter.
function validateConfig_() {
  if (
    !Number.isInteger(workspaceConfig_().year) ||
    workspaceConfig_().year < 1900 ||
    workspaceConfig_().year > 9999
  )
    throw new Error("Choose a valid four-digit year in Profile & settings.");
  if (!workspaceConfig_().spreadsheetId)
    throw new Error("Complete Profile & settings to connect your workbook.");
}

// Resolve year placeholders without requiring sheet names to follow one naming convention.
function sheetName_(template) {
  return template.replace(/\{year\}/g, String(workspaceConfig_().year));
}

function requiredSheet_(book, template) {
  const name = sheetName_(template),
    sheet = book.getSheetByName(name);
  if (!sheet)
    throw new Error("Worksheet not found: " + name + ". Check Config.gs.");
  return sheet;
}

// Read enough columns for configured inputs, formula checks, reviews, and fingerprints.
function journalWidth_() {
  const columns = workspaceConfig_().layout.journal;
  return Math.max(
    columns.description,
    columns.amount,
    columns.date,
    columns.category,
    columns.notes,
    columns.trip,
    columns.paymentMethod,
    columns.paymentDetail,
    columns.duplicateIssue,
    columns.decision,
    columns.reviewNote,
    ...columns.otherIssues,
    ...columns.fingerprintColumns,
  );
}

function mappingRows_(sheet, extraColumns = []) {
  const columns = workspaceConfig_().layout.lookup;
  return sheet
    .getRange(
      columns.firstDataRow,
      1,
      sheet.getMaxRows() - columns.firstDataRow + 1,
      Math.max(columns.description, columns.category, ...extraColumns),
    )
    .getDisplayValues();
}

// Send only presentation settings to the authorized browser, never the full server config.
// Use the workbook time zone for today's date; other years start on January 1.
function clientConfig_(zone) {
  const today = Utilities.formatDate(new Date(), zone, "yyyy-MM-dd");
  const defaultDate =
    Number(today.slice(0, 4)) === workspaceConfig_().year
      ? today
      : workspaceConfig_().year + "-01-01";
  return {
    year: workspaceConfig_().year,
    ...workspaceConfig_().display,
    categories: workspaceConfig_().categories,
    reviewHelp: workspaceConfig_().reviewHelp,
    monthStatuses: workspaceConfig_().monthStatuses,
    paymentMethods: workspaceConfig_().paymentMethods,
    limits: {
      descriptionLength: workspaceConfig_().limits.descriptionLength,
      noteLength: workspaceConfig_().limits.noteLength,
      groupNameLength: workspaceConfig_().limits.groupNameLength,
    },
    timeZone: zone,
    defaultDate,
  };
}

// Web app entry point for an HTTP GET to the deployment URL.
// Check the caller before serving Index.html, then set the browser title and mobile viewport.
function doGet() {
  authorize_();
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle(workspaceConfig_().display.appTitle)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// Deployment stays owner-only and executes as its deployer. Profile input never chooses an account.
// When Google exposes an active user, it must be the same account as the execution user.
function authorize_() {
  const effective = normalized_(Session.getEffectiveUser().getEmail());
  const active = normalized_(Session.getActiveUser().getEmail());
  if (!effective || (active && active !== effective))
    throw new Error("This app is private to the owner of the expense tracker.");
}
// Open the configured spreadsheet. Public callers perform authorization before using this helper.
function book_() {
  validateConfig_();
  const book = SpreadsheetApp.openById(workspaceConfig_().spreadsheetId);
  const schema = FINANCE.workbookYear;
  const guide = schema && book.getSheetByName(schema.sheet);
  if (
    guide &&
    guide.getRange(schema.row, schema.labelColumn).getValues()[0][0] ===
      "Workbook year" &&
    Number(guide.getRange(schema.row, schema.yearColumn).getValues()[0][0]) !==
      workspaceConfig_().year
  )
    throw new Error(
      "The workbook year does not match this app. Restore its assigned year or connect the correct yearly workbook.",
    );
  return book;
}
// Resolve a supported journal type and fail clearly if its worksheet is missing.
function sheet_(book, type) {
  // Check own keys so inherited object properties cannot be used as journal names.
  if (!Object.prototype.hasOwnProperty.call(workspaceConfig_().sheets, type))
    throw new Error("Unknown journal.");
  return requiredSheet_(book, workspaceConfig_().sheets[type]);
}
// Store user-supplied text as a rich-text value rather than a spreadsheet formula.
// String conversion gives descriptions, categories, notes, and status cells a text value.
function literal_(range, value) {
  range.setRichTextValue(
    SpreadsheetApp.newRichTextValue().setText(String(value)).build(),
  );
}
// Read a one-based worksheet column below its header, using visible cell text.
// Flatten the rows, trim spaces, discard blanks, and preserve each distinct option once.
// This uses all prepared rows, not just the last populated row.
function options_(sheet, column, rows) {
  // Reuse a caller's lookup read when multiple lists share the same sheet.
  const values = rows
    ? rows.map((row) => row[column - 1])
    : sheet
        .getRange(
          workspaceConfig_().layout.lookup.firstDataRow,
          column,
          sheet.getMaxRows() -
            workspaceConfig_().layout.lookup.firstDataRow +
            1,
          1,
        )
        .getDisplayValues()
        .flat();
  return [...new Set(values.map((s) => s.trim()).filter(Boolean))];
}
// Normalize descriptions for case-insensitive matching, ignoring surrounding spaces.
function normalized_(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
// Convert a sheet date into the YYYY-MM-DD string sent to the browser.
// Date objects use the workbook time zone. Numeric dates use the spreadsheet serial-date
// base of 30 December 1899 and UTC arithmetic; unsupported or invalid values return an empty string.
function dateString_(date, zone, cache) {
  const isDate = date instanceof Date;
  if (
    isDate
      ? isNaN(date.getTime())
      : typeof date !== "number" || !isFinite(date) || date <= 0
  )
    return "";
  // The optional cache belongs to one snapshot and one time zone, never another request.
  const key = isDate ? "d" + date.getTime() : "n" + date;
  if (cache?.has(key)) return cache.get(key);
  const value = isDate
    ? Utilities.formatDate(date, zone, "yyyy-MM-dd")
    : new Date(Date.UTC(1899, 11, 30) + date * 86400000)
        .toISOString()
        .slice(0, 10);
  cache?.set(key, value);
  return value;
}
// Hash the configured source columns to detect changes before a review write.
// Normalize date values before JSON serialization. Fingerprints cover source and payment fields
// and excludes review fields T:U; the SHA-256 digest uses web-safe Base64.
// Include the worksheet row count so deletion invalidates stale row references,
// even when the next row contains an identical duplicate.
function fingerprint_(row, zone, rowCount, dates) {
  const payload = workspaceConfig_().layout.journal.fingerprintColumns.map(
    (column) => {
      const value = row[column - 1];
      return column === workspaceConfig_().layout.journal.date ||
        value instanceof Date
        ? dateString_(value, zone, dates)
        : value;
    },
  );
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify({ rowCount, payload }),
    ),
  );
}
// Normalize only comparison text; never rewrite the recorded transaction.
function duplicateText_(value) {
  // Match the worksheet's RE2 \s class and TRIM exactly, including imported text.
  return String(value ?? "")
    .replace(/[ \t\n\f\r]+/g, " ")
    .replace(/^ +| +$/g, "")
    .toLowerCase();
}
// Every journal uses the same day, description, amount, and recorded payment details.
// The worksheet Q flag identifies candidates; Okay only accepts this exact matching group.
function duplicateGroup_(values, type, zone, dates) {
  const c = workspaceConfig_().layout.journal;
  if (!values[c.duplicateIssue - 1]) return "";
  const description = duplicateText_(values[c.description - 1]),
    date = dateString_(values[c.date - 1], zone, dates),
    amount = values[c.amount - 1];
  if (!description || !date || typeof amount !== "number" || !isFinite(amount))
    return "";
  return JSON.stringify([
    type,
    description,
    date,
    amount,
    duplicateText_(values[c.paymentMethod - 1]),
    duplicateText_(values[c.paymentDetail - 1]),
  ]);
}
// Generate the same policy for worksheet column Q. Used for audited migrations/template setup,
// never on each refresh. Bounded ranges avoid scanning entire columns for every prepared row.
function duplicateFormula_(row, lastRow) {
  const c = workspaceConfig_().layout.journal;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(lastRow) ||
    row < c.firstDataRow ||
    row > lastRow
  )
    throw new Error("Choose a prepared journal row.");
  const column = (number) => {
    let label = "";
    while (number > 0) {
      number--;
      label = String.fromCharCode(65 + (number % 26)) + label;
      number = Math.floor(number / 26);
    }
    return label;
  };
  const cell = (number) => "$" + column(number) + row;
  const range = (number) =>
    "$" +
    column(number) +
    "$" +
    c.firstDataRow +
    ":$" +
    column(number) +
    "$" +
    lastRow;
  const text = (ref) =>
    "LOWER(TRIM(REGEXREPLACE(TO_TEXT(" + ref + '),"\\s+"," ")))';
  const comparisons = [
    "N(" + text(range(c.description)) + "=" + text(cell(c.description)) + ")",
    "N(ISNUMBER(" + range(c.amount) + "))",
    "N(" + range(c.amount) + "=" + cell(c.amount) + ")",
    "N(ISNUMBER(" + range(c.date) + "))",
    "N(IFERROR(INT(" + range(c.date) + "),-1)=INT(" + cell(c.date) + "))",
    "N(" +
      text(range(c.paymentMethod)) +
      "=" +
      text(cell(c.paymentMethod)) +
      ")",
    "N(" +
      text(range(c.paymentDetail)) +
      "=" +
      text(cell(c.paymentDetail)) +
      ")",
  ];
  return (
    "=IF(OR(" +
    text(cell(c.description)) +
    '="",NOT(ISNUMBER(' +
    cell(c.amount) +
    ")),NOT(ISNUMBER(" +
    cell(c.date) +
    '))),"",IF(SUMPRODUCT(ARRAYFORMULA(' +
    comparisons.join("*") +
    '))>1,"Possible duplicate",""))'
  );
}

// Sort comparison fields once, compare neighboring records, then restore physical row order.
// One spilling formula avoids repeating full-journal text normalization for every entry.
function duplicateArrayFormula_(lastRow) {
  const c = workspaceConfig_().layout.journal;
  if (!Number.isInteger(lastRow) || lastRow < c.firstDataRow)
    throw new Error("Choose a prepared journal row.");
  const range = (column) => {
    let label = "";
    while (column > 0) {
      column--;
      label = String.fromCharCode(65 + (column % 26)) + label;
      column = Math.floor(column / 26);
    }
    return "$" + label + "$" + c.firstDataRow + ":$" + label + "$" + lastRow;
  };
  const text = (ref) =>
    "ARRAYFORMULA(LOWER(TRIM(REGEXREPLACE(TO_TEXT(" + ref + '),"\\s+"," "))))';
  const amount = range(c.amount),
    date = range(c.date);
  const size = lastRow - c.firstDataRow + 1;
  if (size === 1) return '=LET(descriptions,"",IF(TRUE,"",""))';
  const comparisons = [1, 2, 3, 4, 5].map(
    (column) =>
      "(CHOOSECOLS(earlier," + column + ")=CHOOSECOLS(later," + column + "))",
  );
  return (
    "=LET(descriptions," +
    text(range(c.description)) +
    ",sourceAmounts," +
    amount +
    ",sourceDates," +
    date +
    ",validAmounts,ARRAYFORMULA(ISNUMBER(sourceAmounts)),validDates,ARRAYFORMULA(ISNUMBER(sourceDates))," +
    "amounts,ARRAYFORMULA(IF(validAmounts,sourceAmounts,0)),days,ARRAYFORMULA(IFERROR(INT(sourceDates),0)),methods," +
    text(range(c.paymentMethod)) +
    ",details," +
    text(range(c.paymentDetail)) +
    ',valid,ARRAYFORMULA((descriptions<>"")*validAmounts*validDates),' +
    "ordered,SORT(HSTACK(descriptions,amounts,days,methods,details,SEQUENCE(ROWS(descriptions)),valid),1,TRUE,2,TRUE,3,TRUE,4,TRUE,5,TRUE)," +
    "earlier,CHOOSEROWS(ordered,SEQUENCE(" +
    (size - 1) +
    "))," +
    "later,CHOOSEROWS(ordered,SEQUENCE(" +
    (size - 1) +
    ",1,2))," +
    "matches,ARRAYFORMULA(CHOOSECOLS(earlier,7)*CHOOSECOLS(later,7)*" +
    comparisons.join("*") +
    ")," +
    'flags,ARRAYFORMULA(IF(VSTACK(0,matches)+VSTACK(matches,0)>0,"Possible duplicate","")),' +
    "CHOOSECOLS(SORT(HSTACK(CHOOSECOLS(ordered,6),flags),1,TRUE),2))"
  );
}

function installDuplicateArray_(sheet) {
  const c = workspaceConfig_().layout.journal;
  const lastRow = sheet.getMaxRows();
  const formula = duplicateArrayFormula_(lastRow);
  const anchor = sheet.getRange(c.firstDataRow, c.duplicateIssue);
  if (anchor.getFormula() === formula) return;
  const range = sheet.getRange(
    c.firstDataRow,
    c.duplicateIssue,
    lastRow - c.firstDataRow + 1,
    1,
  );
  // Q is a generated check column; decisions and notes in T:U are never cleared.
  range.clearContent();
  anchor.setFormula(formula);
}

function refreshDateArrays_(sheet, restore = []) {
  const c = workspaceConfig_().layout.journal;
  const dates = sheet
    .getRange(
      c.firstDataRow,
      c.date,
      sheet.getMaxRows() - c.firstDataRow + 1,
      1,
    )
    .getA1Notation();
  for (const [part, column] of Object.entries(c.dateDerived || {})) {
    const anchor = sheet.getRange(c.firstDataRow, column),
      current = anchor.getFormula();
    if (!restore.includes(column) && !/ARRAYFORMULA/i.test(current)) continue;
    const expected =
      "=ARRAYFORMULA(IF(" +
      dates +
      '="","",' +
      part.toUpperCase() +
      "(" +
      dates +
      ")))";
    if (current !== expected) anchor.setFormula(expected);
  }
}

// copyTo uses the destination's top-left cell; autofill explicitly extends the formula below it.
function fillJournalFormula_(source, sheet, column, start, count) {
  const first = sheet.getRange(start, column);
  source.copyTo(first, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  if (count > 1)
    first.autoFill(
      sheet.getRange(start, column, count, 1),
      SpreadsheetApp.AutoFillSeries.DEFAULT_SERIES,
    );
}

// Expand only when the next entry needs space. Never copy transaction values or review decisions.
function ensureJournalCapacity_(sheet, row, book) {
  const before = sheet.getMaxRows();
  if (row <= before) return;
  const c = workspaceConfig_().layout.journal;
  const batch = workspaceConfig_().limits.journalGrowthRows || 250;
  const count = Math.max(batch, row - before);
  sheet.insertRowsAfter(before, count);
  const target = sheet.getRange(before + 1, 1, count, journalWidth_());
  const exemplar = sheet.getRange(before, 1, 1, journalWidth_());
  exemplar.copyFormatToRange(
    sheet,
    1,
    journalWidth_(),
    before + 1,
    before + count,
  );
  const validation = exemplar.getDataValidations()[0];
  target.setDataValidations(
    Array.from({ length: count }, () => validation.slice()),
  );
  // Category cells can be manually overridden, so find an actual formula instead of copying a value.
  for (const column of [c.category, ...c.otherIssues]) {
    const formulas = sheet
      .getRange(c.firstDataRow, column, before - c.firstDataRow + 1, 1)
      .getFormulas();
    const source = formulas.findIndex(
      ([formula]) => formula && !/ARRAYFORMULA/i.test(formula),
    );
    if (source >= 0)
      fillJournalFormula_(
        sheet.getRange(c.firstDataRow + source, column),
        sheet,
        column,
        before + 1,
        count,
      );
    else if (
      c.otherIssues.indexOf(column) >= 0 &&
      c.otherIssues.indexOf(column) < 2
    ) {
      const ref = (number) =>
        sheet.getRange(before + 1, number).getA1Notation();
      const used =
        "OR(" +
        [c.description, c.amount, c.date]
          .map((number) => ref(number) + '<>""')
          .join(",") +
        ")";
      const formula =
        c.otherIssues.indexOf(column) === 0
          ? "=IF(AND(" +
            used +
            ",IFERROR(LEN(" +
            ref(c.category) +
            ')=0,TRUE)),"Missing category","")'
          : "=IF(AND(" +
            used +
            ",OR(" +
            ref(c.description) +
            '="",NOT(ISNUMBER(' +
            ref(c.amount) +
            ")),NOT(ISNUMBER(" +
            ref(c.date) +
            ')))),"Incomplete entry","")';
      sheet.getRange(before + 1, column).setFormula(formula);
      if (count > 1)
        sheet
          .getRange(before + 1, column)
          .autoFill(
            sheet.getRange(before + 1, column, count, 1),
            SpreadsheetApp.AutoFillSeries.DEFAULT_SERIES,
          );
    }
  }
  // Support both existing spilling columns and older per-row date formulas.
  for (const [part, column] of Object.entries(c.dateDerived || {})) {
    if (
      /ARRAYFORMULA/i.test(sheet.getRange(c.firstDataRow, column).getFormula())
    )
      continue;
    const date = sheet.getRange(before + 1, c.date).getA1Notation();
    sheet
      .getRange(before + 1, column)
      .setFormula(
        "=IF(" + date + '="","",' + part.toUpperCase() + "(" + date + "))",
      );
    if (count > 1)
      sheet
        .getRange(before + 1, column)
        .autoFill(
          sheet.getRange(before + 1, column, count, 1),
          SpreadsheetApp.AutoFillSeries.DEFAULT_SERIES,
        );
  }
  refreshDateArrays_(sheet);
  installDuplicateArray_(sheet);
  if (book) {
    ensureReviewCapacity_(book);
    refreshWorkbookFormulaRanges_(book, sheet, before);
  }
}

// Rewrite only quoted journal references, never quoted text or deliberate subranges.
// `before` identifies the previous capacity; already-updated and unrelated bounds stay intact.
function boundJournalFormula_(formula, capacities) {
  return formula.replace(
    /"(?:[^"]|"")*"|'((?:[^']|'')+)'!(\$?[A-Z]+)(\$?\d+):(\$?[A-Z]+)(\$?\d+)?/gi,
    (match, quotedName, firstColumn, firstRow, lastColumn, lastRow) => {
      if (!quotedName) return match;
      const capacity = capacities.get(quotedName.replace(/''/g, "'"));
      if (
        !capacity ||
        (lastRow && Number(lastRow.replace("$", "")) !== capacity.before)
      )
        return match;
      if (Number(firstRow.replace("$", "")) > capacity.after) return match;
      const absolute = lastRow
        ? lastRow.startsWith("$")
        : firstRow.startsWith("$");
      return (
        "'" +
        quotedName +
        "'!" +
        firstColumn +
        firstRow +
        ":" +
        lastColumn +
        (absolute ? "$" : "") +
        capacity.after
      );
    },
  );
}
// Capacity growth is the only caller. Ordinary reads, edits, and reviews do not
// scan or rewrite dashboard formulas. Blank cells and manual values are never replaced.
function refreshWorkbookFormulaRanges_(book, grownSheet, previousRows) {
  const config = workspaceConfig_(),
    capacities = new Map();
  Object.keys(config.sheets).forEach((type) => {
    const journal = sheet_(book, type),
      after = journal.getMaxRows();
    capacities.set(sheetName_(config.sheets[type]), {
      before: journal === grownSheet ? previousRows : after,
      after,
    });
  });
  for (const [key, addresses] of Object.entries(config.formulaRanges || {})) {
    const name = config[key + "Sheet"];
    if (!name) continue;
    const sheet = book.getSheetByName(sheetName_(name));
    if (!sheet) continue;
    for (const address of addresses) {
      const range = sheet.getRange(address),
        formulas = range.getFormulas();
      const firstRow = range.getRow(),
        firstColumn = range.getColumn();
      formulas.forEach((row, offset) => {
        let start = -1,
          updates = [];
        const flush = () => {
          if (start >= 0)
            sheet
              .getRange(
                firstRow + offset,
                firstColumn + start,
                1,
                updates.length,
              )
              .setFormulas([updates]);
          start = -1;
          updates = [];
        };
        row.forEach((formula, column) => {
          const updated = formula
            ? boundJournalFormula_(formula, capacities)
            : formula;
          if (updated === formula) {
            flush();
            return;
          }
          if (start < 0) start = column;
          updates.push(updated);
        });
        flush();
      });
    }
  }
}

// The optional native review sheet must also have room for every possible flagged entry.
function ensureReviewCapacity_(book) {
  const config = workspaceConfig_();
  if (!config.reviewSheet) return;
  const review = book.getSheetByName(sheetName_(config.reviewSheet));
  if (!review) return;
  const needed =
    4 +
    Object.keys(config.sheets).reduce(
      (total, type) =>
        total +
        Math.max(
          0,
          sheet_(book, type).getMaxRows() -
            config.layout.journal.firstDataRow +
            1,
        ),
      0,
    );
  const before = review.getMaxRows();
  if (needed <= before) return;
  review.insertRowsAfter(before, needed - before);
  review
    .getRange(before, 1, 1, review.getMaxColumns())
    .copyFormatToRange(review, 1, review.getMaxColumns(), before + 1, needed);
  const links = review.getRange(5, 8),
    formula = links.getFormula();
  if (/^=MAP\(A5:A\d+,G5:G\d+,/i.test(formula))
    links.setFormula(
      formula
        .replace(/A5:A\d+/g, "A5:A" + needed)
        .replace(/G5:G\d+/g, "G5:G" + needed),
    );
}

// Read-only endpoint used for the initial load and manual refresh.
// Return transactions, review issues, dropdown options, mappings, month statuses, and the sheet URL.
// Sheet column numbers are one-based; arrays returned by getValues are zero-based.
function getData() {
  authorize_();
  const lock = LockService.getScriptLock();
  lock.waitLock(FINANCE.limits.writeLockTimeoutMs);
  try {
    workspaceConfigCache_ = null;
    return dataSnapshot_();
  } finally {
    lock.releaseLock();
  }
}
function dataSnapshot_() {
  if (!workspaceConfig_().spreadsheetId)
    return { setupRequired: true, profile: getWorkspaceSettings() };
  const book = book_(),
    zone = book.getSpreadsheetTimeZone(),
    transactions = [],
    dates = new Map(),
    columns = workspaceConfig_().layout.journal;
  const paymentRecords = ensurePaymentStorage_(book),
    paymentMethods = paymentMethods_(book);
  ensureReviewCapacity_(book);
  // Read through payment details below the header of each journal, including formula-prepared rows.
  Object.keys(workspaceConfig_().sheets).forEach((type) => {
    const sheet = sheet_(book, type),
      rowCount = sheet.getMaxRows(),
      rows = sheet
        .getRange(
          columns.firstDataRow,
          1,
          rowCount - columns.firstDataRow + 1,
          journalWidth_(),
        )
        .getValues();
    rows.forEach((r, index) => {
      const date = dateString_(r[columns.date - 1], zone, dates);
      // Ignore rows with no description in B, no amount in C, and no usable date in F.
      if (!r[columns.description - 1] && r[columns.amount - 1] === "" && !date)
        return;
      // Review columns: Q = duplicate check, R and S = other sheet checks,
      // T = review decision, U = review note. An Okay decision suppresses only the Q issue.
      const decision = String(r[columns.decision - 1] || ""),
        issues = [];
      if (r[columns.duplicateIssue - 1] && decision !== "Okay")
        issues.push(String(r[columns.duplicateIssue - 1]));
      columns.otherIssues.forEach((column) => {
        if (r[column - 1]) issues.push(String(r[column - 1]));
      });
      // Keep the physical sheet row for later review updates. Read B/C/F/G/H as
      //  description/amount/date/category/notes; read trip I only for expenses.
      //  Non-numeric amounts become null, and blank review decisions are shown as Pending.
      transactions.push({
        type,
        row: index + columns.firstDataRow,
        description: String(r[columns.description - 1] || ""),
        amount:
          typeof r[columns.amount - 1] === "number"
            ? r[columns.amount - 1]
            : null,
        date,
        category: String(r[columns.category - 1] || ""),
        notes: String(r[columns.notes - 1] || ""),
        trip: type === "expense" ? String(r[columns.trip - 1] || "") : "",
        paymentMethod: String(r[columns.paymentMethod - 1] || ""),
        paymentDetail: String(r[columns.paymentDetail - 1] || ""),
        issues,
        decision: decision || "Pending",
        reviewNote: String(r[columns.reviewNote - 1] || ""),
        fingerprint: fingerprint_(r, zone, rowCount, dates),
        duplicateGroup: duplicateGroup_(r, type, zone, dates),
      });
    });
  });
  // Lookup worksheets provide description/category pairs in A:B and category choices in D.
  const mapping = requiredSheet_(book, workspaceConfig_().lookupSheets.expense),
    incomeMapping = requiredSheet_(
      book,
      workspaceConfig_().lookupSheets.income,
    ),
    investmentMapping = requiredSheet_(
      book,
      workspaceConfig_().lookupSheets.investment,
    );
  const mappings = {},
    lookupRows = new Map(),
    lookupColumns = workspaceConfig_().layout.lookup;
  // Each journal has independent reusable descriptions and categories.
  [
    ["expense", mapping],
    ["income", incomeMapping],
    ["investment", investmentMapping],
  ].forEach(([type, sheet]) => {
    const width = Math.max(
      lookupColumns.description,
      lookupColumns.category,
      lookupColumns.categoryOptions,
      type === "expense" ? lookupColumns.trips : 0,
    );
    const rows = sheet
      .getRange(
        lookupColumns.firstDataRow,
        1,
        sheet.getMaxRows() - lookupColumns.firstDataRow + 1,
        width,
      )
      .getDisplayValues();
    lookupRows.set(sheet, rows);
    mappings[type] = rows
      .filter(
        (r) =>
          r[lookupColumns.description - 1].trim() &&
          r[lookupColumns.category - 1].trim(),
      )
      .map((r) => ({
        description: r[lookupColumns.description - 1].trim(),
        category: r[lookupColumns.category - 1].trim(),
      }));
  });
  // Monthly completeness is stored in the existing dashboard rather than inferred from totals.
  const dashboard = requiredSheet_(book, workspaceConfig_().dashboardSheet);
  // Expense groups come from Item & Category column H; dashboard F12:F23 holds January through December.
  return {
    workspaceRevision: workspaceRecord_()?.revision || 0,
    year: workspaceConfig_().year,
    config: { ...clientConfig_(zone), paymentMethods },
    updatedAt: new Date().toISOString(),
    transactions,
    categories: {
      expense: options_(
        mapping,
        workspaceConfig_().layout.lookup.categoryOptions,
        lookupRows.get(mapping),
      ),
      income: options_(
        incomeMapping,
        workspaceConfig_().layout.lookup.categoryOptions,
        lookupRows.get(incomeMapping),
      ),
      investment: lookupCategories_(investmentMapping, "investment", lookupRows.get(investmentMapping)),
    },
    mappings,
    paymentOptions: paymentOptions_(book, paymentMethods, paymentRecords),
    trips: options_(
      mapping,
      workspaceConfig_().layout.lookup.trips,
      lookupRows.get(mapping),
    ),
    monthStatus: dashboard
      .getRange(
        workspaceConfig_().layout.dashboard.firstMonthRow,
        workspaceConfig_().layout.dashboard.statusColumn,
        12,
        1,
      )
      .getDisplayValues()
      .flat(),
    sheetUrl: book.getUrl(),
  };
}

// Validate a real calendar date in the configured year and convert it to a numeric sheet date.
// The component round trip rejects impossible dates such as 31 February instead of accepting Date rollover.
function dateSerial_(text) {
  if (
    typeof text !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number(text.slice(0, 4)) !== workspaceConfig_().year
  )
    throw new Error("Choose a date in " + workspaceConfig_().year + ".");
  const [y, m, d] = text.split("-").map(Number),
    value = new Date(Date.UTC(y, m - 1, d));
  if (
    value.getUTCFullYear() !== y ||
    value.getUTCMonth() !== m - 1 ||
    value.getUTCDate() !== d
  )
    throw new Error("Invalid date.");
  return (value.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}
// Validate the client submission token and namespace its persistent retry record.
function requestId_(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{12,100}$/.test(id))
    throw new Error("Invalid submission. Refresh and try again.");
  return "request:" + id;
}
// Common wrapper for all writes: authorize, serialize script writes, and record submission IDs.
// A completed request returns its saved result on retry. A started request is blocked from replay
// because it may have partially written. This is retry protection, not a transaction rollback.
function withWrite_(requestId, action, prepare) {
  authorize_();
  const key = requestId_(requestId),
    lock = LockService.getScriptLock();
  // Wait for another script write using the configured timeout; direct sheet edits do not use this lock.
  lock.waitLock(workspaceConfig_().limits.writeLockTimeoutMs);
  try {
    const properties = PropertiesService.getScriptProperties(),
      previous = properties.getProperty(key);
    // Look up the submission before running its action, so the same request does not write twice.
    if (previous) {
      const record = JSON.parse(previous);
      if (record.status === "success") return record.result;
      throw new Error(
        "This submission may already have started. Refresh and check the sheet before creating a new submission.",
      );
    }
    // Optional read-only validation runs under the lock, after receipt lookup but
    // before marking a write as started. Invalid fields can be corrected using the
    // same submission ID. Once action starts, any failure still blocks replay.
    const prepared = prepare ? prepare() : undefined;
    // Persist the started marker before calling action; failures leave it in place for inspection on retry.
    properties.setProperty(
      key,
      JSON.stringify({ at: Date.now(), status: "started" }),
    );
    const result = action(prepared);
    // Apply pending spreadsheet changes before recording the successful response.
    SpreadsheetApp.flush();
    properties.setProperty(
      key,
      JSON.stringify({ at: Date.now(), status: "success", result }),
    );
    // Retain retry protection for the configured number of days.
    const all = properties.getProperties();
    Object.keys(all)
      .filter((k) => k.startsWith("request:"))
      .forEach((k) => {
        // Remove old retry records; malformed records are ignored by this cleanup loop.
        try {
          if (
            JSON.parse(all[k]).at <
            Date.now() - workspaceConfig_().limits.retryRetentionDays * 86400000
          )
            properties.deleteProperty(k);
        } catch (e) {}
      });
    return result;
    // Release the script lock on both success and failure; completed cell writes are not undone.
  } finally {
    lock.releaseLock();
  }
}

// Share the same validation for new entries and corrections. No cells are changed here.
function transactionValues_(book, input) {
  const description = String(input.description || "").trim(),
    amount = Number(input.amount),
    date = dateSerial_(input.date),
    notes = String(input.notes || "");
  // Require a description and enforce the configured length and amount limits.
  if (
    !description ||
    description.length > workspaceConfig_().limits.descriptionLength
  )
    throw new Error(
      "Enter a description, up to " +
        workspaceConfig_().limits.descriptionLength +
        " characters.",
    );
  if (
    !isFinite(amount) ||
    amount <= 0 ||
    amount > workspaceConfig_().limits.maximumAmount
  )
    throw new Error(
      "Enter a positive amount greater than 0 and within the allowed limit.",
    );
  if (notes.length > workspaceConfig_().limits.noteLength)
    throw new Error(
      "Notes must be at most " +
        workspaceConfig_().limits.noteLength +
        " characters.",
    );
  // Keep expense, income, and investment descriptions in separate lookup lists.
  const lookup = requiredSheet_(
    book,
    workspaceConfig_().lookupSheets[input.type],
  );
  const lookupColumns = workspaceConfig_().layout.lookup;
  const mappings = mappingRows_(lookup, [
    lookupColumns.categoryOptions,
    ...(input.type === "expense" ? [lookupColumns.trips] : []),
  ]);
  const allowed = lookupCategories_(lookup, input.type, mappings);
  // Find an existing description without regard to case or surrounding spaces.
  const match = mappings.find(
    (r) =>
      normalized_(r[lookupColumns.description - 1]) ===
      normalized_(description),
  );
  // Removed master choices may be retained only on the same existing transaction.
  const category = String(input.category ||
    (match && match[lookupColumns.category - 1]) ||
    (input.type === "investment" ? allowed[0] : "") || "").trim();
  if (!allowed.includes(category)) {
    const current = input.row && input.fingerprint && checkedTransaction_(book, input);
    if (!current || current.sheet.getRange(current.row, workspaceConfig_().layout.journal.category)
      .getDisplayValues()[0][0] !== category)
      throw new Error("Choose a valid category.");
  }
  // The legacy trip field stores any expense group, including events and projects.
  let trip = input.type === "expense" ? String(input.trip || "").trim() : "";
  if (trip && !options_(lookup, lookupColumns.trips, mappings).includes(trip))
    throw new Error(
      "Choose an existing expense group, or create one in Dashboards → Expense groups first.",
    );
  const payment = paymentValues_(book, input);
  const aliases =
    input.type === "expense" && !match
      ? book.getSheetByName(workspaceConfig_().legacyItemAliasesSheet)
      : null;
  const legacyDescription =
    !!aliases &&
    options_(aliases, 1).some(
      (name) => normalized_(name) === normalized_(description),
    );
  return {
    ...payment,
    legacyDescription,
    description,
    amount,
    date,
    notes,
    lookup,
    lookupColumns,
    mappings,
    match,
    category,
    trip,
  };
}

// Write only editable cells; leave date-derived and review-check formulas intact.
function writeTransaction_(sheet, row, values, type) {
  const columns = workspaceConfig_().layout.journal;
  literal_(sheet.getRange(row, columns.description), values.description);
  sheet.getRange(row, columns.amount).setValue(values.amount);
  sheet
    .getRange(row, columns.date)
    .setValue(values.date)
    .setNumberFormat(columns.dateFormat);
  literal_(sheet.getRange(row, columns.category), values.category);
  literal_(sheet.getRange(row, columns.notes), values.notes);
  literal_(sheet.getRange(row, columns.paymentMethod), values.paymentMethod);
  literal_(sheet.getRange(row, columns.paymentDetail), values.paymentDetail);
  if (type === "expense")
    literal_(sheet.getRange(row, columns.trip), values.trip);
}

// Create an entry in the selected journal without replacing formula columns.
// The input includes requestId, type, description, amount, date, category, notes, and optional trip.
// Validation and writes run inside withWrite_ so duplicate submissions cannot append twice.
function addTransaction(input) {
  if (!input || typeof input !== "object")
    throw new Error("Missing transaction.");
  return withWorkspaceWrite_(
    input,
    ({ book, sheet, values }) => {
      const columns = workspaceConfig_().layout.journal;
      const { description, category, lookup, lookupColumns, mappings, match } =
        values;
      // Append after the last recorded input, including incomplete native-sheet entries.
      // Formula-only rows and earlier gaps do not determine the append location.
      const inputColumns = [columns.description, columns.amount, columns.date];
      const firstColumn = Math.min(...inputColumns);
      const inputs = sheet
        .getRange(
          columns.firstDataRow,
          firstColumn,
          sheet.getMaxRows() - columns.firstDataRow + 1,
          Math.max(...inputColumns) - firstColumn + 1,
        )
        .getValues();
      let last = columns.firstDataRow - 1;
      for (let i = inputs.length - 1; i >= 0; i--) {
        const values = inputs[i];
        if (
          inputColumns.some((column) =>
            String(values[column - firstColumn] ?? "").trim(),
          )
        ) {
          last = i + columns.firstDataRow;
          break;
        }
      }
      const row = Math.max(last + 1, columns.firstDataRow);
      ensureJournalCapacity_(sheet, row, book);
      writeTransaction_(sheet, row, values, input.type);
      // Remember a genuinely new description once for subsequent automatic categorization.
      // Append a new description/category pair to lookup A:B, extending the lookup sheet if necessary.
      if (!match && !values.legacyDescription) {
        let mappingLast = lookupColumns.firstDataRow - 1;
        mappings.forEach((r, i) => {
          if (r[lookupColumns.description - 1].trim())
            mappingLast = i + lookupColumns.firstDataRow;
        });
        if (mappingLast + 1 > lookup.getMaxRows())
          lookup.insertRowsAfter(lookup.getMaxRows(), 1);
        literal_(
          lookup.getRange(mappingLast + 1, lookupColumns.description),
          description,
        );
        literal_(
          lookup.getRange(mappingLast + 1, lookupColumns.category),
          category,
        );
        // Sort the mapping pair only; adjacent category/group lists keep their positions.
        const firstColumn = Math.min(
          lookupColumns.description,
          lookupColumns.category,
        );
        lookup
          .getRange(
            lookupColumns.firstDataRow,
            firstColumn,
            mappingLast + 2 - lookupColumns.firstDataRow,
            Math.abs(lookupColumns.category - lookupColumns.description) + 1,
          )
          .sort([
            { column: lookupColumns.category, ascending: true },
            { column: lookupColumns.description, ascending: true },
          ]);
      }
      // Return the journal and physical row for a successful submission receipt.
      return { ok: true, type: input.type, row };
    },
    () => {
      const book = book_();
      return {
        book,
        sheet: sheet_(book, input.type),
        values: transactionValues_(book, input),
      };
    },
  );
}

// Save a decision and optional note; Okay accepts the whole matching duplicate group.
// Compare the current source/payment fingerprint with the version the client loaded before writing T:U.
// A Needs correction decision records a flag; the underlying transaction is edited in the sheet.
function setReview(input) {
  if (!input || typeof input !== "object") throw new Error("Missing review.");
  return withWorkspaceWrite_(input, () => {
    const book = book_(),
      sheet = sheet_(book, input.type),
      row = Number(input.row),
      decision = String(input.decision || ""),
      note = String(input.note || ""),
      columns = workspaceConfig_().layout.journal;
    // Reject headers, rows outside the worksheet, unsupported decisions, and oversized notes.
    if (
      !Number.isInteger(row) ||
      row < columns.firstDataRow ||
      row > sheet.getMaxRows()
    )
      throw new Error("Invalid entry.");
    if (!["Pending", "Okay", "Needs correction"].includes(decision))
      throw new Error("Invalid decision.");
    if (note.length > workspaceConfig_().limits.noteLength)
      throw new Error("Review note is too long.");
    // Read the current A:U values immediately before checking for changes to the entry.
    const values = sheet.getRange(row, 1, 1, journalWidth_()).getValues()[0],
      zone = book.getSpreadsheetTimeZone(),
      rowCount = sheet.getMaxRows(),
      dates = new Map();
    if (
      !input.fingerprint ||
      fingerprint_(values, zone, rowCount, dates) !== input.fingerprint
    )
      throw new Error(
        "This entry changed in the sheet. Refresh before reviewing it.",
      );
    const group =
      decision === "Okay"
        ? duplicateGroup_(values, input.type, zone, dates)
        : "";
    let members = [{ row, values }];
    if (group) {
      const candidates = sheet
        .getRange(
          columns.firstDataRow,
          1,
          rowCount - columns.firstDataRow + 1,
          journalWidth_(),
        )
        .getValues();
      members = [];
      candidates.forEach((values, i) => {
        if (duplicateGroup_(values, input.type, zone, dates) === group)
          members.push({ row: i + columns.firstDataRow, values });
      });
      // Check every member before any write. A group that changed since loading must
      // be refreshed, even if the clicked entry itself still has the same fingerprint.
      const expected = members.map((entry) => [
        entry.row,
        fingerprint_(entry.values, zone, rowCount, dates),
      ]);
      const supplied = Array.isArray(input.entries)
        ? input.entries
            .map((entry) => [Number(entry.row), entry.fingerprint])
            .sort((a, b) => a[0] - b[0])
        : [[row, input.fingerprint]];
      if (JSON.stringify(expected) !== JSON.stringify(supplied))
        throw new Error(
          "This duplicate group changed in the sheet. Refresh before accepting it.",
        );
    }
    writeReviewDecisions_(
      sheet,
      members.map((entry) => entry.row),
      decision,
    );
    // Only the clicked entry receives its submitted note.
    writeReviewNotes_(sheet, [{ row, note }]);
    return { ok: true, reviewedRows: members.map((entry) => entry.row) };
  });
}

// Update a manually chosen completeness label on the dashboard.
// The browser sends month 1 through 12; the configured dashboard layout maps each month to its row.
function setMonthStatus(input) {
  if (!input || typeof input !== "object") throw new Error("Missing month.");
  return withWorkspaceWrite_(input, () => {
    const month = Number(input.month),
      status = String(input.status || "");
    // Accept only a valid calendar month and one of the four existing status labels.
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !workspaceConfig_().monthStatuses.includes(status)
    )
      throw new Error("Invalid month status.");
    const sheet = requiredSheet_(book_(), workspaceConfig_().dashboardSheet);
    // Write the status as text in column F of the matching dashboard row.
    literal_(
      sheet.getRange(
        workspaceConfig_().layout.dashboard.firstMonthRow + month - 1,
        workspaceConfig_().layout.dashboard.statusColumn,
      ),
      status,
    );
    return { ok: true };
  });
}

// Check the exact transaction shown by the browser before correcting or removing it.
// Fingerprints include the worksheet row count so shifted duplicate rows require a refresh.
function checkedTransaction_(book, input) {
  const sheet = sheet_(book, input.type),
    columns = workspaceConfig_().layout.journal;
  const row = Number(input.row);
  if (
    !Number.isInteger(row) ||
    row < columns.firstDataRow ||
    row > sheet.getMaxRows()
  )
    throw new Error("Invalid entry.");
  const values = sheet.getRange(row, 1, 1, journalWidth_()).getValues()[0];
  if (
    !input.fingerprint ||
    fingerprint_(values, book.getSpreadsheetTimeZone(), sheet.getMaxRows()) !==
      input.fingerprint
  )
    throw new Error(
      "This entry changed in the sheet. Refresh before changing it.",
    );
  if (
    !values[columns.description - 1] &&
    values[columns.amount - 1] === "" &&
    !dateString_(values[columns.date - 1], book.getSpreadsheetTimeZone())
  )
    throw new Error("This entry has already been removed. Refresh the app.");
  return { sheet, row, values };
}

// Correct the selected entry in place, using add-entry validation and retry protection.
// The journal is fixed by the selected entry; corrections do not move rows between journals.
function updateTransaction(input) {
  if (!input || typeof input !== "object")
    throw new Error("Missing transaction.");
  return withWorkspaceWrite_(
    input,
    ({ current, values }) => {
      writeTransaction_(current.sheet, current.row, values, input.type);
      // Recheck duplicates after correction rather than carrying forward an old Okay decision.
      literal_(
        current.sheet.getRange(
          current.row,
          workspaceConfig_().layout.journal.decision,
        ),
        "Pending",
      );
      return { ok: true, type: input.type, row: current.row };
    },
    () => {
      const book = book_();
      return {
        current: checkedTransaction_(book, input),
        values: transactionValues_(book, input),
      };
    },
  );
}

// Remove the actual sheet row after confirmation so no blank gap remains.
// Sheets adjusts remaining formulas and references; stale snapshots are invalidated
// by the changed row count, and withWrite_ prevents a retry from deleting another row.
function deleteTransaction(input) {
  if (!input || typeof input !== "object" || input.confirmed !== true)
    throw new Error("Confirm the transaction deletion first.");
  return withWorkspaceWrite_(input, () => {
    const current = checkedTransaction_(book_(), input);
    deleteCheckedTransaction_(current);
    return { ok: true, type: input.type, row: current.row };
  });
}

// Compress only adjacent validated rows; gaps always remain untouched.
function consecutiveRows_(rows) {
  const runs = [];
  for (const row of [...new Set(rows)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && last.start + last.count === row) last.count++;
    else runs.push({ start: row, count: 1 });
  }
  return runs;
}
function columnA1_(column) {
  let name = "";
  while (column > 0) {
    column--;
    name = String.fromCharCode(65 + (column % 26)) + name;
    column = Math.floor(column / 26);
  }
  return name;
}
// Decisions are server-controlled labels; RangeList applies the same value to
// disjoint ranges without touching any intervening entries or their notes.
function writeReviewDecisions_(sheet, rows, decision) {
  const column = columnA1_(workspaceConfig_().layout.journal.decision);
  const ranges = consecutiveRows_(rows).map(
    ({ start, count }) => column + start + ":" + column + (start + count - 1),
  );
  // Bound each request even for a large, highly fragmented review queue.
  for (let offset = 0; offset < ranges.length; offset += 250)
    sheet.getRangeList(ranges.slice(offset, offset + 250)).setValue(decision);
}
// Unlike decisions, notes differ per row. Batch adjacent submitted notes only,
// retaining rich-text writes so formula-like user input stays literal text.
function writeReviewNotes_(sheet, entries) {
  const notes = new Map(entries.map((entry) => [entry.row, entry.note]));
  for (const { start, count } of consecutiveRows_([...notes.keys()])) {
    const values = Array.from({ length: count }, (_, index) => [
      SpreadsheetApp.newRichTextValue()
        .setText(String(notes.get(start + index)))
        .build(),
    ]);
    sheet
      .getRange(start, workspaceConfig_().layout.journal.reviewNote, count, 1)
      .setRichTextValues(values);
  }
}

function deleteCheckedTransaction_(current) {
  deleteCheckedRows_(current.sheet, [current.row]);
}
// Callers validate every target before entering this helper. Capture spill anchors
// once, delete bottom-up runs, and repair generated columns once per journal.
function deleteCheckedRows_(sheet, rows) {
  const runs = consecutiveRows_(rows);
  if (!runs.length) return;
  const c = workspaceConfig_().layout.journal;
  const arrayCheck = /LET\(descriptions,/i.test(
    sheet.getRange(c.firstDataRow, c.duplicateIssue).getFormula(),
  );
  const restoreDates =
    runs[0].start === c.firstDataRow
      ? Object.values(c.dateDerived || {}).filter((column) =>
          /ARRAYFORMULA/i.test(
            sheet.getRange(c.firstDataRow, column).getFormula(),
          ),
        )
      : [];
  try {
    runs
      .reverse()
      .forEach(({ start, count }) => sheet.deleteRows(start, count));
  } finally {
    // Also repair after a partially completed deletion; the started request receipt
    // continues to block replay, so retrying cannot delete shifted neighbors.
    const remaining = sheet.getMaxRows();
    if (remaining < c.firstDataRow)
      sheet.insertRowsAfter(remaining, c.firstDataRow - remaining);
    if (arrayCheck) installDuplicateArray_(sheet);
    refreshDateArrays_(sheet, restoreDates);
  }
}

// Validate the complete loaded journal snapshot before any bulk writes. The script lock
// prevents competing app writes; fingerprints also catch edits made directly in Sheets.
function bulkReview(input) {
  if (!input || !["okay", "delete"].includes(input.action))
    throw new Error("Invalid bulk review action.");
  if (input.action === "delete" && input.confirmed !== true)
    throw new Error("Confirm duplicate deletion first.");
  return withWorkspaceWrite_(input, () => {
    const book = book_(),
      c = workspaceConfig_().layout.journal,
      zone = book.getSpreadsheetTimeZone(),
      dates = new Map(),
      entries = [];
    Object.keys(workspaceConfig_().sheets).forEach((type) => {
      const sheet = sheet_(book, type),
        count = sheet.getMaxRows();
      sheet
        .getRange(
          c.firstDataRow,
          1,
          count - c.firstDataRow + 1,
          journalWidth_(),
        )
        .getValues()
        .forEach((values, index) => {
          if (
            !values[c.description - 1] &&
            values[c.amount - 1] === "" &&
            !dateString_(values[c.date - 1], zone, dates)
          )
            return;
          entries.push({
            type,
            sheet,
            row: index + c.firstDataRow,
            values,
            fingerprint: fingerprint_(values, zone, count, dates),
            decision: String(values[c.decision - 1] || "Pending"),
            reviewNote: String(values[c.reviewNote - 1] || ""),
            group: duplicateGroup_(values, type, zone, dates),
            pending:
              !!values[c.duplicateIssue - 1] &&
              values[c.decision - 1] !== "Okay",
            other: c.otherIssues.some((column) => !!values[column - 1]),
          });
        });
    });
    const signature = (items) =>
      JSON.stringify(
        items
          .map((entry) => [
            entry.type,
            Number(entry.row),
            entry.fingerprint,
            entry.decision,
            entry.reviewNote,
            entry.group ?? entry.duplicateGroup,
          ])
          .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]),
      );
    if (
      !Array.isArray(input.entries) ||
      signature(entries) !== signature(input.entries)
    )
      throw new Error(
        "Transactions changed in the sheet. Refresh before reviewing all entries.",
      );
    const groups = new Set(
      entries
        .filter((entry) => entry.pending && entry.group)
        .map((entry) => entry.group),
    );
    let affected;
    if (input.action === "okay") {
      affected = entries.filter(
        (entry) => entry.pending || entry.other || groups.has(entry.group),
      );
      const notes = new Map(
        input.entries.map((entry) => [
          entry.type + ":" + entry.row,
          entry.note,
        ]),
      );
      // Validate every note before the first write; preserve notes not submitted by the UI.
      affected.forEach((entry) => {
        const note = notes.get(entry.type + ":" + entry.row);
        if (
          note !== undefined &&
          (typeof note !== "string" ||
            note.length > workspaceConfig_().limits.noteLength)
        )
          throw new Error("Review note is too long.");
      });
      const journals = new Map();
      affected.forEach((entry) => {
        if (!journals.has(entry.sheet)) journals.set(entry.sheet, []);
        journals.get(entry.sheet).push(entry);
      });
      journals.forEach((members, sheet) => {
        writeReviewDecisions_(
          sheet,
          members.map((entry) => entry.row),
          "Okay",
        );
        writeReviewNotes_(
          sheet,
          members
            .filter(
              (entry) => notes.get(entry.type + ":" + entry.row) !== undefined,
            )
            .map((entry) => ({
              row: entry.row,
              note: notes.get(entry.type + ":" + entry.row),
            })),
        );
      });
    } else {
      const kept = new Set();
      affected = entries.filter((entry) => {
        if (!groups.has(entry.group)) return false;
        if (kept.has(entry.group)) return true;
        kept.add(entry.group); // Keep the earliest sheet row in each exact duplicate group.
        return false;
      });
      const journals = new Map();
      affected.forEach((entry) => {
        if (!journals.has(entry.sheet)) journals.set(entry.sheet, []);
        journals.get(entry.sheet).push(entry.row);
      });
      journals.forEach((rows, sheet) => deleteCheckedRows_(sheet, rows));
    }
    return { ok: true, count: affected.length };
  });
}

// Create a reusable expense group in lookup column H. Keep existing names and tags
// intact, and return a canonical existing name for case-insensitive duplicates.
function createExpenseGroup(input) {
  if (!input || typeof input !== "object")
    throw new Error("Missing expense group.");
  return withWorkspaceWrite_(input, () => {
    const name = String(input.name || "").trim();
    if (!name || name.length > workspaceConfig_().limits.groupNameLength)
      throw new Error(
        "Enter a group name, up to " +
          workspaceConfig_().limits.groupNameLength +
          " characters.",
      );
    const book = book_(),
      lookup = requiredSheet_(book, workspaceConfig_().lookupSheets.expense);
    const column = workspaceConfig_().layout.lookup.trips,
      first = workspaceConfig_().layout.lookup.firstDataRow;
    const existing = options_(lookup, column);
    const match = existing.find(
      (value) => normalized_(value) === normalized_(name),
    );
    if (match)
      return { ok: true, created: false, name: match, groups: existing };
    const groups = [...existing, name];
    // Native pivots expand as groups/categories grow. Give the optional summary tab
    // enough room so creating more groups cannot cause a pivot spill error.
    const summary = book.getSheetByName(
      sheetName_(workspaceConfig_().groupSummarySheet),
    );
    if (summary) {
      const columns = Math.max(10, groups.length + 5);
      const rows = Math.max(
        50,
        groups.length + 6,
        options_(lookup, workspaceConfig_().layout.lookup.categoryOptions)
          .length + 10,
      );
      if (summary.getMaxColumns() < columns)
        summary.insertColumnsAfter(
          summary.getMaxColumns(),
          columns - summary.getMaxColumns(),
        );
      if (summary.getMaxRows() < rows)
        summary.insertRowsAfter(
          summary.getMaxRows(),
          rows - summary.getMaxRows(),
        );
    }
    const values = lookup
      .getRange(first, column, lookup.getMaxRows() - first + 1, 1)
      .getDisplayValues()
      .flat();
    let last = first - 1;
    values.forEach((value, i) => {
      if (value.trim()) last = first + i;
    });
    const row = last + 1;
    if (row > lookup.getMaxRows())
      lookup.insertRowsAfter(lookup.getMaxRows(), 1);
    // Rich text keeps a name beginning with = as literal text rather than a formula.
    const cell = lookup.getRange(row, column);
    literal_(cell, name);
    cell.setWrap(true);
    lookup.autoResizeRows(row, 1);
    return { ok: true, created: true, name, groups };
  });
}

// Payment metadata lives beyond the existing formula/review columns; old entries remain blank.
function ensurePaymentStorage_(book) {
  const columns = workspaceConfig_().layout.journal;
  Object.keys(workspaceConfig_().sheets).forEach((type) => {
    const sheet = sheet_(book, type);
    const width = Math.max(columns.paymentMethod, columns.paymentDetail);
    if (sheet.getMaxColumns() < width)
      sheet.insertColumnsAfter(
        sheet.getMaxColumns(),
        width - sheet.getMaxColumns(),
      );
    const firstColumn = Math.min(columns.paymentMethod, columns.paymentDetail);
    const headers = sheet
      .getRange(1, firstColumn, 1, width - firstColumn + 1)
      .getDisplayValues()[0];
    [
      [columns.paymentMethod, "Payment method"],
      [columns.paymentDetail, "Bank / card / UPI app"],
    ].forEach(([column, title]) => {
      const cell = sheet.getRange(1, column);
      if (!headers[column - firstColumn]) {
        cell
          .setValue(title)
          .setBackground("#23614a")
          .setFontColor("#ffffff")
          .setFontWeight("bold")
          .setWrap(true);
        sheet.setColumnWidth(column, 190);
      }
    });
  });
  let sheet = book.getSheetByName(workspaceConfig_().paymentMethodsSheet);
  if (!sheet) {
    sheet = book.insertSheet(workspaceConfig_().paymentMethodsSheet);
    ["Payment method", "Name", "Available for new entries"].forEach(
      (title, i) => {
        sheet
          .getRange(1, i + 1)
          .setValue(title)
          .setBackground("#23614a")
          .setFontColor("#ffffff")
          .setFontWeight("bold")
          .setWrap(true);
        sheet.setColumnWidth(i + 1, i === 1 ? 260 : 200);
      },
    );
    sheet.setFrozenRows(1);
  }
  // Keep custom types separate from named bank/card/app choices, including types with no names.
  if (!book.getSheetByName(workspaceConfig_().paymentTypesSheet)) {
    const types = book.insertSheet(workspaceConfig_().paymentTypesSheet);
    types
      .getRange(1, 1)
      .setValue("Custom payment type")
      .setBackground("#23614a")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setWrap(true);
    types.setFrozenRows(1);
    types.setColumnWidth(1, 240);
  }
  // Once initialized, column A is authoritative, even when every type is removed.
  // Older workbooks stored only custom types; migrate defaults once, then allow removal.
  const types = book.getSheetByName(workspaceConfig_().paymentTypesSheet);
  if (types.getRange(1, 1).getDisplayValues()[0][0] !== "Payment type") {
    replaceChoiceColumn_(types, 1, paymentMethods_(book), 2);
    literal_(types.getRange(1, 1), "Payment type");
  }
  // Migrate previously removed choices without touching journal history.
  // Delete bottom-up so one deletion cannot change another row's position.
  const records = paymentRecords_(book);
  const removed = records
    .filter((record) => record.removed)
    .sort((a, b) => b.row - a.row);
  removed.forEach((record) => sheet.deleteRow(record.row));
  // A deletion shifts physical row numbers; reread only when migration changed the sheet.
  return removed.length ? paymentRecords_(book) : records;
}
function paymentRecords_(book) {
  const sheet = book.getSheetByName(workspaceConfig_().paymentMethodsSheet);
  if (!sheet || sheet.getMaxRows() < 2) return [];
  return sheet
    .getRange(2, 1, sheet.getMaxRows() - 1, 3)
    .getDisplayValues()
    .map((r, i) => ({
      method: r[0],
      name: r[1],
      active: r[2] === "Yes",
      removed: normalized_(r[2]) === "no",
      row: i + 2,
    }))
    .filter((r) => r.name);
}
// Legacy custom-only lists include defaults until their one-time migration.
function paymentMethods_(book) {
  const sheet = book.getSheetByName(workspaceConfig_().paymentTypesSheet);
  const values = sheet ? sheet.getRange(1, 1, sheet.getMaxRows(), 1)
    .getDisplayValues().flat() : [];
  const custom = values.slice(1);
  const seen = new Set();
  return [...(values[0] === "Payment type" ? [] : workspaceConfig_().paymentMethods), ...custom]
    .map((value) => String(value).trim())
    .filter((value) => {
      const key = normalized_(value);
      if (
        !key ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    });
}
function paymentOptions_(
  book,
  methods = paymentMethods_(book),
  records = paymentRecords_(book),
) {
  const options = Object.fromEntries(
    methods.filter((method) => method !== "Cash").map((method) => [method, []]),
  );
  records.forEach((r) => {
    if (r.active && Object.prototype.hasOwnProperty.call(options, r.method))
      options[r.method].push(r.name);
  });
  return options;
}
function addPaymentType(input) {
  const name = String(input?.name || "").trim();
  if (
    !name ||
    name.length > 60 ||
    ["__proto__", "constructor", "prototype"].includes(normalized_(name))
  )
    throw new Error("Enter a payment method name up to 60 characters.");
  return withWorkspaceWrite_(input, () => {
    const book = book_();
    const records = ensurePaymentStorage_(book);
    const existing = paymentMethods_(book).find(
      (method) => normalized_(method) === normalized_(name),
    );
    if (!existing) {
      const sheet = book.getSheetByName(workspaceConfig_().paymentTypesSheet);
      if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
      const values = sheet
        .getRange(2, 1, sheet.getMaxRows() - 1, 1)
        .getDisplayValues();
      let row = 2;
      values.forEach((r, i) => {
        if (r[0].trim()) row = i + 3;
      });
      if (row > sheet.getMaxRows())
        sheet.insertRowsAfter(sheet.getMaxRows(), 1);
      literal_(sheet.getRange(row, 1), name);
      sheet.getRange(row, 1).setWrap(true);
      sheet.autoResizeRows(row, 1);
    }
    const methods = paymentMethods_(book);
    return {
      ok: true,
      name: existing || name,
      created: !existing,
      paymentMethods: methods,
      paymentOptions: paymentOptions_(book, methods, records),
    };
  });
}
function paymentValues_(book, input) {
  if (input.type === "income") return { paymentMethod: "", paymentDetail: "" };
  const paymentMethod = String(input.paymentMethod || ""),
    paymentDetail = String(input.paymentDetail || "").trim();
  // Blank metadata is supported for legacy entries and older deployed clients.
  if (input.paymentMethod === undefined && input.paymentDetail === undefined) {
    if (input.row && input.fingerprint) {
      const current = checkedTransaction_(book, input),
        c = workspaceConfig_().layout.journal;
      const r = current.sheet
        .getRange(current.row, 1, 1, journalWidth_())
        .getDisplayValues()[0];
      return {
        paymentMethod: r[c.paymentMethod - 1],
        paymentDetail: r[c.paymentDetail - 1],
      };
    }
    return { paymentMethod: "", paymentDetail: "" };
  }
  // Explicitly clearing the optional method also clears any stale detail on edits.
  if (!paymentMethod) return { paymentMethod: "", paymentDetail: "" };
  const methods = paymentMethods_(book);
  if (!methods.includes(paymentMethod))
    throw new Error("Choose a valid payment method.");
  if (paymentMethod === "Cash") return { paymentMethod, paymentDetail: "" };
  // Custom types may stand alone (for example Cheque); built-in account methods still require a name.
  if (
    !paymentDetail &&
    !["Bank transfer", "Card", "UPI"].includes(paymentMethod)
  )
    return { paymentMethod, paymentDetail: "" };
  const active = (paymentOptions_(book, methods)[paymentMethod] || []).includes(
    paymentDetail,
  );
  // A removed name may be retained only on the same existing transaction.
  let retained = false;
  if (!active && input.row && input.fingerprint) {
    const current = checkedTransaction_(book, input);
    const c = workspaceConfig_().layout.journal;
    const r = current.sheet
      .getRange(current.row, 1, 1, journalWidth_())
      .getDisplayValues()[0];
    retained =
      r[c.paymentMethod - 1] === paymentMethod &&
      r[c.paymentDetail - 1] === paymentDetail;
  }
  if (!active && !retained)
    throw new Error("Choose an available payment account / app.");
  return { paymentMethod, paymentDetail };
}
// Delete reusable payment choices from the master sheet; journal history stays intact.
function managePaymentOption(input) {
  if (!input || !["add", "remove"].includes(input.action))
    throw new Error("Choose add or remove.");
  const method = String(input.method || ""),
    name = String(input.name || "").trim();
  if (!method || !name || name.length > 100)
    throw new Error(
      "Choose a payment method and enter an account / app name up to 100 characters.",
    );
  return withWorkspaceWrite_(input, () => {
    const book = book_();
    const records = ensurePaymentStorage_(book);
    if (method === "Cash" || !paymentMethods_(book).includes(method))
      throw new Error("Choose an available payment method.");
    const existing = records.find(
      (r) => r.method === method && normalized_(r.name) === normalized_(name),
    );
    if (input.action === "remove" && !existing)
      throw new Error(
        "This payment account / app is no longer available. Refresh the app.",
      );
    const sheet = book.getSheetByName(workspaceConfig_().paymentMethodsSheet);
    if (input.action === "remove") {
      records
        .filter(
          (record) =>
            record.method === method &&
            normalized_(record.name) === normalized_(name),
        )
        .sort((a, b) => b.row - a.row)
        .forEach((record) => sheet.deleteRow(record.row));
    } else {
      const row = existing
        ? existing.row
        : Math.max(1, ...records.map((r) => r.row)) + 1;
      if (row > sheet.getMaxRows())
        sheet.insertRowsAfter(sheet.getMaxRows(), 1);
      literal_(sheet.getRange(row, 1), method);
      literal_(sheet.getRange(row, 2), existing ? existing.name : name);
      literal_(sheet.getRange(row, 3), "Yes");
    }
    return {
      ok: true,
      name: existing ? existing.name : name,
      paymentOptions: paymentOptions_(book),
    };
  });
}

// Add reusable lookup choices under the same owner authorization and write lock as journals.
// Existing names are reused, never remapped: changing a master category could alter history.
function addLookupOption(input) {
  if (!input || !["description", "category"].includes(input.kind))
    throw new Error("Choose a description or category.");
  if (
    !Object.prototype.hasOwnProperty.call(
      workspaceConfig_().lookupSheets,
      input.type,
    )
  )
    throw new Error("Choose a valid journal.");
  const name = String(input.name || "").trim();
  if (!name || name.length > workspaceConfig_().limits.descriptionLength)
    throw new Error(
      "Enter a name up to " +
        workspaceConfig_().limits.descriptionLength +
        " characters.",
    );
  return withWorkspaceWrite_(input, () => {
    const book = book_(),
      sheet = requiredSheet_(book, workspaceConfig_().lookupSheets[input.type]),
      c = workspaceConfig_().layout.lookup;
    const categories = lookupCategories_(sheet, input.type);
    const categoryName = String(input.newCategory || "").trim();
    if (categoryName.length > workspaceConfig_().limits.descriptionLength)
      throw new Error("The category name is too long.");
    const requestedCategory = categoryName || String(input.category || "").trim() ||
      (input.type === "investment" ? categories[0] : "");
    const category =
      categories.find(
        (value) => normalized_(value) === normalized_(requestedCategory),
      ) || requestedCategory;
    const mappings = mappingRows_(sheet);
    const existing =
      input.kind === "description" &&
      mappings.find(
        (r) => normalized_(r[c.description - 1]) === normalized_(name),
      );
    if (existing) {
      if (existing[c.category - 1].trim() !== category)
        throw new Error(
          "This description already exists with a different category. Its mapping has been kept.",
        );
      return {
        ok: true,
        created: false,
        name: existing[c.description - 1].trim(),
      };
    }
    if (input.kind === "description") {
      if (!category || (!categories.includes(category) && !categoryName))
        throw new Error("Choose a valid category or enter a new category.");
      const aliases =
        input.type === "expense" &&
        book.getSheetByName(workspaceConfig_().legacyItemAliasesSheet);
      if (
        aliases &&
        options_(aliases, 1).some(
          (value) => normalized_(value) === normalized_(name),
        )
      )
        throw new Error(
          "This is a historical description. Use its current name from the description list.",
        );
    }
    // Append only within the target columns; adjacent group lists and formulas stay in place.
    const appendText = (column, value) => {
      const values = sheet
        .getRange(
          c.firstDataRow,
          column,
          sheet.getMaxRows() - c.firstDataRow + 1,
          1,
        )
        .getDisplayValues();
      let row = c.firstDataRow;
      values.forEach((r, i) => {
        if (r[0].trim()) row = c.firstDataRow + i + 1;
      });
      if (row > sheet.getMaxRows())
        sheet.insertRowsAfter(sheet.getMaxRows(), 1);
      literal_(sheet.getRange(row, column), value);
      return row;
    };
    if (input.type === "investment") initializeInvestmentCategories_(sheet, book);
    if (input.kind === "category") {
      const existingCategory = categories.find(
        (value) => normalized_(value) === normalized_(name),
      );
      if (existingCategory)
        return { ok: true, created: false, name: existingCategory };
      const row = appendText(c.categoryOptions, name);
      sheet
        .getRange(
          c.firstDataRow,
          c.categoryOptions,
          row - c.firstDataRow + 1,
          1,
        )
        .sort([{ column: c.categoryOptions, ascending: true }]);
    } else {
      if (!categories.includes(category))
        appendText(c.categoryOptions, category);
      const row = appendText(c.description, name);
      literal_(sheet.getRange(row, c.category), category);
      const firstColumn = Math.min(c.description, c.category);
      sheet
        .getRange(
          c.firstDataRow,
          firstColumn,
          row - c.firstDataRow + 1,
          Math.abs(c.category - c.description) + 1,
        )
        .sort([
          { column: c.category, ascending: true },
          { column: c.description, ascending: true },
        ]);
    }
    return { ok: true, created: true, name };
  });
}

// Replace only one independent master column. Literal writes prevent formula injection;
// neighboring descriptions, categories, groups, formatting, and validation stay in place.
function replaceChoiceColumn_(sheet, column, values, first = workspaceConfig_().layout.lookup.firstDataRow) {
  const current = sheet.getMaxRows() >= first
    ? sheet.getRange(first, column, sheet.getMaxRows() - first + 1, 1).getDisplayValues() : [];
  let used = 0;
  current.forEach((row, i) => { if (row[0]) used = i + 1; });
  const height = Math.max(used, values.length);
  if (!height) return;
  if (first + height - 1 > sheet.getMaxRows())
    sheet.insertRowsAfter(sheet.getMaxRows(), first + height - 1 - sheet.getMaxRows());
  sheet.getRange(first, column, height, 1).setRichTextValues(
    Array.from({ length: height }, (_, i) => [SpreadsheetApp.newRichTextValue()
      .setText(String(values[i] || "")).build()]),
  );
}
function lookupCategories_(sheet, type, rows) {
  const c = workspaceConfig_().layout.lookup;
  const categories = options_(sheet, c.categoryOptions, rows);
  // Older copies treated investments as fixed. The header marks an editable master,
  // so an intentionally empty list cannot silently resurrect the original default.
  if (type !== "investment" || categories.length ||
      sheet.getRange(1, c.categoryOptions).getDisplayValues()[0][0] === "Categories")
    return categories;
  const mapped = options_(sheet, c.category, rows);
  return mapped.length ? mapped : [workspaceConfig_().categories.investment];
}
function initializeInvestmentCategories_(sheet, book) {
  const c = workspaceConfig_().layout.lookup;
  if (sheet.getRange(1, c.categoryOptions).getDisplayValues()[0][0] === "Categories") return;
  replaceChoiceColumn_(sheet, c.categoryOptions, lookupCategories_(sheet, "investment"));
  // Older investment journals returned the fixed default category. Future native
  // entries now look up the chosen description; recorded results stay unchanged.
  const journal = sheet_(book, "investment"), j = workspaceConfig_().layout.journal;
  const height = journal.getMaxRows() - j.firstDataRow + 1;
  const inputs = journal.getRange(j.firstDataRow, 1, height, journalWidth_()).getValues();
  const formulas = journal.getRange(j.firstDataRow, j.category, height, 1).getFormulas();
  const lookupName = sheetName_(workspaceConfig_().lookupSheets.investment).replace(/'/g, "''");
  const descriptions = "'" + lookupName + "'!$" + columnA1_(c.description) + "$" + c.firstDataRow + ":$" + columnA1_(c.description);
  const categories = "'" + lookupName + "'!$" + columnA1_(c.category) + "$" + c.firstDataRow + ":$" + columnA1_(c.category);
  const updates = new Map();
  inputs.forEach((row, i) => {
    if (!formulas[i][0]) return;
    const index = j.firstDataRow + i;
    if (row[j.description - 1] || row[j.amount - 1] !== "" || row[j.date - 1]) {
      literal_(journal.getRange(index, j.category), row[j.category - 1]);
    } else {
      const description = columnA1_(j.description) + index;
      updates.set(index, '=IF(' + description + '="","",XLOOKUP(TRIM(' + description +
        '),ARRAYFORMULA(TRIM(' + descriptions + ')),' + categories + ',"",0))');
    }
  });
  for (const { start, count } of consecutiveRows_([...updates.keys()]))
    journal.getRange(start, j.category, count, 1).setFormulas(
      Array.from({ length: count }, (_, i) => [updates.get(start + i)]));
  literal_(sheet.getRange(1, c.categoryOptions), "Categories");
}
// Native-sheet entries may derive G from the reusable description mapping. Freeze
// those recorded results before changing that mapping; future rows keep their formulas.
function preserveRecordedCategories_(book, type, descriptions) {
  const sheet = sheet_(book, type), c = workspaceConfig_().layout.journal;
  const height = sheet.getMaxRows() - c.firstDataRow + 1;
  const inputs = sheet.getRange(c.firstDataRow, 1, height, journalWidth_()).getValues();
  const formulas = sheet.getRange(c.firstDataRow, c.category, height, 1).getFormulas();
  inputs.forEach((row, i) => {
    if (formulas[i][0] && descriptions.has(normalized_(row[c.description - 1])))
      literal_(sheet.getRange(c.firstDataRow + i, c.category), row[c.category - 1]);
  });
}
function managedChoicePlan_(input) {
  if (!input || !["edit", "remove"].includes(input.action) ||
      !["paymentType", "paymentName", "description", "category"].includes(input.kind))
    throw new Error("Choose a valid Manage action.");
  if (input.action === "remove" && input.confirmed !== true)
    throw new Error("Confirm removal first.");
  const book = book_(), name = String(input.name || "").trim();
  const newName = input.action === "edit" ? String(input.newName || "").trim() : "";
  const limit = input.kind === "paymentType" ? 60 : input.kind === "paymentName" ? 100 :
    workspaceConfig_().limits.descriptionLength;
  if (!name || (input.action === "edit" && (!newName || newName.length > limit)))
    throw new Error("Enter a name up to " + limit + " characters.");
  if (input.kind === "paymentType" &&
      ["__proto__", "constructor", "prototype"].includes(normalized_(newName)))
    throw new Error("Choose another payment method name.");
  const same = (a, b) => normalized_(a) === normalized_(b);
  const plan = { book, name, newName };
  if (input.kind === "paymentType" || input.kind === "paymentName") {
    const methods = paymentMethods_(book), records = paymentRecords_(book);
    const method = input.kind === "paymentType" ? name : String(input.method || "");
    if (!methods.includes(method)) throw new Error("This payment method changed. Refresh the app.");
    const existing = input.kind === "paymentType" ? methods : records
      .filter(r => r.method === method && r.active).map(r => r.name);
    if (!existing.includes(name)) throw new Error("This choice changed. Refresh the app.");
    if (input.action === "edit" && existing.some(value => value !== name && same(value, newName)))
      throw new Error("That name already exists.");
    if (input.kind === "paymentType" && input.action === "edit" && newName === "Cash" &&
        records.some(record => record.method === method && !record.removed))
      throw new Error("Remove this method's saved accounts/apps before renaming it to Cash.");
    return { ...plan, methods, records, method };
  }
  if (!Object.prototype.hasOwnProperty.call(workspaceConfig_().lookupSheets, input.type))
    throw new Error("Choose a valid journal.");
  const sheet = requiredSheet_(book, workspaceConfig_().lookupSheets[input.type]);
  const c = workspaceConfig_().layout.lookup;
  const categories = lookupCategories_(sheet, input.type);
  const mappings = mappingRows_(sheet).filter(row => row[c.description - 1].trim());
  const existing = input.kind === "category" ? categories : mappings.map(r => r[c.description - 1].trim());
  if (!existing.includes(name)) throw new Error("This choice changed. Refresh the app.");
  if (input.action === "edit" && existing.some(value => value !== name && same(value, newName)))
    throw new Error("That name already exists.");
  let category = "";
  if (input.kind === "description") {
    const matches = mappings.filter(r => same(r[c.description - 1], name));
    if (matches.some(r => r[c.category - 1].trim() !== input.previousCategory))
      throw new Error("This description changed. Refresh the app.");
    if (input.action === "edit") {
      category = String(input.category || "").trim();
      if (!categories.includes(category)) throw new Error("Choose a valid category.");
      const aliases = input.type === "expense" && book.getSheetByName(workspaceConfig_().legacyItemAliasesSheet);
      if (newName !== name && aliases && options_(aliases, 1).some(value => same(value, newName)))
        throw new Error("This is a historical description. Choose another name.");
    }
  } else if (input.action === "remove" && mappings.some(r => same(r[c.category - 1], name))) {
    category = String(input.replacement || "").trim();
    if (category === name || !categories.includes(category))
      throw new Error("Choose a replacement category for descriptions using this category. Add another category first if needed.");
  }
  return { ...plan, sheet, c, categories, mappings, category };
}
// Master choices affect future entries. Financial records are never renamed or deleted.
// Read-only validation runs before the retry marker; partial writes remain protected.
function manageChoice(input) {
  if (!input || typeof input !== "object") throw new Error("Choose a valid Manage action.");
  return withWorkspaceWrite_(input, plan => {
    const { book, name, newName } = plan;
    if (input.kind === "paymentType" || input.kind === "paymentName") {
      ensurePaymentStorage_(book);
      const records = paymentRecords_(book);
      const sheet = book.getSheetByName(workspaceConfig_().paymentMethodsSheet);
      const affected = records.filter(r => r.method === plan.method &&
        (input.kind === "paymentType" || normalized_(r.name) === normalized_(name)));
      if (input.action === "remove") {
        affected.sort((a, b) => b.row - a.row).forEach(r => sheet.deleteRow(r.row));
      } else {
        affected.forEach(r => literal_(sheet.getRange(r.row, input.kind === "paymentType" ? 1 : 2), newName));
      }
      if (input.kind === "paymentType") {
        replaceChoiceColumn_(book.getSheetByName(workspaceConfig_().paymentTypesSheet), 1,
          plan.methods.flatMap(value => value === name ? (input.action === "remove" ? [] : [newName]) : [value]), 2);
      }
    } else {
      const { sheet, c, mappings, categories, category } = plan;
      const affectedDescriptions = new Set(mappings.filter(row => input.kind === "description"
        ? normalized_(row[c.description - 1]) === normalized_(name)
        : normalized_(row[c.category - 1]) === normalized_(name))
        .map(row => normalized_(row[c.description - 1])));
      preserveRecordedCategories_(book, input.type, affectedDescriptions);
      if (input.type === "investment") initializeInvestmentCategories_(sheet, book);
      if (input.kind === "category") {
        replaceChoiceColumn_(sheet, c.categoryOptions, categories.flatMap(value => value === name
          ? (input.action === "remove" ? [] : [newName]) : [value]).sort());
      }
      const next = mappings.flatMap(row => {
        const description = row[c.description - 1].trim(), oldCategory = row[c.category - 1].trim();
        if (input.kind === "description" && normalized_(description) === normalized_(name))
          return input.action === "remove" ? [] : [{ description: newName, category }];
        return [{ description, category: input.kind === "category" && normalized_(oldCategory) === normalized_(name)
          ? (input.action === "edit" ? newName : category) : oldCategory }];
      }).sort((a, b) => a.category.localeCompare(b.category) || a.description.localeCompare(b.description));
      replaceChoiceColumn_(sheet, c.description, next.map(row => row.description));
      replaceChoiceColumn_(sheet, c.category, next.map(row => row.category));
    }
    return { ok: true };
  }, () => managedChoicePlan_(input));
}
