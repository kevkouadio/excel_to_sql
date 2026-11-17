let excelData = [];
let columnNames = [];

document.getElementById("fileInput").addEventListener("change", handleFileUpload);
document.getElementById("generateSQL").addEventListener("click", generateSQL);
document.getElementById("copySQL").addEventListener("click", copyToClipboard);
document.getElementById("downloadSQL").addEventListener("click", downloadSQL);
document.getElementById("clearAll").addEventListener("click", clearAll);
document.getElementById("queryType").addEventListener("change", toggleWhereClause);
document.getElementById("scrollUp").addEventListener("click", scrollToTop);
document.getElementById("scrollDown").addEventListener("click", scrollToBottom);
window.addEventListener("scroll", handleScroll);
window.addEventListener("load", handleScroll);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileNameContainer = document.getElementById("selectedFileName");
    const fileInfo = document.getElementById("fileInfo");
    fileNameContainer.textContent = file.name;

    const allowedExtensions = [".xlsx", ".xls", ".csv"];
    const fileExtension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
        showToast("Please upload a valid Excel (.xlsx, .xls) or CSV (.csv) file.", "error");
        resetFileState(event.target);
        return;
    }

    const reader = new FileReader();

    reader.onerror = () => {
        showToast("Failed to read the file.", "error");
        resetFileState(event.target);
    };

    reader.onload = (e) => {
        try {
            let workbook;

            if (fileExtension === ".csv") {
                const csvData = e.target.result;
                const sheet = XLSX.utils.csv_to_sheet(csvData);
                workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
            } else {
                const data = new Uint8Array(e.target.result);
                workbook = XLSX.read(data, { type: "array", cellDates: true });
            }

            if (!workbook.SheetNames.length) {
                showToast("The file has no sheets.", "error");
                resetFileState(event.target);
                return;
            }

            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            // Excel text cells must stay text; CSV has no cell types so date-like strings may still convert
            const parsed = parseSheetToRows(sheet, {
                workbook,
                preserveTextCells: fileExtension !== ".csv"
            });
            excelData = parsed.rows;
            columnNames = parsed.columns;

            if (excelData.length === 0) {
                showToast("The file is empty.", "error");
                resetFileState(event.target);
                return;
            }

            populateWhereColumnSelect(columnNames);
            fileInfo.textContent = `${excelData.length} row(s), ${columnNames.length} column(s)`;
            clearSQLOutput();
            showToast("File loaded successfully!", "success");
        } catch (err) {
            console.error(err);
            showToast("Could not parse the file. Please check the format.", "error");
            resetFileState(event.target);
        }
    };

    if (fileExtension === ".csv") {
        reader.readAsText(file);
    } else {
        reader.readAsArrayBuffer(file);
    }
}

function resetFileState(input) {
    input.value = "";
    excelData = [];
    columnNames = [];
    document.getElementById("selectedFileName").textContent = "";
    document.getElementById("fileInfo").textContent = "";
    document.getElementById("whereColumn").innerHTML = "";
    clearSQLOutput();
}

function clearAll() {
    resetFileState(document.getElementById("fileInput"));
    document.getElementById("tableName").value = "";
    document.getElementById("queryType").value = "insert";
    document.getElementById("sqlFormat").value = "mssql";
    toggleWhereClause();
    showToast("Cleared.", "info");
}

function clearSQLOutput() {
    document.getElementById("sqlOutput").textContent = "";
    document.getElementById("sqlOutputContainer").style.display = "none";
    document.getElementById("generateSQL-text-h3").style.display = "none";
    document.getElementById("sqlStats").textContent = "";
}

/**
 * Parse a worksheet into consistent row objects.
 * Unlike sheet_to_json, this keeps every column in the used range even when
 * the header or first data cell is empty — later rows still get that column.
 */
