// --- 1. SETUP ---
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// --- 2. LOGGING ---
// Force logs to show up in Azure Stream
console.log("--- SERVER STARTING UP ---");

// --- 3. CORS ---
app.use(cors({
  origin: true, // Allow all origins temporarily for debugging
  credentials: true
}));
app.use(express.json());

// --- 4. HEALTH CHECK (NEW) ---
// This lets you visit the URL in your browser to see if Node is working
app.get("/", (req, res) => {
  res.send(`
    <h1>Raven Server is Running!</h1>
    <p>Status: Online</p>
    <p>Time: ${new Date().toISOString()}</p>
  `);
});

// --- 5. AI CONFIG ---
// Safe Mode: Using standard models to prevent crashes
try {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "missing-key");
  var embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
  
  var openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "missing-key",
  });
  console.log("AI Services Initialized.");
} catch (e) {
  console.error("AI Init Error:", e);
}

// --- 6. DATABASE LOAD ---
let vectorDatabase = [];
try {
  const dbPath = path.join(__dirname, "vector-database.json");
  if (fs.existsSync(dbPath)) {
    const data = fs.readFileSync(dbPath, "utf8");
    vectorDatabase = JSON.parse(data);
    console.log(`Database loaded: ${vectorDatabase.length} entries.`);
  } else {
    console.error("WARNING: vector-database.json not found at " + dbPath);
  }
} catch (err) {
  console.error("FATAL: Database load failed", err);
}

// --- 7. CHAT ENDPOINT ---
app.post("/api/chat", async (req, res) => {
  console.log("Received POST /api/chat"); // Log request
  try {
    const userQuery = req.body.question;
    if (!userQuery) return res.status(400).json({ error: "No question" });

    // 1. Search (Mock if DB empty)
    let context = "";
    if (vectorDatabase.length > 0) {
      const result = await embeddingModel.embedContent(userQuery);
      const queryEmbedding = result.embedding.values;
      // ... (Simple cosine sim) ...
      const chunks = vectorDatabase.map(chunk => {
        let dot = 0.0, nA = 0.0, nB = 0.0;
        for (let i = 0; i < queryEmbedding.length; i++) {
            dot += queryEmbedding[i] * chunk.embedding[i];
            nA += queryEmbedding[i] ** 2;
            nB += chunk.embedding[i] ** 2;
        }
        return { text: chunk.text, score: dot / (Math.sqrt(nA) * Math.sqrt(nB)) };
      }).sort((a, b) => b.score - a.score).slice(0, 3);
      context = chunks.map(c => c.text).join("\n\n");
    }

    // 2. Generate
    // Using gpt-4o to guarantee it works. Change to 5.2 LATER once stable.
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", 
      messages: [
        { role: "system", content: "You are an assistant. Context: " + context },
        { role: "user", content: userQuery }
      ],
    });

    res.json({ answer: completion.choices[0].message.content });

  } catch (error) {
    console.error("CHAT CRASH:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});