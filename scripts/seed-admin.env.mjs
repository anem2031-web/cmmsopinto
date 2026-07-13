/**
 * Seed Admin Script
 * Required environment variable: ADMIN_SEED_PASSWORD
 * This variable must be set before running this script.
 * Never hardcode passwords — use environment variables only.
 */
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function seedAdmin() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error("DATABASE_URL not set"); process.exit(1); }

  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!password) {
    console.error("ADMIN_SEED_PASSWORD environment variable is required but not set.");
    process.exit(1);
  }

  const connection = await mysql.createConnection(dbUrl);

  const username = "admin";
  const hash = await bcrypt.hash(password, 10);
  const openId = `local_admin_seed`;
  const name = "مدير النظام";

  // Check if admin already exists
  const [rows] = await connection.execute("SELECT id FROM users WHERE username = ?", [username]);
  if (Array.isArray(rows) && rows.length > 0) {
    // Update password hash
    await connection.execute("UPDATE users SET passwordHash = ?, name = ? WHERE username = ?", [hash, name, username]);
    console.log("Admin user updated successfully");
  } else {
    await connection.execute(
      "INSERT INTO users (openId, username, passwordHash, name, role, loginMethod, isActive, lastSignedIn, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())",
      [openId, username, hash, name, "owner", "local", true]
    );
    console.log("Admin user created successfully");
  }

  console.log(`Username: ${username}`);
  // SECURITY: Do NOT log the password value — only confirm it was set
  console.log("Password: [set from ADMIN_SEED_PASSWORD env variable]");

  await connection.end();
}

seedAdmin().catch(err => { console.error(err); process.exit(1); });
