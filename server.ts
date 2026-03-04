import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const app = express();
const PORT = 3000;

app.use(express.json());

// Setup Database
const dbDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}
const db = new Database(path.join(dbDir, "bahdinan.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`);

// API Routes
app.get("/api/conversations", (req, res) => {
  const stmt = db.prepare("SELECT * FROM conversations ORDER BY created_at DESC");
  const conversations = stmt.all();
  res.json(conversations);
});

app.post("/api/conversations", (req, res) => {
  const { title } = req.body;
  const stmt = db.prepare("INSERT INTO conversations (title) VALUES (?)");
  const info = stmt.run(title || "New Conversation");
  res.json({ id: info.lastInsertRowid, title: title || "New Conversation" });
});

app.delete("/api/conversations/:id", (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare("DELETE FROM conversations WHERE id = ?");
  stmt.run(id);
  res.json({ success: true });
});

app.get("/api/conversations/:id/messages", (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
  const messages = stmt.all();
  res.json(messages);
});

app.post("/api/conversations/:id/messages", (req, res) => {
  const { id } = req.params;
  const { role, content } = req.body;
  const stmt = db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)");
  const info = stmt.run(id, role, content);
  res.json({ id: info.lastInsertRowid, conversation_id: id, role, content });
});

// Export all data
app.get("/api/export/data", (req, res) => {
  const convStmt = db.prepare("SELECT * FROM conversations ORDER BY created_at ASC");
  const conversations = convStmt.all();
  
  const msgStmt = db.prepare("SELECT * FROM messages ORDER BY conversation_id ASC, created_at ASC");
  const messages = msgStmt.all();
  
  res.json({ conversations, messages });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
