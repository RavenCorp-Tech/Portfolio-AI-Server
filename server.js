// --- 1. SETUP ---
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require('cors');

// --- 2. INITIALIZE SERVER & AI (BEFORE DB LOAD) ---
const app = express();
const port = 3000;
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const chatModel = genAI.getGenerativeModel({
  model: "gemini-2.5-pro", // Your working model name
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ],
});

// --- 3. CREATE EMPTY DATABASE (will be filled) ---
let vectorDatabase = [];

// --- 4. DEFINE "SEARCH" FUNCTIONS ---
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
  console.log("Finding relevant chunks for:", userQuery);
  const result = await embeddingModel.embedContent(userQuery);
  const queryEmbedding = result.embedding.values;

  let similarities = [];
  for (const chunk of vectorDatabase) {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    similarities.push({ id: chunk.id, text: chunk.text, score: similarity });
  }

  similarities.sort((a, b) => b.score - a.score);
  const top3Chunks = similarities.slice(0, 3);
  
  console.log("Top 3 chunks found:", top3Chunks.map(c => `${c.id} (Score: ${c.score.toFixed(4)})`).join(', '));
  return top3Chunks;
}

// --- 5. THE "CHAT" API ENDPOINT ---
app.post("/api/chat", async (req, res) => {
  try {
    const userQuery = req.body.question;
    if (!userQuery) {
      return res.status(400).json({ error: "No question provided" });
    }
    if (vectorDatabase.length === 0) {
      return res.status(500).json({ error: "Server is still loading its brain. Please try again in 30 seconds." });
    }

    const top3Chunks = await findRelevantChunks(userQuery);
    const RELEVANCE_THRESHOLD = 0.5;
    const topChunkScore = top3Chunks[0].score;

    let prompt;
    if (topChunkScore > RELEVANCE_THRESHOLD) {
      console.log("High relevance score. Answering based on portfolio context.");
      const context = top3Chunks.map(chunk => chunk.text).join("\n\n---\n\n");
      prompt = `
        You are Raven... [Your full prompt for portfolio questions]
        CONTEXT:
        ---
        ${context}
        ---
        USER'S QUESTION: ${userQuery}
        YOUR ANSWER:
      `;
    } else {
      console.log("Low relevance score. Answering with general knowledge.");
      prompt = `
        You are Raven... [Your full prompt for general questions]
        USER'S QUESTION: ${userQuery}
        YOUR ANSWER:
      `;
    }

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    res.json({ answer: response.text() });
    
  } catch (error) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- 6. START THE SERVER (FINALLY) ---
app.listen(port, () => {
  // This code will run *after* the server successfully starts
  console.log(`✅ Server is running at http://localhost:${port}`);
  
  // NOW, we will load the database *after* the server is live
  console.log("Loading vector database... this may take a moment.");
  try {
    const data = fs.readFileSync("vector-database.json", "utf8");
    vectorDatabase = JSON.parse(data); // We fill the empty database
    console.log("✅ Vector database loaded successfully!");
  } catch (err) {
    console.error("--- FATAL ERROR LOADING DATABASE ---");
    console.error(err);
    process.exit(1);
  }
})
.on('error', (err) => {
  // This will catch any errors (like port in use, if it ever happens)
  console.error("--- SERVER STARTUP FAILED ---");
  console.error(err);
  process.exit(1);
});