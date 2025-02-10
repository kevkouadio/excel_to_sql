/* filepath: script.js */
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
            alert("Excel file is empty.");
            return;
        }

        displayColumnMapping(Object.keys(excelData[0]));
    };

    reader.readAsArrayBuffer(file);
}

function displayColumnMapping(columns) {
    const columnMappingDiv = document.getElementById("columnMapping");
    columnMappingDiv.innerHTML = ""; 

    columns.forEach(col => {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = `Map ${col} to SQL column`;
        input.dataset.excelColumn = col;
        columnMappingDiv.appendChild(input);
        columnMappingDiv.appendChild(document.createElement("br"));
    });
}

function generateSQL() {
    if (excelData.length === 0) {
        alert("Please upload an Excel file first.");
        return;
    }

    const tableName = document.getElementById("tableName").value.trim();
    if (!tableName) {
        alert("Please enter a table name.");
        return;
    }

    const sqlFormat = document.getElementById("sqlFormat").value;
    const columnInputs = document.querySelectorAll("#columnMapping input");
    const columnMapping = {};

    columnInputs.forEach(input => {
        if (input.value.trim() !== "") {
            columnMapping[input.dataset.excelColumn] = input.value.trim();
        } else {
            columnMapping[input.dataset.excelColumn] = input.dataset.excelColumn; 
        }
    });

    const sqlQuery = convertToSQL(excelData, tableName, columnMapping, sqlFormat);
    document.getElementById("sqlOutput").textContent = sqlQuery;
    document.getElementById("copySQL").style.display = "block"; 
}

function convertToSQL(jsonData, tableName, columnMapping, sqlFormat) {
    if (!jsonData.length) return "";

    let columnNames = Object.values(columnMapping).map(col => `\`${col}\``).join(", ");
    let values = jsonData.map(row => {
        return "(" + Object.keys(columnMapping).map(key => {
            let value = row[key];

            if (value === undefined || value === null || value === "") {
                return "NULL"; 
            }

            if (typeof value === "string") {
                value = value.replace(/'/g, "''"); 
                return `'${value}'`;
            }

            return value;
        }).join(", ") + ")";
    }).join(",\n");

    let sqlQuery = "";

    switch (sqlFormat) {
        case "mysql":
            sqlQuery = `INSERT INTO \`${tableName}\` (${columnNames}) VALUES\n${values};`;
            break;
        case "postgres":
            sqlQuery = `INSERT INTO "${tableName}" (${columnNames}) VALUES\n${values};`;
            break;
        case "mssql":
            sqlQuery = `INSERT INTO [${tableName}] (${columnNames}) VALUES\n${values};`;
            break;
    }

    return sqlQuery;
}

function copyToClipboard() {
    const sqlOutput = document.getElementById("sqlOutput").textContent;
    if (!sqlOutput) return;

    navigator.clipboard.writeText(sqlOutput).then(() => {
        alert("SQL query copied to clipboard!");
    }).catch(err => {
        console.error("Failed to copy text: ", err);
    });
}