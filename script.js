let excelData = [];

document.getElementById('fileInput').addEventListener('change', handleFileUpload);
document.getElementById('generateSQL').addEventListener('click', generateSQL);
document.getElementById('copySQL').addEventListener('click', copyToClipboard);
document.getElementById('queryType').addEventListener('change', toggleWhereClause);
document.getElementById('scrollUp').addEventListener('click', scrollToTop);
document.getElementById('scrollDown').addEventListener('click', scrollToBottom);
window.addEventListener('scroll', handleScroll);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileNameContainer = document.getElementById("selectedFileName");
    fileNameContainer.textContent = file.name;

    const allowedExtensions = [".xlsx", ".xls", ".csv"];
    const fileExtension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
        showToast("Please upload a valid Excel (.xlsx, .xls) or CSV (.csv) file.", "error");
        event.target.value = ""; 
        fileNameContainer.textContent = ""; 
        return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        let workbook;

        if (fileExtension === ".csv") {
            const csvData = e.target.result;
            const sheet = XLSX.utils.csv_to_sheet(csvData);
            workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
        } else {
            workbook = XLSX.read(data, { type: 'array' });
        }

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        excelData = XLSX.utils.sheet_to_json(sheet);

        if (excelData.length === 0) {
            showToast("The file is empty.", "error");
            return;
        }

        populateWhereColumnSelect(Object.keys(excelData[0]));
    };

    if (fileExtension === ".csv") {
        reader.readAsText(file); 
    } else {
        reader.readAsArrayBuffer(file); 
    }
}

function populateWhereColumnSelect(columns) {
    const whereColumnSelect = document.getElementById("whereColumn");
    whereColumnSelect.innerHTML = ""; // Clear existing options

    columns.forEach(column => {
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

    const sqlFormat = document.getElementById("sqlFormat").value;
    const queryType = document.getElementById("queryType").value;
    const whereColumn = document.getElementById("whereColumn").value;

    const sqlQuery = convertToSQL(excelData, tableName, sqlFormat, queryType, whereColumn);
    document.getElementById("sqlOutput").textContent = sqlQuery;
    document.getElementById("sqlOutputContainer").style.display = "block";
    document.getElementById("generateSQL-text-h3").style.display = "block";
    showToast("SQL generated successfully!", "success");
}

function convertToSQL(jsonData, tableName, sqlFormat, queryType, whereColumn) {
    if (!jsonData.length) return "";

    let columnNames = Object.keys(jsonData[0]).join(", ");
    let postgresColumnNames = Object.keys(jsonData[0]).map(col => `"${col}"`).join(", ");
    let MySqlcolumnNames = Object.keys(jsonData[0]).map(col => `\`${col}\``).join(", ");
    let sqlQuery = "";

    jsonData.forEach(row => {
        let values = Object.values(row).map(value => {
            if (value === undefined || value === null || value === "") {
                return "NULL";
            }

            if (typeof value === "string") {
                if (looksLikeDate(value)) {
                    if (isDate(value)) {
                        value = formatDate(value);
                        return `'${value}'`;
                    }
                    return "'Invalid Date'";
                }
                value = value.replace(/'/g, "''");
                return `'${value}'`;
            }
            return value; 
        }).join(", ");

        let whereCondition = whereColumn ? `${whereColumn} = '${row[whereColumn]}'` : "/* condition */";

        switch (sqlFormat) {
            case "mysql":
                if (queryType === "insert") {
                    sqlQuery += `INSERT INTO \`${tableName}\` (${MySqlcolumnNames}) VALUES (${values});\n`;
                } else if (queryType === "update") {
                    let updateValues = Object.keys(row).filter(col => col !== whereColumn).map(col => {
                        let value = row[col];
                        if (typeof value === "string") {
                            value = value.replace(/'/g, "''");
                            return `\`${col}\` = '${value}'`;
                        }
                        return `\`${col}\` = ${value}`;
                    }).join(", ");
                    sqlQuery += `UPDATE \`${tableName}\` SET ${updateValues} WHERE ${whereCondition};\n`;
                }
                break;
            case "postgres":
                if (queryType === "insert") {
                    sqlQuery += `INSERT INTO "${tableName}" (${postgresColumnNames}) VALUES (${values});\n`;
                } else if (queryType === "update") {
                    let updateValues = Object.keys(row).filter(col => col !== whereColumn).map(col => {
                        let value = row[col];
                        if (typeof value === "string") {
                            value = value.replace(/'/g, "''");
                            return `"${col}" = '${value}'`;
                        }
                        return `"${col}" = ${value}`;
                    }).join(", ");
                    sqlQuery += `UPDATE "${tableName}" SET ${updateValues} WHERE ${whereCondition};\n`;
                }
                break;
            case "mssql":
                if (queryType === "insert") {
                    sqlQuery += `INSERT INTO [${tableName}] (${columnNames}) VALUES (${values});\n`;
                } else if (queryType === "update") {
                    let updateValues = Object.keys(row).filter(col => col !== whereColumn).map(col => {
                        let value = row[col];
                        if (typeof value === "string") {
                            value = value.replace(/'/g, "''");
                            return `[${col}] = '${value}'`;
                        }
                        return `[${col}] = ${value}`;
                    }).join(", ");
                    sqlQuery += `UPDATE [${tableName}] SET ${updateValues} WHERE ${whereCondition};\n`;
                }
                break;
            default:
                throw new Error("Unsupported SQL format");
        }
    });

    return sqlQuery;
}

function toggleWhereClause() {
    const queryType = document.getElementById("queryType").value;
    const whereClauseLabel = document.getElementById("whereClauseLabel");
    const whereColumnSelect = document.getElementById("whereColumn");

    if (queryType === "update") {
        whereClauseLabel.classList.remove("hidden");
        whereColumnSelect.classList.remove("hidden");
    } else {
        whereClauseLabel.classList.add("hidden");
        whereColumnSelect.classList.add("hidden");
    }
}

function isDate(value) {
    const date = new Date(value);
    return !isNaN(date.getTime());
}

function formatDate(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Returns true only when the value matches common date-like patterns.
 * Supports: 01/01/2020, 01-01-2020, 01-jan-2020, jan-01-2026, 01 jan 2020, etc.
 */
function looksLikeDate(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    const s = value.trim();

    // Numeric dates: 01/01/2020, 01-01-2020, 1/1/20, 2020-01-01
    const numericDate = /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/;
    if (numericDate.test(s)) return true;

    // Month name (3+ letters): 01-jan-2020, 01-january-2020, jan-01-2026, january-01-2026
    const monthName = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
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

function copyToClipboard() {
    const sqlOutput = document.getElementById("sqlOutput").textContent;
    if (!sqlOutput) {
        showToast("No SQL to copy.", "error");
        return;
    }
    navigator.clipboard.writeText(sqlOutput).then(() => {
        showToast("SQL copied to clipboard!", "success");
    }).catch(err => {
        console.error("Failed to copy text: ", err);
        showToast("Failed to copy SQL.", "error");
    });
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function handleScroll() {
    const scrollUpButton = document.getElementById('scrollUp');
    const scrollDownButton = document.getElementById('scrollDown');

    if (window.scrollY > 100) {
        scrollUpButton.style.display = 'block';
    } else {
        scrollUpButton.style.display = 'none';
    }

    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
        scrollDownButton.style.display = 'none';
    } else {
        scrollDownButton.style.display = 'block';
    }
}