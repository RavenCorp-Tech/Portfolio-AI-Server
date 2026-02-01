// ===============================
// 1. SETUP
// ===============================
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

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
// 3. CORS & BODY
// ===============================

// Serve admin UI (private, unlinked)
app.use("/admin", express.static(path.join(__dirname, "admin")));

app.use(cors({
  origin: true,
  credentials: true
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
  // Gemini embeddings
  if (process.env.GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    embeddingModel = genAI.getGenerativeModel({
      model: "text-embedding-004"
    });
    console.log("Gemini embedding model ready");
  } else {
    console.warn("WARNING: GEMINI_API_KEY not set");
  }

  // OpenRouter (GPT-5.2)
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
  console.error("AI INIT FAILURE (non-fatal):", err);
}

// ===============================
// 6. DATABASE LOAD
// ===============================
let vectorDatabase = [];

try {
  const dbPath = path.join(__dirname, "vector-database.json");
  console.log("Loading DB from:", dbPath);

  if (fs.existsSync(dbPath)) {
    vectorDatabase = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    console.log(`Vector DB loaded: ${vectorDatabase.length} entries`);
  } else {
    console.warn("vector-database.json NOT FOUND");
  }
} catch (err) {
  console.error("DB LOAD ERROR:", err);
  vectorDatabase = [];
}

// ===============================
// 7. CHAT ENDPOINT (WITH MEMORY)
// ===============================
app.post("/api/chat", async (req, res) => {
  console.log("POST /api/chat");

  // Identify session (privacy-safe)
  const sessionId = req.headers["x-session-id"] || req.ip;

  try {
    if (!openai) {
      return res.status(500).json({ error: "AI client not initialized" });
    }

    const userQuery = req.body?.question;
    if (!userQuery) {
      return res.status(400).json({ error: "Missing question" });
    }

    let context = "";

    // Load conversation history
    let history = conversationMemory.get(sessionId) || [];

    // Vector search
    if (embeddingModel && vectorDatabase.length > 0) {
      const embedResult = await embeddingModel.embedContent(userQuery);
      const queryEmbedding = embedResult.embedding.values;

      const ranked = vectorDatabase
        .map(chunk => {
          let dot = 0, nA = 0, nB = 0;
          for (let i = 0; i < queryEmbedding.length; i++) {
            dot += queryEmbedding[i] * chunk.embedding[i];
            nA += queryEmbedding[i] ** 2;
            nB += chunk.embedding[i] ** 2;
          }
          return {
            text: chunk.text,
            score: dot / (Math.sqrt(nA) * Math.sqrt(nB))
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      context = ranked.map(r => r.text).join("\n\n");
    }

    // Build messages with conversation memory
    const messages = [
      {
        role: "system",
        content:
          "You are Raven, an AI assistant for Adil Hasan’s portfolio. " +
          "Use the provided context only if relevant.\n\n" +
          context
      },
      ...history,
      { role: "user", content: userQuery }
    ];

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-5.2",
      messages,
      temperature: 0.7,
      max_tokens: 600
    });

    const assistantReply = completion.choices[0].message.content;

    // Save conversation memory
    history.push({ role: "user", content: userQuery });
    history.push({ role: "assistant", content: assistantReply });

    if (history.length > MAX_MEMORY_MESSAGES) {
      history = history.slice(-MAX_MEMORY_MESSAGES);
    }

    conversationMemory.set(sessionId, history);

    res.json({ answer: assistantReply });

  } catch (err) {
    console.error("CHAT HANDLER ERROR:", err);

    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid OpenRouter API key" });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: "AI is busy. Please try again shortly." });
    }

    res.status(500).json({ error: "AI service error" });
  }
});


// ===============================
// ADMIN-ONLY INGESTION ENDPOINT
// ===============================
app.post("/api/admin/ingest", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    if (secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid text" });
    }

    if (!embeddingModel) {
      return res.status(500).json({ error: "Embedding model not available" });
    }

    const embed = await embeddingModel.embedContent(text);

    vectorDatabase.push({
      text,
      embedding: embed.embedding.values
    });

    fs.writeFileSync(
      path.join(__dirname, "vector-database.json"),
      JSON.stringify(vectorDatabase, null, 2)
    );

    res.json({
      status: "Saved",
      totalEntries: vectorDatabase.length
    });

  } catch (err) {
    console.error("ADMIN INGEST ERROR:", err);
    res.status(500).json({ error: "Admin ingest failed" });
  }
});


// ===============================
// ADMIN MEMORY VIEWER (READ-ONLY)
// ===============================
app.get("/api/admin/memory", (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    if (secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Convert Map to object for JSON
    const conversations = {};
    for (const [session, history] of conversationMemory.entries()) {
      conversations[session] = history;
    }

    res.json({
      knowledgeEntries: vectorDatabase.length,
      knowledgeSample: vectorDatabase.slice(0, 5), // show first 5 only
      conversations
    });

  } catch (err) {
    console.error("MEMORY VIEW ERROR:", err);
    res.status(500).json({ error: "Failed to load memory" });
  }
});


// ===============================
// 8. START SERVER
// ===============================
app.listen(port, () => {
  console.log("=================================");
  console.log("SERVER LISTENING SUCCESSFULLY");
  console.log("PORT:", port);
  console.log("=================================");
});
