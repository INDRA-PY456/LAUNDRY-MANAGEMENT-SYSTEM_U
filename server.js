const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 5000);
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  createDatabaseTable: true
});
app.use(session({
  name: "washflow.sid",
  secret: process.env.SESSION_SECRET || "local-development-only-change-this-secret",
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, "..", "frontend")));

async function initializeDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS customers (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      email VARCHAR(190) NOT NULL DEFAULT '',
      address VARCHAR(255) NOT NULL DEFAULT ''
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE IF NOT EXISTS orders (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      customerId INT NOT NULL,
      customerName VARCHAR(150) NOT NULL,
      service VARCHAR(100) NOT NULL,
      item VARCHAR(100) NOT NULL,
      quantity INT NOT NULL,
      orderDate DATE NULL,
      deliveryDate DATE NULL,
      total DECIMAL(10,2) NOT NULL DEFAULT 0,
      paymentStatus VARCHAR(30) NOT NULL DEFAULT 'Pending',
      status VARCHAR(30) NOT NULL DEFAULT 'Received',
      INDEX idx_orders_customerId (customerId),
      INDEX idx_orders_status (status)
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      passwordHash VARCHAR(255) NOT NULL,
      role VARCHAR(30) NOT NULL DEFAULT 'admin',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      const [users] = await connection.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [adminEmail]);
      if (!users.length) {
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await connection.execute("INSERT INTO users (email, passwordHash, role) VALUES (?, ?, 'admin')", [adminEmail, passwordHash]);
      }
    }
  } finally {
    connection.release();
  }
}

async function queryOne(sql, values = []) {
  const [rows] = await pool.execute(sql, values);
  return rows[0] || null;
}

async function queryAll(sql, values = []) {
  const [rows] = await pool.execute(sql, values);
  return rows;
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "login.html")));
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    res.status(500).json({ status: "error", database: "disconnected" });
  }
});

app.use("/api", (req, res, next) => {
  if (req.path === "/login" || req.path === "/health") return next();
  if (!req.session.user) return res.status(401).json({ message: "Please log in to continue" });
  next();
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ message: "Unable to log out" });
    res.clearCookie("washflow.sid", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    res.json({ message: "Logged out successfully" });
  });
});

app.get("/api/customers", async (req, res, next) => {
  try { res.json(await queryAll("SELECT * FROM customers ORDER BY id DESC")); } catch (error) { next(error); }
});

app.get("/api/customers/:id", async (req, res, next) => {
  try {
    const customer = await queryOne("SELECT * FROM customers WHERE id = ?", [Number(req.params.id)]);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  } catch (error) { next(error); }
});

app.post("/api/customers", async (req, res, next) => {
  try {
    const { name, phone, email, address } = req.body;
    if (!name || !phone) return res.status(400).json({ message: "Name and phone are required" });
    const [result] = await pool.execute("INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)", [name, phone, email || "", address || ""]);
    res.status(201).json({ message: "Customer created successfully", customer: await queryOne("SELECT * FROM customers WHERE id = ?", [result.insertId]) });
  } catch (error) { next(error); }
});

app.put("/api/customers/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const customer = await queryOne("SELECT * FROM customers WHERE id = ?", [id]);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    const { name, phone, email, address } = req.body;
    await pool.execute("UPDATE customers SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?", [name ?? customer.name, phone ?? customer.phone, email ?? customer.email, address ?? customer.address, id]);
    res.json({ message: "Customer updated successfully", customer: await queryOne("SELECT * FROM customers WHERE id = ?", [id]) });
  } catch (error) { next(error); }
});

app.delete("/api/customers/:id", async (req, res, next) => {
  try {
    const [orders] = await pool.execute("SELECT id FROM orders WHERE customerId = ? LIMIT 1", [Number(req.params.id)]);
    if (orders.length) return res.status(409).json({ message: "This customer has orders and cannot be deleted" });
    const [result] = await pool.execute("DELETE FROM customers WHERE id = ?", [Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ message: "Customer not found" });
    res.json({ message: "Customer deleted successfully" });
  } catch (error) { next(error); }
});

app.get("/api/orders", async (req, res, next) => {
  try { res.json(await queryAll("SELECT * FROM orders ORDER BY id DESC")); } catch (error) { next(error); }
});