function parseSheetToRows(sheet, options = {}) {
    const preserveTextCells = options.preserveTextCells !== false;
    const workbook = options.workbook || null;
    const range = getSheetRange(sheet);
    if (!range) {
        return { columns: [], rows: [] };
    }

    const columns = [];
    const usedNames = new Set();

    for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
        let name = cellToHeader(cell);

        if (!name) {
            name = `Column_${C + 1}`;
        }

        // Keep column names unique so empty/duplicate headers don't collapse columns
        let uniqueName = name;
        let suffix = 2;
        while (usedNames.has(uniqueName)) {
            uniqueName = `${name}_${suffix}`;
            suffix++;
        }
        usedNames.add(uniqueName);
        columns.push(uniqueName);
    }

    // Drop trailing columns that are completely empty (header placeholder + no data)
    while (columns.length > 0) {
        const lastIndex = columns.length - 1;
        const col = range.s.c + lastIndex;
        if (!isColumnEmpty(sheet, range, col)) break;
        columns.pop();
    }

    if (columns.length === 0) {
        return { columns: [], rows: [] };
    }

    const rows = [];
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
        const row = {};
        let hasAnyValue = false;

        for (let i = 0; i < columns.length; i++) {
            const cell = sheet[XLSX.utils.encode_cell({ r: R, c: range.s.c + i })];
            const value = cellToValue(cell, preserveTextCells, workbook);
            row[columns[i]] = value;
            if (!isEmptyCellValue(value)) {
                hasAnyValue = true;
            }
        }

        // Skip fully blank rows, but keep rows that only have some empty cells
        if (hasAnyValue) {
            rows.push(row);
        }
    }

    return { columns, rows };
}

function isEmptyCellValue(value) {
    if (value === null || value === undefined || value === "") return true;
    if (isPreservedText(value)) return value.value.trim() === "";
    return false;
}

function asPreservedText(value) {
    return { __isPreservedText: true, value: String(value) };
}

function isPreservedText(value) {
    return Boolean(value) && typeof value === "object" && value.__isPreservedText === true;
}

function isExcelTextCell(cell) {
    if (!cell) return false;
    // Shared strings / explicit string types from Excel
    if (cell.t === "s" || cell.t === "str" || cell.t === "inlineStr") return true;
    // Number format "@" means the cell is formatted as Text
    if (typeof cell.z === "string" && cell.z.includes("@")) return true;
    return false;
}

function resolveSharedString(cell, workbook) {
    if (!cell || cell.t !== "s" || !workbook) return null;
    const sst = workbook.Strings;
    if (!sst || cell.v === undefined || cell.v === null) return null;
    const entry = sst[cell.v];
    if (entry == null) return null;
    if (typeof entry === "string") return entry;
    if (typeof entry.t === "string") return entry.t;
    if (entry.v != null) return String(entry.v);
    return null;
}

function resolveCellText(cell, workbook) {
    if (!cell) return "";
    // Prefer formatted/display text when present (preserves values like 08-00-0005)
    if (cell.w !== undefined && cell.w !== null && String(cell.w) !== "") {
        return String(cell.w);
    }
    const shared = resolveSharedString(cell, workbook);
    if (shared !== null) return shared;
    if (typeof XLSX.utils.format_cell === "function") {
        try {
            const formatted = XLSX.utils.format_cell(cell);
            if (formatted !== undefined && formatted !== null && String(formatted) !== "") {
                return String(formatted);
            }
        } catch (err) {
            // fall through
        }
    }
    if (cell.v === undefined || cell.v === null) return "";
    return String(cell.v);
}

function getSheetRange(sheet) {
    let range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;

    // Expand !ref to cover every concrete cell (handles sparse / under-reported ranges)
    Object.keys(sheet).forEach((key) => {
        if (key[0] === "!") return;
        const cell = XLSX.utils.decode_cell(key);
        if (!range) {
            range = { s: { r: cell.r, c: cell.c }, e: { r: cell.r, c: cell.c } };
            return;
        }
        if (cell.r < range.s.r) range.s.r = cell.r;
        if (cell.c < range.s.c) range.s.c = cell.c;
        if (cell.r > range.e.r) range.e.r = cell.r;
        if (cell.c > range.e.c) range.e.c = cell.c;
    });

    return range;
}

function cellToHeader(cell) {
    if (!cell || cell.v === undefined || cell.v === null) return "";
    if (cell.w !== undefined && String(cell.w).trim() !== "") {
        return String(cell.w).trim();
    }
    if (cell.v instanceof Date) {
        return formatDateParts(
            cell.v.getFullYear(),
            cell.v.getMonth() + 1,
            cell.v.getDate()
        );
    }
    return String(cell.v).trim();
}

