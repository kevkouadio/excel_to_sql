let excelData = [];

document.getElementById('fileInput').addEventListener('change', handleFileUpload);
document.getElementById('generateSQL').addEventListener('click', generateSQL);
document.getElementById('copySQL').addEventListener('click', copyToClipboard);

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
    };

    if (fileExtension === ".csv") {
        reader.readAsText(file); 
    } else {
        reader.readAsArrayBuffer(file); 
    }
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

    const sqlQuery = convertToSQL(excelData, tableName, sqlFormat);
    document.getElementById("sqlOutput").textContent = sqlQuery;
    document.getElementById("sqlOutputContainer").style.display = "block";
    document.getElementById("generateSQL-text-h3").style.display = "block";
    showToast("SQL generated successfully!", "success");
}

function convertToSQL(jsonData, tableName, sqlFormat) {
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
                if (isDate(value)) {
                    value = formatDate(value); 
                } else if (looksLikeDate(value)) {
                    return "'Invalid Date'"; 
                }
                value = value.replace(/'/g, "''");
                return `'${value}'`; 
            }
            return value; 
        }).join(", ");

        switch (sqlFormat) {
            case "mysql":
                sqlQuery += `INSERT INTO \`${tableName}\` (${MySqlcolumnNames}) VALUES (${values});\n`;
                break;
            case "postgres":
                sqlQuery += `INSERT INTO "${tableName}" (${postgresColumnNames}) VALUES (${values});\n`;
                break;
            case "mssql":
                sqlQuery += `INSERT INTO [${tableName}] (${columnNames}) VALUES (${values});\n`;
                break;
            default:
                throw new Error("Unsupported SQL format");
        }
    });

    return sqlQuery;
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


function looksLikeDate(value) {
    const dateLikePattern = /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/;
    return dateLikePattern.test(value);
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

function looksLikeDate(value) {
    const dateLikePattern = /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/;
    return dateLikePattern.test(value);
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