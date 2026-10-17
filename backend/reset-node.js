const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "washflow.db"));

const clear = db.transaction(() => {
  db.prepare("DELETE FROM orders").run();
  db.prepare("DELETE FROM customers").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('orders', 'customers')").run();
});

try {
  clear();
  console.log("All customers and orders deleted. IDs reset to 1.");
} catch (error) {
  console.error("Reset failed:", error.message);
} finally {
  db.close();
}