function cellToValue(cell, preserveTextCells = true, workbook = null) {
    if (!cell || (cell.v === undefined && cell.w === undefined && cell.t !== "inlineStr")) {
        return null;
    }

    // Excel Text cells (and text-formatted cells) must never become dates later
    if (preserveTextCells && isExcelTextCell(cell)) {
        const text = resolveCellText(cell, workbook);
        return text === "" ? null : asPreservedText(text);
    }

    if (cell.t === "d" || cell.v instanceof Date) {
        const date = cell.v instanceof Date ? cell.v : new Date(cell.v);
        return isNaN(date.getTime()) ? null : date;
    }
    if (cell.t === "b") return Boolean(cell.v);
    if (cell.t === "n") return Number(cell.v);
    if (cell.t === "e") return null;

    // Plain strings (e.g. CSV): keep as string; date conversion happens later only if valid
    if (typeof cell.v === "string") {
        return cell.v;
    }
    if (cell.v === undefined || cell.v === null) {
        return cell.w != null ? String(cell.w) : null;
    }
    return cell.v;
}

function isColumnEmpty(sheet, range, col) {
    for (let R = range.s.r; R <= range.e.r; R++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: R, c: col })];
        if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== "") {
            return false;
        }
    }
    return true;
}

function populateWhereColumnSelect(columns) {
    const whereColumnSelect = document.getElementById("whereColumn");
    whereColumnSelect.innerHTML = "";

    columns.forEach((column) => {
        const option = document.createElement("option");
        option.value = column;
        option.textContent = column;
        whereColumnSelect.appendChild(option);
    });
}

function generateSQL() {
    if (excelData.length === 0) {
        showToast("Please upload an Excel or CSV file first.", "error");
        return;
    }

    const tableName = document.getElementById("tableName").value.trim();
    if (!tableName) {
        showToast("Please enter a table name.", "error");
        return;
    }

    if (!isValidIdentifier(tableName)) {
        showToast("Table name can only contain letters, numbers, and underscores.", "error");
        return;
    }

    const sqlFormat = document.getElementById("sqlFormat").value;
    const queryType = document.getElementById("queryType").value;
    const whereColumn = document.getElementById("whereColumn").value;
    const batchInsert = document.getElementById("batchInsert").checked;

    if (queryType === "update" && !whereColumn) {
        showToast("Please select a WHERE column for UPDATE statements.", "error");
        return;
    }

    try {
        const sqlQuery = convertToSQL(
            excelData,
            columnNames,
            tableName,
            sqlFormat,
            queryType,
            whereColumn,
            batchInsert
        );
        document.getElementById("sqlOutput").textContent = sqlQuery;
        document.getElementById("sqlOutputContainer").style.display = "block";
        document.getElementById("generateSQL-text-h3").style.display = "block";
        const statementCount = (sqlQuery.match(/;\s*$/gm) || []).length;
        document.getElementById("sqlStats").textContent =
            `${excelData.length} row(s) · ${statementCount} statement(s) · ${sqlQuery.length.toLocaleString()} characters`;
        showToast("SQL generated successfully!", "success");
        handleScroll();
    } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to generate SQL.", "error");
    }
}

function convertToSQL(jsonData, columns, tableName, sqlFormat, queryType, whereColumn, batchInsert) {
    if (!jsonData.length || !columns.length) return "";

    const quotedTable = quoteIdentifier(tableName, sqlFormat);
    const quotedColumns = columns.map((col) => quoteIdentifier(col, sqlFormat)).join(", ");

    if (queryType === "insert" && batchInsert) {
        return buildBatchInsert(jsonData, columns, quotedTable, quotedColumns, sqlFormat);
    }

    let sqlQuery = "";

    jsonData.forEach((row) => {
        if (queryType === "insert") {
            const values = columns.map((col) => formatSQLValue(row[col], sqlFormat)).join(", ");
            sqlQuery += `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${values});\n`;
            return;
        }

        if (queryType === "update") {
            const setClause = columns
                .filter((col) => col !== whereColumn)
                .map((col) => `${quoteIdentifier(col, sqlFormat)} = ${formatSQLValue(row[col], sqlFormat)}`)
                .join(", ");

            if (!setClause) {
                throw new Error("UPDATE needs at least one column besides the WHERE column.");
            }

            const whereValue = formatSQLValue(row[whereColumn], sqlFormat);
            const whereClause = `${quoteIdentifier(whereColumn, sqlFormat)} = ${whereValue}`;
            sqlQuery += `UPDATE ${quotedTable} SET ${setClause} WHERE ${whereClause};\n`;
        }
    });

    return sqlQuery;
}

