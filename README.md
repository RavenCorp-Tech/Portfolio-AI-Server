# Portfolio-AI-Server
# Raven AI Assistant (Backend)

**A production-ready, RAG-powered portfolio assistant deployed on Microsoft Azure.**

## 📌 Abstract
Raven AI is a specialized Q&A assistant designed to provide grounded, context-aware answers about my professional skills, projects, and experience. Unlike generic chatbots, Raven uses a **Retrieval-Augmented Generation (RAG)** pipeline to anchor its responses in a custom knowledge base derived from my portfolio data, virtually eliminating hallucinations on domain-specific queries.

The project implements a **lightweight, custom RAG architecture** built from first principles using Node.js and Google's Gemini API. By bypassing heavy orchestration frameworks in favor of a custom vector search implementation, the system achieves low-latency retrieval and high explainability.

## 🚀 Key Features
* **Custom RAG Pipeline:** Built without heavy frameworks (like LangChain) for maximum control and performance.
* **Hybrid Routing Logic:** Intelligently switches between "Strict RAG" (for portfolio questions) and "General LLM" (for chit-chat).
* **Vector Search:** Implements custom Cosine Similarity algorithms for precise context retrieval.
* **Live Deployment:** Fully productionized on Microsoft Azure App Service.

## 🛠️ Methodology & Architecture

This project implements a full-stack RAG pipeline without relying on heavy abstraction layers, demonstrating mastery of the core agentic AI concepts:

### 1. Knowledge Ingestion & Embedding
* **Source Data:** Raw text is extracted from my portfolio (About, Projects, Skills).
* **Chunking:** Content is segmented into logical "knowledge chunks."
* **Embeddings:** Each chunk is converted into high-dimensional vectors using **Google's `text-embedding-004`** model via a custom ingestion script.
* **Vector Store:** A highly optimized, in-memory JSON-based vector store (`vector-database.json`) ensures sub-millisecond access times.

### 2. Retrieval Mechanism (The "R" in RAG)
* **Query Processing:** User queries are embedded on-the-fly.
* **Similarity Search:** A custom **Cosine Similarity** algorithm scans the vector store to identify the top 3 most relevant knowledge chunks.

### 3. Augmented Generation (The "AG" in RAG)
* **Context Injection:** Retrieved chunks are injected into a system prompt with strict grounding rules.
* **LLM Inference:** The augmented prompt is sent to **Google Gemini 2.5 Pro**, which synthesizes the final answer.

## 💻 Tech Stack
* **Runtime:** Node.js (v20 LTS)
* **Framework:** Express.js
* **AI Model:** Google Gemini API (`gemini-2.5-pro`)
* **Embeddings:** Google `text-embedding-004`
* **Hosting:** Microsoft Azure App Service (Windows)

---

## ⚙️ Setup Instructions (Run Locally)

If you want to run this backend server on your local machine, follow these steps:

### 1. Prerequisites
* Node.js installed (v18 or higher recommended).
* A Google Gemini API Key.

### 2. Clone the Repository
```
git clone [https://github.com/RavenCorp-Tech/Portfolio-AI-Server.git](https://github.com/RavenCorp-Tech/Portfolio-AI-Server.git)
cd Portfolio-AI-Server
```

### 3. Install Dependencies
```
npm install
```

### 4. Configure Environment Variables
Create a .env file in the root directory and add your API key:

> GEMINI_API_KEY=your_actual_api_key_here
> PORT=3000

### 5. Run the Server
```
npm start
```

You should see:

> Vector database loaded successfully. ✅ Server is running at http://localhost:3000

### 6. Test the API
You can test the endpoint using curl or Postman:
```
curl -X POST http://localhost:3000/api/chat \
     -H "Content-Type: application/json" \
     -d '{"question": "What is Adil working on?"}'
```

## 📸 Screenshots
![Chatbot Demo]<img width="1900" height="915" alt="Screenshot 2025-12-05 004502" src="https://github.com/user-attachments/assets/c7a53048-7228-452d-b58f-1e8ffaa960fc" />

## 📄 License
This project is open-source and available under the ISC License.
