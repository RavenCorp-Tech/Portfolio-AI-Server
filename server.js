// ===============================
// 1. SETUP
// ===============================
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();
const port = process.env.PORT || 8080;

// ===============================
// CONVERSATION MEMORY (IN-MEMORY)
// ===============================
const conversationMemory = new Map();
const MAX_MEMORY_MESSAGES = 6;

// ===============================
// 2. BOOT LOGGING
// ===============================
console.log("=================================");
console.log("RAVEN SERVER BOOT SEQUENCE START");
console.log("NODE VERSION:", process.version);
console.log("PORT:", port);
console.log("=================================");

// ===============================
// 3. STATIC, CORS & BODY
// ===============================

// Serve admin UI
app.use("/admin", express.static(path.join(__dirname, "admin")));

// ✅ SAFE CORS (chat does NOT use cookies)
app.use(cors({
  origin: "*"
}));

app.use(express.json({ limit: "1mb" }));

// ===============================
// 4. HEALTH CHECK
// ===============================
app.get("/", (req, res) => {
  res.status(200).send(`
    <h1>Raven Server is Running</h1>
    <p>Status: Online</p>
    <p>Time: ${new Date().toISOString()}</p>
    <p>Node: ${process.version}</p>
  `);
});

// ===============================
// 5. AI SERVICES INIT
// ===============================
let embeddingModel = null;
let openai = null;

try {
  if (process.env.GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    embeddingModel = genAI.getGenerativeModel({
      model: "text-embedding-004"
    });
    console.log("Gemini embedding model ready");
  } else {
    console.warn("WARNING: GEMINI_API_KEY not set");
  }

  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://www.ravencorp.tech",
        "X-Title": "RavenCorp AI Assistant"
      }
    });
    console.log("OpenRouter OpenAI client ready");
  } else {
    console.warn("WARNING: OPENAI_API_KEY not set");
  }

} catch (err) {
  console.error("AI INIT FAILURE:", err);
}

// ===============================
// 6. DATABASE LOAD
// ===============================
let vectorDatabase = [];

try {
  const dbPath = path.join(__dirname, "vector-database.json");
  if (fs.existsSync(dbPath)) {
    vectorDatabase = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    console.log(`Vector DB loaded: ${vectorDatabase.length} entries`);
  }
} catch (err) {
  console.error("DB LOAD ERROR:", err);
}

// ===============================
// 7. CHAT ENDPOINT (NO SESSIONS)
// ===============================
app.post("/api/chat", async (req, res) => {
  const sessionId = req.headers["x-session-id"] || req.ip;

  try {
    if (!openai) {
      console.error("Chat blocked: OpenAI client missing");
      return res.status(500).json({ error: "AI not initialized" });
    }

    const userQuery = req.body?.question;
    if (!userQuery) {
      return res.status(400).json({ error: "Missing question" });
    }

    let history = conversationMemory.get(sessionId) || [];
    let context = "";

    // Vector search
    if (embeddingModel && vectorDatabase.length > 0) {
      const embedResult = await embeddingModel.embedContent(userQuery);
      const qv = embedResult.embedding.values;

      context = vectorDatabase
        .map(e => {
          let dot = 0, na = 0, nb = 0;
          for (let i = 0; i < qv.length; i++) {
            dot += qv[i] * e.embedding[i];
            na += qv[i] ** 2;
            nb += e.embedding[i] ** 2;
          }
          return { text: e.text, score: dot / (Math.sqrt(na) * Math.sqrt(nb)) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(r => r.text)
        .join("\n\n");
    }

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-5.2",
      messages: [
        {
          role: "system",
          content:
            "You are Raven, an AI assistant for Adil Hasan’s portfolio. " +
            "Use the provided context only if relevant.\n\n" + context
        },
        ...history,
        { role: "user", content: userQuery }
      ],
      temperature: 0.7,
      max_tokens: 600
    });

    const reply = completion.choices[0].message.content;

    history.push({ role: "user", content: userQuery });
    history.push({ role: "assistant", content: reply });
    conversationMemory.set(
      sessionId,
      history.slice(-MAX_MEMORY_MESSAGES)
    );

    res.json({ answer: reply });

  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "AI service error" });
  }
});

// ===============================
// 8. ADMIN SESSION (ISOLATED)
// ===============================
app.set("trust proxy", 1);

app.use("/api/admin", session({
  name: "raven_admin",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "strict"
  }
}));

function requireAdmin(req, res, next) {
  if (req.session?.admin === true) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ===============================
// ADMIN LOGIN / LOGOUT
// ===============================
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  if (username !== process.env.ADMIN_USERNAME) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(
    password,
    process.env.ADMIN_PASSWORD_HASH
  );

  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.admin = true;
  res.json({ status: "Logged in" });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ status: "Logged out" });
  });
});

// ===============================
// ADMIN INGEST
// ===============================
app.post("/api/admin/ingest", requireAdmin, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Missing text" });

  const embed = await embeddingModel.embedContent(text);

  vectorDatabase.push({
    id: `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text,
    embedding: embed.embedding.values,
    createdAt: new Date().toISOString()
  });

  fs.writeFileSync(
    path.join(__dirname, "vector-database.json"),
    JSON.stringify(vectorDatabase, null, 2)
  );

  res.json({ status: "Saved", totalEntries: vectorDatabase.length });
});

// ===============================
// ADMIN MEMORY VIEWER
// ===============================
app.get("/api/admin/memory", requireAdmin, (req, res) => {
  const conversations = {};
  for (const [k, v] of conversationMemory.entries()) {
    conversations[k] = v;
  }
  res.json({
    knowledgeEntries: vectorDatabase.length,
    conversations
  });
});

// ===============================
// ADMIN KNOWLEDGE CRUD
// ===============================
app.get("/api/admin/knowledge", requireAdmin, (req, res) => {
  res.json(vectorDatabase);
});

app.delete("/api/admin/knowledge/:id", requireAdmin, (req, res) => {
  vectorDatabase = vectorDatabase.filter(e => e.id !== req.params.id);

  fs.writeFileSync(
    path.join(__dirname, "vector-database.json"),
    JSON.stringify(vectorDatabase, null, 2)
  );

  res.json({ status: "Deleted" });
});

app.put("/api/admin/knowledge/:id", requireAdmin, async (req, res) => {
  const entry = vectorDatabase.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Not found" });

  const embed = await embeddingModel.embedContent(req.body.text);
  entry.text = req.body.text;
  entry.embedding = embed.embedding.values;
  entry.updatedAt = new Date().toISOString();

  fs.writeFileSync(
    path.join(__dirname, "vector-database.json"),
    JSON.stringify(vectorDatabase, null, 2)
  );

  res.json({ status: "Updated" });
});

// ===============================
// 9. START SERVER
// ===============================
app.listen(port, () => {
  console.log("=================================");
  console.log("SERVER LISTENING SUCCESSFULLY");
  console.log("PORT:", port);
  console.log("=================================");
});