function buildBatchInsert(jsonData, columns, quotedTable, quotedColumns, sqlFormat) {
    const batchSize = 100;
    let sqlQuery = "";

    for (let i = 0; i < jsonData.length; i += batchSize) {
        const batch = jsonData.slice(i, i + batchSize);
        const valueRows = batch.map((row) => {
            const values = columns.map((col) => formatSQLValue(row[col], sqlFormat)).join(", ");
            return `(${values})`;
        });
        sqlQuery += `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES\n${valueRows.join(",\n")};\n\n`;
    }

    return sqlQuery.trim() + "\n";
}

function formatSQLValue(value, sqlFormat) {
    if (value === undefined || value === null) {
        return "NULL";
    }

    // Excel Text cells: keep exact text. Never auto-convert numeric lookalikes
    // like 10-02-2003 or 08-00-0005; month-name dates may still convert.
    if (isPreservedText(value)) {
        const text = value.value.trim();
        if (text === "") return "NULL";
        if (hasMonthNameDate(text)) {
            const parts = parseDateString(text);
            if (parts) {
                return `'${formatDateParts(parts.year, parts.month, parts.day)}'`;
            }
        }
        return `'${escapeSQLString(text)}'`;
    }

    if (typeof value === "string" && value.trim() === "") {
        return "NULL";
    }

    if (typeof value === "boolean") {
        if (sqlFormat === "postgres") return value ? "TRUE" : "FALSE";
        return value ? "1" : "0";
    }

    if (value instanceof Date && !isNaN(value.getTime())) {
        return `'${formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate())}'`;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) return "NULL";
        return String(value);
    }

    const str = String(value).trim();

    if (looksLikeDate(str)) {
        const parts = parseDateString(str);
        if (parts) {
            return `'${formatDateParts(parts.year, parts.month, parts.day)}'`;
        }
        // Keep original text if it looked date-like but could not be parsed safely
        return `'${escapeSQLString(str)}'`;
    }

    return `'${escapeSQLString(str)}'`;
}

function escapeSQLString(value) {
    return String(value).replace(/'/g, "''");
}

function quoteIdentifier(name, sqlFormat) {
    const cleaned = String(name).replace(/[`"\[\]]/g, "");
    switch (sqlFormat) {
        case "mysql":
            return `\`${cleaned.replace(/`/g, "``")}\``;
        case "postgres":
            return `"${cleaned.replace(/"/g, '""')}"`;
        case "mssql":
            return `[${cleaned.replace(/]/g, "]]")}]`;
        default:
            return cleaned;
    }
}

function isValidIdentifier(name) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

const MONTH_MAP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
};

/**
 * Returns true only when the value matches common date-like patterns.
 * Supports: 01/01/2020, 01-01-2020, 01-jan-2020, jan-01-2026, 01 jan 2020, etc.
 */
function looksLikeDate(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    const s = value.trim();

    // Codes like 08-00-0005 are not dates
    if (looksLikeDateCode(s)) return false;

    const numericDate = /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/;
    if (numericDate.test(s)) return true;

    const monthName =
        "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
    const withMonthName = new RegExp(
        "^(" +
            "\\d{1,2}[-\\/\\s]" + monthName + "[-\\/\\s]\\d{2,4}" +
            "|" +
            monthName + "[-\\/\\s]\\d{1,2}[-\\/\\s]\\d{2,4}" +
            ")$",
        "i"
    );
    return withMonthName.test(s);
}

/**
 * Detects identifier/code patterns that resemble dates but are not
 * (zero month/day segments, or years like 0005).
 */
function looksLikeDateCode(value) {
    const parts = value.trim().split(/[-\/]/);
    if (parts.length !== 3) return false;
    if (parts.some((part) => part !== "" && /^0+$/.test(part))) return true;
    if (parts.some((part) => part.length >= 4 && /^0\d+$/.test(part))) return true;
    return false;
}

function hasMonthNameDate(value) {
    const monthName =
        "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
    const withMonthName = new RegExp(
        "^(" +
            "\\d{1,2}[-\\/\\s]" + monthName + "[-\\/\\s]\\d{2,4}" +
            "|" +
            monthName + "[-\\/\\s]\\d{1,2}[-\\/\\s]\\d{2,4}" +
            ")$",
        "i"
    );
    return withMonthName.test(String(value).trim());
}

function parseYearToken(token) {
    // Reject code-like years such as 0005
    if (token.length >= 4 && /^0\d+$/.test(token)) return null;
    const year = normalizeYear(Number(token));
    return Number.isFinite(year) ? year : null;
}

