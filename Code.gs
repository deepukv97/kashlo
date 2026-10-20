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
function withWorkspaceWrite_(input, action) {
  return withWrite_(input.requestId, () => {
    const record = workspaceRecord_();
    if (!record) throw new Error("Complete Profile & settings before saving.");
    if (input.workspaceRevision !== record.revision)
      throw new Error(
        "Workspace settings changed. Refresh the app before saving.",
      );
    workspaceConfigCache_ = null;
    return action();
  });
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

function mappingRows_(sheet) {
  const columns = workspaceConfig_().layout.lookup;
  return sheet
    .getRange(
      columns.firstDataRow,
      1,
      sheet.getMaxRows() - columns.firstDataRow + 1,
      Math.max(columns.description, columns.category),
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
function options_(sheet, column) {
  return [
    ...new Set(
      sheet
        .getRange(
          workspaceConfig_().layout.lookup.firstDataRow,
          column,
          sheet.getMaxRows() -
            workspaceConfig_().layout.lookup.firstDataRow +
            1,
          1,
        )
        .getDisplayValues()
        .flat()
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
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
function dateString_(date, zone) {
  if (date instanceof Date && !isNaN(date.getTime()))
    return Utilities.formatDate(date, zone, "yyyy-MM-dd");
  if (typeof date === "number" && isFinite(date) && date > 0)
    return new Date(Date.UTC(1899, 11, 30) + date * 86400000)
      .toISOString()
      .slice(0, 10);
  return "";
}
// Hash the configured source columns to detect changes before a review write.
// Normalize date values before JSON serialization. Fingerprints cover source and payment fields
// and excludes review fields T:U; the SHA-256 digest uses web-safe Base64.
// Include the worksheet row count so deletion invalidates stale row references,
// even when the next row contains an identical duplicate.
function fingerprint_(row, zone, rowCount) {
  const payload = workspaceConfig_().layout.journal.fingerprintColumns.map(
    (column) => {
      const value = row[column - 1];
      return column === workspaceConfig_().layout.journal.date ||
        value instanceof Date
        ? dateString_(value, zone)
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
function duplicateGroup_(values, type, zone) {
  const c = workspaceConfig_().layout.journal;
  if (!values[c.duplicateIssue - 1]) return "";
  const description = duplicateText_(values[c.description - 1]),
    date = dateString_(values[c.date - 1], zone),
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
    ",amounts,ARRAYFORMULA(IF(ISNUMBER(" +
    amount +
    ")," +
    amount +
    ",0))," +
    "days,ARRAYFORMULA(IFERROR(INT(" +
    date +
    "),0)),methods," +
    text(range(c.paymentMethod)) +
    ",details," +
    text(range(c.paymentDetail)) +
    ',valid,ARRAYFORMULA((descriptions<>"")*ISNUMBER(' +
    amount +
    ")*ISNUMBER(" +
    date +
    "))," +
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
  const range = sheet.getRange(
    c.firstDataRow,
    c.duplicateIssue,
    sheet.getMaxRows() - c.firstDataRow + 1,
    1,
  );
  // Q is a generated check column; decisions and notes in T:U are never cleared.
  range.clearContent();
  sheet
    .getRange(c.firstDataRow, c.duplicateIssue)
    .setFormula(duplicateArrayFormula_(sheet.getMaxRows()));
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
    const anchor = sheet.getRange(c.firstDataRow, column);
    if (restore.includes(column) || /ARRAYFORMULA/i.test(anchor.getFormula()))
      anchor.setFormula(
        "=ARRAYFORMULA(IF(" +
          dates +
          '="","",' +
          part.toUpperCase() +
          "(" +
          dates +
          ")))",
      );
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
  if (book) ensureReviewCapacity_(book);
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
    columns = workspaceConfig_().layout.journal;
  ensurePaymentStorage_(book);
  ensureReviewCapacity_(book);
  // Read through payment details below the header of each journal, including formula-prepared rows.
  Object.keys(workspaceConfig_().sheets).forEach((type) => {
    const sheet = sheet_(book, type),
      rows = sheet
        .getRange(
          columns.firstDataRow,
          1,
          sheet.getMaxRows() - columns.firstDataRow + 1,
          journalWidth_(),
        )
        .getValues();
    rows.forEach((r, index) => {
      // Ignore rows with no description in B, no amount in C, and no usable date in F.
      if (
        !r[columns.description - 1] &&
        r[columns.amount - 1] === "" &&
        !dateString_(r[columns.date - 1], zone)
      )
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
        date: dateString_(r[columns.date - 1], zone),
        category: String(r[columns.category - 1] || ""),
        notes: String(r[columns.notes - 1] || ""),
        trip: type === "expense" ? String(r[columns.trip - 1] || "") : "",
        paymentMethod: String(r[columns.paymentMethod - 1] || ""),
        paymentDetail: String(r[columns.paymentDetail - 1] || ""),
        issues,
        decision: decision || "Pending",
        reviewNote: String(r[columns.reviewNote - 1] || ""),
        fingerprint: fingerprint_(r, zone, sheet.getMaxRows()),
        duplicateGroup: duplicateGroup_(r, type, zone),
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
  const mappings = {};
  // Each journal has its own descriptions; investments retain their fixed category.
  [
    ["expense", mapping],
    ["income", incomeMapping],
    ["investment", investmentMapping],
  ].forEach(([type, sheet]) => {
    mappings[type] = mappingRows_(sheet)
      .filter(
        (r) =>
          r[workspaceConfig_().layout.lookup.description - 1].trim() &&
          r[workspaceConfig_().layout.lookup.category - 1].trim(),
      )
      .map((r) => ({
        description: r[workspaceConfig_().layout.lookup.description - 1].trim(),
        category: r[workspaceConfig_().layout.lookup.category - 1].trim(),
      }));
  });
  // Monthly completeness is stored in the existing dashboard rather than inferred from totals.
  const dashboard = requiredSheet_(book, workspaceConfig_().dashboardSheet);
  // Expense groups come from Item & Category column H; dashboard F12:F23 holds January through December.
  return {
    workspaceRevision: workspaceRecord_()?.revision || 0,
    year: workspaceConfig_().year,
    config: { ...clientConfig_(zone), paymentMethods: paymentMethods_(book) },
    updatedAt: new Date().toISOString(),
    transactions,
    categories: {
      expense: options_(
        mapping,
        workspaceConfig_().layout.lookup.categoryOptions,
      ),
      income: options_(
        incomeMapping,
        workspaceConfig_().layout.lookup.categoryOptions,
      ),
      investment: [workspaceConfig_().categories.investment],
    },
    mappings,
    paymentOptions: paymentOptions_(book),
    trips: options_(mapping, workspaceConfig_().layout.lookup.trips),
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
function withWrite_(requestId, action) {
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
    // Persist the started marker before calling action; failures leave it in place for inspection on retry.
    properties.setProperty(
      key,
      JSON.stringify({ at: Date.now(), status: "started" }),
    );
    const result = action();
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
    amount === 0 ||
    Math.abs(amount) > workspaceConfig_().limits.maximumAmount
  )
    throw new Error("Enter a valid non-zero amount.");
  // Income may be negative; expense and investment entries must be positive.
  if (input.type !== "income" && amount < 0)
    throw new Error("Use a positive expense or investment amount.");
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
  const allowed =
    input.type === "investment"
      ? [workspaceConfig_().categories.investment]
      : options_(lookup, lookupColumns.categoryOptions);
  const mappings = mappingRows_(lookup);
  // Find an existing description without regard to case or surrounding spaces.
  const match = mappings.find(
    (r) =>
      normalized_(r[lookupColumns.description - 1]) ===
      normalized_(description),
  );
  // Use the supplied category, otherwise the known mapping; investments use the configured fixed category.
  const category =
    input.type === "investment"
      ? workspaceConfig_().categories.investment
      : String(
          input.category || (match && match[lookupColumns.category - 1]) || "",
        ).trim();
  if (!allowed.includes(category)) throw new Error("Choose a valid category.");
  // The legacy trip field stores any expense group, including events and projects.
  let trip = input.type === "expense" ? String(input.trip || "").trim() : "";
  if (trip && !options_(lookup, lookupColumns.trips).includes(trip))
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
  return withWorkspaceWrite_(input, () => {
    const book = book_(),
      sheet = sheet_(book, input.type),
      columns = workspaceConfig_().layout.journal;
    const values = transactionValues_(book, input);
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
    inputs.forEach((values, i) => {
      if (
        inputColumns.some((column) =>
          String(values[column - firstColumn] ?? "").trim(),
        )
      )
        last = i + columns.firstDataRow;
    });
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
  });
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
    const values = sheet.getRange(row, 1, 1, journalWidth_()).getValues()[0];
    if (
      !input.fingerprint ||
      fingerprint_(
        values,
        book.getSpreadsheetTimeZone(),
        sheet.getMaxRows(),
      ) !== input.fingerprint
    )
      throw new Error(
        "This entry changed in the sheet. Refresh before reviewing it.",
      );
    const zone = book.getSpreadsheetTimeZone(),
      rowCount = sheet.getMaxRows();
    const group =
      decision === "Okay" ? duplicateGroup_(values, input.type, zone) : "";
    let members = [{ row, values }];
    if (group) {
      members = sheet
        .getRange(
          columns.firstDataRow,
          1,
          rowCount - columns.firstDataRow + 1,
          journalWidth_(),
        )
        .getValues()
        .map((values, i) => ({ row: i + columns.firstDataRow, values }))
        .filter(
          (entry) => duplicateGroup_(entry.values, input.type, zone) === group,
        );
      // Check every member before any write. A group that changed since loading must
      // be refreshed, even if the clicked entry itself still has the same fingerprint.
      const expected = members.map((entry) => [
        entry.row,
        fingerprint_(entry.values, zone, rowCount),
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
    members.forEach((entry) => {
      literal_(sheet.getRange(entry.row, columns.decision), decision);
      // Preserve other members' existing notes; the note typed beside the clicked
      // entry belongs only to that entry.
      if (entry.row === row)
        literal_(sheet.getRange(entry.row, columns.reviewNote), note);
    });
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
  return withWorkspaceWrite_(input, () => {
    const book = book_(),
      current = checkedTransaction_(book, input);
    const values = transactionValues_(book, input);
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
  });
}

// Remove the actual sheet row after confirmation so no blank gap remains.
// Sheets adjusts remaining formulas and references; stale snapshots are invalidated
// by the changed row count, and withWrite_ prevents a retry from deleting another row.
function deleteTransaction(input) {
  if (!input || typeof input !== "object" || input.confirmed !== true)
    throw new Error("Confirm the transaction deletion first.");
  return withWorkspaceWrite_(input, () => {
    const current = checkedTransaction_(book_(), input);
    const c = workspaceConfig_().layout.journal;
    const arrayCheck = /LET\(descriptions,/i.test(
      current.sheet.getRange(c.firstDataRow, c.duplicateIssue).getFormula(),
    );
    const restoreDates =
      current.row === c.firstDataRow
        ? Object.values(c.dateDerived || {}).filter((column) =>
            /ARRAYFORMULA/i.test(
              current.sheet.getRange(c.firstDataRow, column).getFormula(),
            ),
          )
        : [];
    current.sheet.deleteRow(current.row);
    if (current.sheet.getMaxRows() < c.firstDataRow)
      current.sheet.insertRowsAfter(
        current.sheet.getMaxRows(),
        c.firstDataRow - current.sheet.getMaxRows(),
      );
    // Deleting the first entry also deletes spill anchors; restore only generated columns.
    if (arrayCheck) installDuplicateArray_(current.sheet);
    refreshDateArrays_(current.sheet, restoreDates);
    return { ok: true, type: input.type, row: current.row };
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
    [
      [columns.paymentMethod, "Payment method"],
      [columns.paymentDetail, "Bank / card / UPI app"],
    ].forEach(([column, title]) => {
      const cell = sheet.getRange(1, column);
      if (!cell.getDisplayValues()[0][0]) {
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
  // Migrate previously removed choices without touching journal history.
  // Delete bottom-up so one deletion cannot change another row's position.
  paymentRecords_(book)
    .filter((record) => record.removed)
    .sort((a, b) => b.row - a.row)
    .forEach((record) => sheet.deleteRow(record.row));
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
// Defaults remain available; custom types persist even before a named account is added.
function paymentMethods_(book) {
  const sheet = book.getSheetByName(workspaceConfig_().paymentTypesSheet);
  const custom =
    sheet && sheet.getMaxRows() > 1
      ? sheet
          .getRange(2, 1, sheet.getMaxRows() - 1, 1)
          .getDisplayValues()
          .flat()
      : [];
  const seen = new Set();
  return [...workspaceConfig_().paymentMethods, ...custom]
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
function paymentOptions_(book) {
  const options = Object.fromEntries(
    paymentMethods_(book)
      .filter((method) => method !== "Cash")
      .map((method) => [method, []]),
  );
  paymentRecords_(book).forEach((r) => {
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
    throw new Error("Enter a payment type name up to 60 characters.");
  return withWorkspaceWrite_(input, () => {
    const book = book_();
    ensurePaymentStorage_(book);
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
    return {
      ok: true,
      name: existing || name,
      created: !existing,
      paymentMethods: paymentMethods_(book),
      paymentOptions: paymentOptions_(book),
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
  if (!paymentMethods_(book).includes(paymentMethod))
    throw new Error("Choose a valid payment method.");
  if (paymentMethod === "Cash") return { paymentMethod, paymentDetail: "" };
  // Custom types may stand alone (for example Cheque); built-in account methods still require a name.
  if (
    !paymentDetail &&
    !["Bank transfer", "Card", "UPI"].includes(paymentMethod)
  )
    return { paymentMethod, paymentDetail: "" };
  const active = (paymentOptions_(book)[paymentMethod] || []).includes(
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
    throw new Error("Choose an available payment name.");
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
      "Choose a payment type and enter a name up to 100 characters.",
    );
  return withWorkspaceWrite_(input, () => {
    const book = book_();
    ensurePaymentStorage_(book);
    if (method === "Cash" || !paymentMethods_(book).includes(method))
      throw new Error("Choose an available payment type.");
    const records = paymentRecords_(book),
      existing = records.find(
        (r) => r.method === method && normalized_(r.name) === normalized_(name),
      );
    if (input.action === "remove" && !existing)
      throw new Error(
        "This payment name is no longer available. Refresh the app.",
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
  if (input.kind === "category" && input.type === "investment")
    throw new Error("Investment entries use the Investments category.");
  return withWorkspaceWrite_(input, () => {
    const book = book_(),
      sheet = requiredSheet_(book, workspaceConfig_().lookupSheets[input.type]),
      c = workspaceConfig_().layout.lookup;
    const categories =
      input.type === "investment"
        ? [workspaceConfig_().categories.investment]
        : options_(sheet, c.categoryOptions);
    const categoryName = String(input.newCategory || "").trim();
    if (categoryName.length > workspaceConfig_().limits.descriptionLength)
      throw new Error("The category name is too long.");
    const requestedCategory =
      input.type === "investment"
        ? workspaceConfig_().categories.investment
        : categoryName || String(input.category || "").trim();
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
