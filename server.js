// --- 1. SETUP ---
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3000;

// --- 2. BOOT LOGGING ---
console.log("=================================");
console.log("RAVEN SERVER BOOT SEQUENCE START");
console.log("NODE VERSION:", process.version);
console.log("PORT:", port);
console.log("=================================");

// --- 3. CORS & BODY ---
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

// --- 4. HEALTH CHECK ---
app.get("/", (req, res) => {
  res.status(200).send(`
    <h1>Raven Server is Running</h1>
    <p>Status: Online</p>
    <p>Time: ${new Date().toISOString()}</p>
    <p>Node: ${process.version}</p>
  `);
});

// --- 5. AI SERVICES (SAFE INIT) ---
let embeddingModel = null;
let openai = null;

try {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY not set");
  } else {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    embeddingModel = genAI.getGenerativeModel({
      model: "text-embedding-004"
    });
    console.log("Gemini embedding model ready");
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("WARNING: OPENAI_API_KEY not set");
  } else {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    console.log("OpenAI client ready");
  }
} catch (err) {
  console.error("AI INIT FAILURE (non-fatal):", err);
}

// --- 6. DATABASE LOAD ---
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

// --- 7. CHAT ENDPOINT ---
app.post("/api/chat", async (req, res) => {
  console.log("POST /api/chat");

  try {
    if (!openai) {
      return res.status(500).json({
        error: "OpenAI client not initialized"
      });
    }

    const userQuery = req.body?.question;
    if (!userQuery) {
      return res.status(400).json({ error: "Missing question" });
    }

    let context = "";

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

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Use the following context if relevant:\n" + context },
        { role: "user", content: userQuery }
      ]
    });

    res.json({
      answer: completion.choices[0].message.content
    });

  } catch (err) {
    console.error("CHAT HANDLER ERROR:", err);
    res.status(500).json({
      error: err.message
    });
  }
});

// --- 8. START SERVER ---
app.listen(port, () => {
  console.log("=================================");
  console.log("SERVER LISTENING SUCCESSFULLY");
  console.log("PORT:", port);
  console.log("=================================");
});
