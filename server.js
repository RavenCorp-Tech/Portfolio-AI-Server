// --- 1. SETUP ---
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path"); // Essential for Azure file loading
const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai"); // NEW: Import OpenAI
const cors = require('cors');

// --- 2. INITIALIZE SERVER ---
const app = express();
const port = process.env.PORT || 3000;

// Fix CORS: Allow your new domain to talk to this server
const corsOptions = {
  origin: [
    'https://ravencorp-tech.github.io',
    'https://www.ravencorp.tech', // My New Domain
    'https://ravencorp.tech'
  ],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// --- 3. CONFIGURE AI ---

// A. Google Gemini (Used ONLY for "Memory" - Embedding Search)
// We keep this so you don't have to rebuild your vector-database.json
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// B. OpenAI GPT-5.2 (Used for "Intelligence" - Answering)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, 
});

// --- 4. DATABASE & SEARCH FUNCTIONS ---
let vectorDatabase = [];

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0, normA = 0.0, normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function findRelevantChunks(userQuery) {
  console.log("Searching memory for:", userQuery);
  // We use Google to "math-ify" the user's question to match your Google-made database
  const result = await embeddingModel.embedContent(userQuery);
  const queryEmbedding = result.embedding.values;

  let similarities = [];
  for (const chunk of vectorDatabase) {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    similarities.push({ id: chunk.id, text: chunk.text, score: similarity });
  }

  similarities.sort((a, b) => b.score - a.score);
  return similarities.slice(0, 3); // Return top 3 matches
}

// --- 5. THE CHAT ENDPOINT (Powered by GPT-5.2) ---
app.post("/api/chat", async (req, res) => {
  try {
    const userQuery = req.body.question;
    if (!userQuery) return res.status(400).json({ error: "No question provided" });

    // Safety check: Is DB loaded?
    if (vectorDatabase.length === 0) {
      return res.status(503).json({ error: "Brain is loading, please wait..." });
    }

    // 1. Search Database
    const top3Chunks = await findRelevantChunks(userQuery);
    const context = top3Chunks.map(chunk => chunk.text).join("\n\n---\n\n");
    const topScore = top3Chunks[0]?.score || 0;
    
    // 2. Build the Prompt
    let systemInstruction;
    if (topScore > 0.45) {
      console.log(`Context found (Score: ${topScore.toFixed(2)}). Using Portfolio Data.`);
      systemInstruction = `
        You are Raven, an AI assistant for Adil Hasan's portfolio.
        Answer the user's question using the CONTEXT provided below.
        
        CONTEXT FROM DATABASE:
        ${context}
      `;
    } else {
      console.log("No relevant context found. Using General Knowledge.");
      systemInstruction = `
        You are Raven, an AI assistant for Adil Hasan.
        The user asked a question unrelated to Adil's portfolio details.
        Answer politely and helpfully.
      `;
    }

    // 3. Generate Answer with GPT-5.2
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2", // Using the specific model you requested
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userQuery }
      ],
      temperature: 0.7,
    });

    const answer = completion.choices[0].message.content;
    res.json({ answer: answer });

  } catch (error) {
    // --- DEBUGGING BLOCK ---
    console.error("FULL ERROR DETAILS:", error);
    
    // Check for specific OpenAI errors
    if (error.status === 401) {
      return res.status(500).json({ error: "Auth Error: API Key is invalid or expired." });
    }
    if (error.status === 429) {
      return res.status(500).json({ error: "Billing Error: No credits or rate limit exceeded." });
    }
    
    // Send the ACTUAL error message to the frontend for debugging
    res.status(500).json({ 
      error: `Server Error: ${error.message || "Unknown Error"}`,
      details: JSON.stringify(error)
    });
  }
});

// --- 6. START SERVER (With Crash Fix) ---
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);

  console.log("Loading vector database...");
  try {
    // FIX: Use path.join to find the file RELATIVE to server.js
    // This prevents the "file not found" crash on Azure
    const dbPath = path.join(__dirname, "vector-database.json"); 
    const data = fs.readFileSync(dbPath, "utf8");
    vectorDatabase = JSON.parse(data);
    console.log("✅ Database loaded successfully!");
  } catch (err) {
    console.error("--- FATAL ERROR LOADING DATABASE ---");
    console.error(err);
    console.error("Make sure 'vector-database.json' is deployed.");
  }
});