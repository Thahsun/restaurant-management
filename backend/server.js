require("dotenv").config();
const express = require("express");
const db = require("./db");

const app = express();
const path = require('path');
const fs = require("fs");

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = 3000;

console.log(
    "Frontend folder exists:",
    fs.existsSync(path.join(__dirname, "..", "frontend"))
);

app.get("/api", (req, res) => {
    res.json({ message: "Restaurant API is running!" });
});

// --- Dashboard Statistics API ---
app.get("/api/dashboard-stats", async (req, res) => {
    try {
        const [salesRows] = await db.query(`
            SELECT SUM(amount) AS total_sales 
            FROM payments 
            WHERE payment_status = 'Completed'
        `);
        const totalSales = salesRows[0].total_sales || 0;

        const [orderRows] = await db.query(`
            SELECT COUNT(*) AS total_orders FROM orders
        `);
        const totalOrders = orderRows[0].total_orders || 0;

        const [tableRows] = await db.query(`
            SELECT 
                SUM(CASE WHEN status = 'Occupied' THEN 1 ELSE 0 END) AS occupied_tables,
                COUNT(*) AS total_tables
            FROM rest_tables
        `);
        const occupiedTables = tableRows[0].occupied_tables || 0;
        const totalTables = tableRows[0].total_tables || 0;
        const tablePercentage = totalTables > 0 ? Math.round((occupiedTables / totalTables) * 100) : 0;

        const [revenueRows] = await db.query(`
            SELECT SUM(amount) AS total_revenue 
            FROM payments 
            WHERE payment_status = 'Completed'
        `);
        const totalRevenue = revenueRows[0].total_revenue || 0;

        res.json({
            total_sales: totalSales,
            orders: totalOrders,
            tables_occupied: occupiedTables,
            tables_total: totalTables,
            tables_text: `${occupiedTables}/${totalTables}`,
            tables_percentage: tablePercentage,
            revenue: totalRevenue
        });
    } catch (error) {
        console.error("Dashboard stats error:", error);
        res.status(500).json({ message: "Failed to load dashboard statistics" });
    }
});