app.get("/api/orders/:id", async (req, res, next) => {
  try {
    const order = await queryOne("SELECT * FROM orders WHERE id = ?", [Number(req.params.id)]);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (error) { next(error); }
});

app.post("/api/orders", async (req, res, next) => {
  try {
    const { customerId, service, item, quantity, orderDate, deliveryDate, total, paymentStatus } = req.body;
    if (!customerId || !service || !item || !quantity) return res.status(400).json({ message: "Customer, service, item and quantity are required" });
    const customer = await queryOne("SELECT * FROM customers WHERE id = ?", [Number(customerId)]);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    const [result] = await pool.execute("INSERT INTO orders (customerId, customerName, service, item, quantity, orderDate, deliveryDate, total, paymentStatus, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Received')", [Number(customerId), customer.name, service, item, Number(quantity), orderDate || null, deliveryDate || null, Number(total || 0), paymentStatus || "Pending"]);
    res.status(201).json({ message: "Order created successfully", order: await queryOne("SELECT * FROM orders WHERE id = ?", [result.insertId]) });
  } catch (error) { next(error); }
});

app.put("/api/orders/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const order = await queryOne("SELECT * FROM orders WHERE id = ?", [id]);
    if (!order) return res.status(404).json({ message: "Order not found" });
    const { customerId, service, item, quantity, orderDate, deliveryDate, total, paymentStatus } = req.body;
    let newCustomerId = order.customerId;
    let customerName = order.customerName;
    if (customerId !== undefined) {
      const customer = await queryOne("SELECT * FROM customers WHERE id = ?", [Number(customerId)]);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      newCustomerId = Number(customerId);
      customerName = customer.name;
    }
    await pool.execute("UPDATE orders SET customerId = ?, customerName = ?, service = ?, item = ?, quantity = ?, orderDate = ?, deliveryDate = ?, total = ?, paymentStatus = ? WHERE id = ?", [newCustomerId, customerName, service ?? order.service, item ?? order.item, quantity !== undefined ? Number(quantity) : order.quantity, orderDate !== undefined ? orderDate || null : order.orderDate, deliveryDate !== undefined ? deliveryDate || null : order.deliveryDate, total !== undefined ? Number(total) : order.total, paymentStatus ?? order.paymentStatus, id]);
    res.json({ message: "Order updated successfully", order: await queryOne("SELECT * FROM orders WHERE id = ?", [id]) });
  } catch (error) { next(error); }
});

app.put("/api/orders/:id/status", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const allowedStatuses = ["Received", "Washing", "Drying", "Ironing", "Ready", "Completed"];
    if (!allowedStatuses.includes(status)) return res.status(400).json({ message: "Invalid order status" });
    const existing = await queryOne("SELECT id FROM orders WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ message: "Order not found" });
    await pool.execute("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    res.json({ message: "Order status updated successfully", order: await queryOne("SELECT * FROM orders WHERE id = ?", [id]) });
  } catch (error) { next(error); }
});

app.put("/api/orders/:id/payment", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paymentStatus } = req.body;
    const allowedStatuses = ["Pending", "Paid", "Partially Paid"];
    if (!allowedStatuses.includes(paymentStatus)) return res.status(400).json({ message: "Invalid payment status" });
    const existing = await queryOne("SELECT id FROM orders WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ message: "Order not found" });
    await pool.execute("UPDATE orders SET paymentStatus = ? WHERE id = ?", [paymentStatus, id]);
    res.json({ message: "Payment status updated successfully", order: await queryOne("SELECT * FROM orders WHERE id = ?", [id]) });
  } catch (error) { next(error); }
});

app.delete("/api/orders/:id", async (req, res, next) => {
  try {
    const [result] = await pool.execute("DELETE FROM orders WHERE id = ?", [Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted successfully" });
  } catch (error) { next(error); }
});

app.get("/api/dashboard", async (req, res, next) => {
  try {
    const stats = await queryOne("SELECT COUNT(*) AS totalOrders, SUM(status = 'Completed') AS completedOrders, COALESCE(SUM(total), 0) AS totalRevenue FROM orders");
    const recentOrders = await queryAll("SELECT * FROM orders ORDER BY id DESC LIMIT 5");
    const totalOrders = Number(stats.totalOrders || 0);
    const completedOrders = Number(stats.completedOrders || 0);
    res.json({ totalOrders, completedOrders, pendingOrders: totalOrders - completedOrders, totalRevenue: Number(stats.totalRevenue || 0), recentOrders });
  } catch (error) { next(error); }
});

app.get("/api/payments", async (req, res, next) => {
  try { res.json(await queryAll("SELECT id AS orderId, customerName, total, paymentStatus, orderDate FROM orders ORDER BY id DESC")); } catch (error) { next(error); }
});

app.get("/api/reports", async (req, res, next) => {
  try {
    const stats = await queryOne("SELECT COUNT(*) AS totalOrders, SUM(status = 'Completed') AS completedOrders, COALESCE(SUM(total), 0) AS totalRevenue, COALESCE(SUM(CASE WHEN paymentStatus = 'Paid' THEN total ELSE 0 END), 0) AS paidAmount, COALESCE(SUM(CASE WHEN paymentStatus = 'Pending' THEN total ELSE 0 END), 0) AS pendingPayment FROM orders");
    const serviceReport = await queryAll("SELECT service, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders GROUP BY service");
    const totalOrders = Number(stats.totalOrders || 0);
    const completedOrders = Number(stats.completedOrders || 0);
    res.json({ totalOrders, completedOrders, pendingOrders: totalOrders - completedOrders, totalRevenue: Number(stats.totalRevenue || 0), paidAmount: Number(stats.paidAmount || 0), pendingPayment: Number(stats.pendingPayment || 0), serviceReport });
  } catch (error) { next(error); }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
    const user = await queryOne("SELECT id, email, passwordHash, role FROM users WHERE email = ? LIMIT 1", [email.trim().toLowerCase()]);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: "Invalid email or password" });
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.user = { id: user.id, email: user.email, role: user.role };
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.json({ message: "Login successful", user: req.session.user });
      });
    });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(500).json({ message: "An unexpected server error occurred" });
});

async function start() {
  const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SESSION_SECRET"];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  await initializeDatabase();
  app.listen(PORT, "0.0.0.0", () => console.log(`LMS running on port ${PORT}`));
}

start().catch(error => {
  console.error(error.message);
  process.exit(1);
});
