const Database = require("better-sqlite3");
const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config();

async function migrate() {
  const sqlitePath = path.join(__dirname, "washflow.db");
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  try {
    const customers = sqlite.prepare("SELECT * FROM customers ORDER BY id").all();
    const orders = sqlite.prepare("SELECT * FROM orders ORDER BY id").all();
    await connection.beginTransaction();
    for (const customer of customers) {
      await connection.execute(
        "INSERT INTO customers (id, name, phone, email, address) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone), email = VALUES(email), address = VALUES(address)",
        [customer.id, customer.name, customer.phone, customer.email || "", customer.address || ""]
      );
    }
    for (const order of orders) {
      await connection.execute(
        "INSERT INTO orders (id, customerId, customerName, service, item, quantity, orderDate, deliveryDate, total, paymentStatus, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE customerId = VALUES(customerId), customerName = VALUES(customerName), service = VALUES(service), item = VALUES(item), quantity = VALUES(quantity), orderDate = VALUES(orderDate), deliveryDate = VALUES(deliveryDate), total = VALUES(total), paymentStatus = VALUES(paymentStatus), status = VALUES(status)",
        [order.id, order.customerId, order.customerName, order.service, order.item, order.quantity, order.orderDate || null, order.deliveryDate || null, order.total || 0, order.paymentStatus || "Pending", order.status || "Received"]
      );
    }
    await connection.commit();
    console.log(`Migration complete: ${customers.length} customers and ${orders.length} orders copied.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    sqlite.close();
    await connection.end();
  }
}

const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

migrate().catch(error => {
  console.error(error.message);
  process.exit(1);
});
