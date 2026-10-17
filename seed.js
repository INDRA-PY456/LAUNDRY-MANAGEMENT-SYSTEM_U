const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "washflow.db"));

const seed = db.transaction(() => {
  const existing = db.prepare(
    "SELECT COUNT(*) AS count FROM customers WHERE email LIKE 'demo%@washflow.local'"
  ).get().count;

  if (existing > 0) {
    console.log("Demo data already exists. Run reset-demo.js first if you want to reseed it.");
    return;
  }

  const customers = [
    ["Kill Bill Pandey", "9876543210", "demo1@washflow.local", "Benz Circle, Vijayawada"],
    ["Ajaanbahu", "9876543211", "demo2@washflow.local", "Patamata, Vijayawada"],
    ["Indra", "9876543212", "demo3@washflow.local", "Governorpet, Vijayawada"]
  ];

  const insertCustomer = db.prepare(
    "INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)"
  );

  const customerIds = customers.map(customer =>
    Number(insertCustomer.run(...customer).lastInsertRowid)
  );

  const insertOrder = db.prepare(`
    INSERT INTO orders
    (customerId, customerName, service, item, quantity, orderDate, deliveryDate, total, paymentStatus, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const orders = [
    [0, "Washing", "Shirt", 5, "2026-10-06", "2026-10-08", 150, "Paid", "Received"],
    [1, "Wash & Iron", "Saree", 2, "2026-10-07", "2026-10-09", 240, "Pending", "Washing"],
    [2, "Ironing", "Trousers", 3, "2026-10-08", "2026-10-09", 90, "Partially Paid", "Ironing"],
    [0, "Washing", "Bedsheet", 2, "2026-10-08", "2026-10-10", 160, "Paid", "Ready"]
  ];

  if (db.prepare("SELECT COUNT(*) AS count FROM orders").get().count === 0) {
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'orders'").run();
  }

  for (const order of orders) {
    insertOrder.run(
      customerIds[order[0]],
      customers[order[0]][0],
      ...order.slice(1)
    );
  }

  console.log("Demo customers and orders added successfully.");
});

try {
  seed();
} catch (error) {
  console.error("Seeding failed:", error.message);
} finally {
  db.close();
}