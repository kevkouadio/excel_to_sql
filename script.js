let excelData = [];

document.getElementById('fileInput').addEventListener('change', handleFileUpload);
document.getElementById('generateSQL').addEventListener('click', generateSQL);
document.getElementById('copySQL').addEventListener('click', copyToClipboard);

function handleFileUpload(event) {
    const file = event.target.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        excelData = XLSX.utils.sheet_to_json(sheet);

        if (excelData.length === 0) {
            showToast("Excel file is empty.", "error");
            return;
        }
    };

    reader.readAsArrayBuffer(file);
}

function generateSQL() {
    if (excelData.length === 0) {
        showToast("Please upload an Excel file first.", "error");
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
    showToast("SQL generated successfully!", "success");
}

function convertToSQL(jsonData, tableName, sqlFormat) {
    if (!jsonData.length) return "";

    let columnNames = Object.keys(jsonData[0]).join(", ");
    let sqlQuery = "";

    jsonData.forEach(row => {
        let values = Object.values(row).map(value => {
            if (value === undefined || value === null || value === "") {
                return "NULL"; 
            }

            if (typeof value === "string") {
                value = value.replace(/'/g, "''"); 
                return `'${value}'`;
            }

            return value;
        }).join(", ");

        switch (sqlFormat) {
            case "mysql":
                sqlQuery += `INSERT INTO \`${tableName}\` (${columnNames}) VALUES (${values});\n`;
                break;
            case "postgres":
                sqlQuery += `INSERT INTO "${tableName}" (${columnNames}) VALUES (${values});\n`;
                break;
            case "mssql":
                sqlQuery += `INSERT INTO [${tableName}] (${columnNames}) VALUES (${values});\n`;
                break;
        }
    });

    return sqlQuery;
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

// Toast Notification Function
function showToast(message, type = "info") {
    const toastContainer = document.getElementById("toast");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Show the toast
    setTimeout(() => toast.classList.add("show"), 10);

    // Hide the toast after 3 seconds
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300); // Remove after fade-out
    }, 3000);
}