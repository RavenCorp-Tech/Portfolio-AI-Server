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
  // ---- Gemini Embeddings ----
  if (!process.env.GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY not set");
  } else {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    embeddingModel = genAI.getGenerativeModel({
      model: "text-embedding-004"
    });
    console.log("Gemini embedding model ready");
  }

  // ---- OpenRouter (GPT-5.2) ----
  if (!process.env.OPENAI_API_KEY) {
    console.warn("WARNING: OPENAI_API_KEY not set");
  } else {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://www.ravencorp.tech",
        "X-Title": "RavenCorp AI Assistant"
      }
    });
    console.log("OpenRouter OpenAI client ready");
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
    const raw = fs.readFileSync(dbPath, "utf8");
    vectorDatabase = JSON.parse(raw);
    console.log(`Vector DB loaded: ${vectorDatabase.length} entries`);
  } else {
    console.warn("vector-database.json NOT FOUND");
  }
} catch (err) {
  console.error("DB LOAD ERROR (continuing without DB):", err);
  vectorDatabase = [];
}

// ===============================
// 7. CHAT ENDPOINT
// ===============================
app.post("/api/chat", async (req, res) => {
  console.log("POST /api/chat");

  try {
    if (!openai) {
      return res.status(500).json({ error: "AI client not initialized" });
    }

    const userQuery = req.body?.question;
    if (!userQuery) {
      return res.status(400).json({ error: "Missing question" });
    }

    let context = "";

    // ---- Vector Search ----
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

    // ---- GPT-5.2 via OpenRouter ----
    const completion = await openai.chat.completions.create({
      model: "openai/gpt-5.2",
      messages: [
        {
          role: "system",
          content: "You are Raven, an AI assistant for Adil Hasan’s portfolio. Use the provided context only if relevant.\n\n" + context
        },
        { role: "user", content: userQuery }
      ],
      temperature: 0.7,
      max_tokens: 600
    });

    res.json({
      answer: completion.choices[0].message.content
    });

  } catch (err) {
    console.error("CHAT HANDLER ERROR:", err);

    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid OpenRouter API key" });
    }

    if (err.status === 429) {
      return res.status(429).json({ error: "AI is busy. Please try again shortly." });
    }

    res.status(500).json({
      error: "AI service error"
    });
  }
});

// ===============================
// ADMIN-ONLY INGESTION ENDPOINT
// ===============================
app.post("/api/admin/ingest", async (req, res) => {
  try {
    // 1) Verify admin secret
    const secret = req.headers["x-admin-secret"];
    if (secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // 2) Validate input
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid text" });
    }

    if (!embeddingModel) {
      return res.status(500).json({ error: "Embedding model not available" });
    }

    // 3) Create embedding
    const embed = await embeddingModel.embedContent(text);

    // 4) Append to in-memory DB
    vectorDatabase.push({
      text,
      embedding: embed.embedding.values
    });

    // 5) Persist to disk (same format you already use)
    const dbPath = path.join(__dirname, "vector-database.json");
    fs.writeFileSync(dbPath, JSON.stringify(vectorDatabase, null, 2));

    // 6) Respond
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
// 8. START SERVER
// ===============================
app.listen(port, () => {
  console.log("=================================");
  console.log("SERVER LISTENING SUCCESSFULLY");
  console.log("PORT:", port);
  console.log("=================================");
});