// --- Menu API ---
app.get("/api/menu", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                menu_items.id,
                menu_items.name,
                categories.name AS category_name,
                menu_items.price,
                menu_items.stock,
                menu_items.status
            FROM menu_items
            LEFT JOIN categories
                ON menu_items.category_id = categories.id
        `);
        res.json(rows);
    } catch (error) {
        console.error("Menu error:", error.message);
        res.status(500).json({ message: "Unable to load menu items" });
    }
});

app.get("/api/categories", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, name FROM categories");
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to load categories" });
    }
});

app.post("/api/menu", async (req, res) => {
    try {
        const { name, category_id, price, stock, status } = req.body;
        const [result] = await db.query(
            `INSERT INTO menu_items (name, category_id, price, stock, status) VALUES (?, ?, ?, ?, ?)`,
            [name.trim(), Number(category_id), Number(price), Number(stock), status || "Available"]
        );
        res.status(201).json({ message: "Menu item added successfully!", id: result.insertId });
    } catch (error) {
        console.error("Add menu item error:", error);
        res.status(500).json({ message: "Failed to add menu item" });
    }
});

// --- Customer Management API ---
app.get('/api/customers', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, name, phone FROM customers ORDER BY id DESC'
        );
        res.json(rows);
    } catch (err) {
        console.error('Get customers error:', err);
        res.status(500).json({ error: 'Failed to get customers' });
    }
});

app.post('/api/customers', async (req, res) => {
    try {
        const { name, phone } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Customer name is required' });
        }
        const [result] = await db.query(
            'INSERT INTO customers (name, phone) VALUES (?, ?)',
            [name.trim(), phone || null]
        );
        res.status(201).json({ message: 'Customer added successfully', id: result.insertId });
    } catch (err) {
        console.error('Add customer error:', err);
        res.status(500).json({ error: 'Failed to add customer' });
    }
});

app.put('/api/customers/:id', async (req, res) => {
    try {
        const { name, phone } = req.body;
        const id = Number(req.params.id);
        const [result] = await db.query(
            'UPDATE customers SET name = ?, phone = ? WHERE id = ?',
            [name.trim(), phone || null, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json({ message: 'Customer updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

app.delete('/api/customers/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const [result] = await db.query('DELETE FROM customers WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json({ message: 'Customer deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete customer' });
    }
});

// --- Orders API ---
app.get("/api/orders", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT id, customer_id, table_id, total_amount, order_date
            FROM orders
            ORDER BY id DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error("Orders error:", error);
        res.status(500).json({ message: "Failed to load orders" });
    }
});

app.post("/api/orders", async (req, res) => {
    const { customer_id, table_id, menu_item_id, quantity } = req.body;

    const customerId = Number(customer_id);
    const tableId = Number(table_id);
    const menuItemId = Number(menu_item_id);
    const qty = Number(quantity);

    if (
        !Number.isInteger(customerId) || customerId <= 0 ||
        !Number.isInteger(tableId) || tableId <= 0 ||
        !Number.isInteger(menuItemId) || menuItemId <= 0 ||
        !Number.isInteger(qty) || qty <= 0
    ) {
        return res.status(400).json({
            message: "Select customer, table, food and valid quantity."
        });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [customers] = await connection.query("SELECT id FROM customers WHERE id = ?", [customerId]);
        const [tables] = await connection.query("SELECT id FROM rest_tables WHERE id = ?", [tableId]);
        const [foods] = await connection.query("SELECT id, price, stock, status FROM menu_items WHERE id = ? FOR UPDATE", [menuItemId]);

        if (!customers.length || !tables.length || !foods.length) {
            await connection.rollback();
            return res.status(400).json({ message: "Customer, table or food item was not found." });
        }

        const food = foods[0];
        if (food.status !== "Available" || food.stock < qty) {
            await connection.rollback();
            return res.status(400).json({ message: "Food is unavailable or stock is insufficient." });
        }

        const total = Number(food.price) * qty;

        const [orderResult] = await connection.query(
            `INSERT INTO orders (customer_id, table_id, total_amount) VALUES (?, ?, ?)`,
            [customerId, tableId, total]
        );

        await connection.query(
            `INSERT INTO order_items (order_id, menu_item_id, quantity, price) VALUES (?, ?, ?, ?)`,
            [orderResult.insertId, menuItemId, qty, food.price]
        );

        await connection.query(
            "UPDATE menu_items SET stock = stock - ? WHERE id = ?",
            [qty, menuItemId]
        );

        await connection.commit();

        res.status(201).json({
            message: "Order placed successfully!",
            order_id: orderResult.insertId,
            total_amount: total
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Create order error:", error);
        res.status(500).json({ message: "Failed to place order." });
    } finally {
        if (connection) connection.release();
    }
});

// --- Payments API ---
app.get('/api/payments', async (req, res) => {
    try {
        const [results] = await db.query("SELECT id, order_id, amount, payment_method, payment_status, payment_date FROM payments ORDER BY id DESC");
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch payments' });
    }
});
app.post('/api/payments', async (req, res) => {
    try {
        const { order_id, amount, payment_method, payment_status } = req.body;

        if (!order_id || !amount) {
            return res.status(400).json({ error: 'Order ID and amount are required' });
        }

        const [result] = await db.query(
            `INSERT INTO payments (order_id, amount, payment_method, payment_status, payment_date) 
             VALUES (?, ?, ?, ?, NOW())`,
            [
                Number(order_id), 
                Number(amount), 
                payment_method || 'Cash', 
                payment_status || 'Completed'
            ]
        );

        res.status(201).json({ 
            message: 'Payment recorded successfully', 
            payment_id: result.insertId 
        });
    } catch (err) {
        console.error('Add payment error:', err);
        
        // Handle foreign key constraint failure gracefully
        if (err.errno === 1452) {
            return res.status(400).json({ error: 'Invalid Order ID: The specified order does not exist.' });
        }

        res.status(500).json({ error: 'Failed to record payment' });
    }
});

// --- Tables API ---
// --- Tables API ---
app.get('/api/rest_tables', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, table_no, capacity, status FROM rest_tables ORDER BY table_no");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add Table POST Endpoint
app.post('/api/rest_tables', async (req, res) => {
    try {
        const { table_no, capacity, status } = req.body;

        if (!table_no) {
            return res.status(400).json({ error: 'Table number is required' });
        }

        const [result] = await db.query(
            `INSERT INTO rest_tables (table_no, capacity, status) VALUES (?, ?, ?)`,
            [
                table_no.toString().trim(), 
                capacity ? Number(capacity) : 4, // Default capacity to 4 if not provided
                status || 'Available'
            ]
        );

        res.status(201).json({ 
            message: 'Table added successfully!', 
            table_id: result.insertId 
        });
    } catch (err) {
        console.error('Add table error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Table number already exists' });
        }
        res.status(500).json({ error: 'Failed to add table' });
    }
});

// Update Restaurant Table
app.put('/api/rest_tables/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { table_no, capacity, status } = req.body;

        const [result] = await db.query(
            `UPDATE rest_tables
             SET table_no = ?, capacity = ?, status = ?
             WHERE id = ?`,
            [table_no, Number(capacity), status, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: 'Table not found'
            });
        }

        res.json({
            message: 'Table updated successfully'
        });

    } catch (err) {
        console.error('Update table error:', err);

        res.status(500).json({
            error: err.message
        });
    }
});


// Delete Restaurant Table
app.delete('/api/rest_tables/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            'DELETE FROM rest_tables WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: 'Table not found'
            });
        }

        res.json({
            message: 'Table deleted successfully'
        });

    } catch (err) {
        console.error('Delete table error:', err);

        res.status(500).json({
            error: err.message
        });
    }
});





































const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
    console.log("Server error:", err.message);
});