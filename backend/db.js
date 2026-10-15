require("dotenv").config();

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: (() => {
    const p = process.env.DB_PASSWORD;
    console.log("DB password loaded:", Boolean(p));
    return p || "";
})(),
    
    database: "restaurant_db",
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool;