function parseDateString(value) {
    const s = value.trim();
    if (looksLikeDateCode(s)) return null;

    // Day-MonthName-Year: 01-jan-2020
    let match = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]+)[-\/\s](\d{2,4})$/);
    if (match) {
        const day = Number(match[1]);
        const month = MONTH_MAP[match[2].toLowerCase()];
        const year = parseYearToken(match[3]);
        if (year == null) return null;
        return isValidDateParts(year, month, day) ? { year, month, day } : null;
    }

    // MonthName-Day-Year: jan-01-2026
    match = s.match(/^([A-Za-z]+)[-\/\s](\d{1,2})[-\/\s](\d{2,4})$/);
    if (match) {
        const month = MONTH_MAP[match[1].toLowerCase()];
        const day = Number(match[2]);
        const year = parseYearToken(match[3]);
        if (year == null) return null;
        return isValidDateParts(year, month, day) ? { year, month, day } : null;
    }

    // Numeric: YYYY-MM-DD or YYYY/MM/DD
    match = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (match) {
        const year = parseYearToken(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (year == null) return null;
        return isValidDateParts(year, month, day) ? { year, month, day } : null;
    }

    // Numeric: DD-MM-YYYY or MM-DD-YYYY (prefer day-first when day > 12)
    match = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
    if (match) {
        const a = Number(match[1]);
        const b = Number(match[2]);
        const year = parseYearToken(match[3]);
        if (year == null) return null;
        // Reject zero month/day segments (e.g. 08-00-0005)
        if (a === 0 || b === 0) return null;

        // Ambiguous US/EU dates: if first part > 12 treat as DD-MM-YYYY,
        // else if second > 12 treat as MM-DD-YYYY, else default to DD-MM-YYYY.
        let day;
        let month;
        if (a > 12 && b <= 12) {
            day = a;
            month = b;
        } else if (b > 12 && a <= 12) {
            month = a;
            day = b;
        } else {
            day = a;
            month = b;
        }

        return isValidDateParts(year, month, day) ? { year, month, day } : null;
    }

    return null;
}

function normalizeYear(year) {
    if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
    return year;
}

function isValidDateParts(year, month, day) {
    if (!year || !month || !day) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    if (year < 1000 || year > 9999) return false;

    const date = new Date(year, month - 1, day);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

function formatDateParts(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function copyToClipboard() {
    const sqlOutput = document.getElementById("sqlOutput").textContent;
    if (!sqlOutput) {
        showToast("No SQL to copy.", "error");
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sqlOutput).then(() => {
            showToast("SQL copied to clipboard!", "success");
        }).catch(() => {
            fallbackCopy(sqlOutput);
        });
    } else {
        fallbackCopy(sqlOutput);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand("copy");
        showToast("SQL copied to clipboard!", "success");
    } catch (err) {
        console.error("Failed to copy text: ", err);
        showToast("Failed to copy SQL.", "error");
    }
    document.body.removeChild(textarea);
}

function downloadSQL() {
    const sqlOutput = document.getElementById("sqlOutput").textContent;
    if (!sqlOutput) {
        showToast("No SQL to download.", "error");
        return;
    }

    const tableName = document.getElementById("tableName").value.trim() || "export";
    const blob = new Blob([sqlOutput], { type: "text/sql;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tableName}.sql`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("SQL file downloaded!", "success");
}

function toggleWhereClause() {
    const queryType = document.getElementById("queryType").value;
    const whereClauseLabel = document.getElementById("whereClauseLabel");
    const whereColumnSelect = document.getElementById("whereColumn");
    const batchInsertLabel = document.getElementById("batchInsertLabel");

    if (queryType === "update") {
        whereClauseLabel.classList.remove("hidden");
        whereColumnSelect.classList.remove("hidden");
        batchInsertLabel.classList.add("hidden");
    } else {
        whereClauseLabel.classList.add("hidden");
        whereColumnSelect.classList.add("hidden");
        batchInsertLabel.classList.remove("hidden");
    }
}

function showToast(message, type = "info") {
    const toastContainer = document.getElementById("toast");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => toast.classList.add("show"), 10);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

function handleScroll() {
    const scrollUpButton = document.getElementById("scrollUp");
    const scrollDownButton = document.getElementById("scrollDown");
    const nearTop = window.scrollY <= 100;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 100;
    const pageScrollable = document.body.offsetHeight > window.innerHeight + 50;

    scrollUpButton.classList.toggle("hidden", nearTop || !pageScrollable);
    scrollDownButton.classList.toggle("hidden", nearBottom || !pageScrollable);
}
