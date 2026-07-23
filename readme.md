# AI Ticket Automation Platform

An event-driven customer support ticketing system with a hybrid AI pipeline: local zero-shot
classification, a fine-tuned priority model, semantic retrieval over past resolutions
(Qdrant), and confidence-gated local LLM generation (Ollama) for tickets with no strong
historical match.

---

## Live Demo

**Deployed app:** 

> **Note:** The free-tier hosting credits used for the AI model deployment (Ollama) have
> expired. Run the project locally (see [Setup](#setup)) to exercise
> the full pipeline including generation.

---

## Table of Contents
- [Live Demo](#live-demo)
- [Architecture Overview](#architecture-overview)
- [Sequence Diagrams](#sequence-diagrams)
- [Tech Stack](#tech-stack)
- [Core Feature: Tiered Retrieval + Generation](#core-feature-tiered-retrieval--generation)
- [Roles & Access Control](#roles--access-control)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Screenshots](#screenshots)
- [Known Limitations](#known-limitations)

---

## Architecture Overview

![Architecture Overview](./diagrams/00-overall-architecture-flow.svg)

Full processing is decoupled from the HTTP request/response cycle — ticket creation returns
in milliseconds; classification, retrieval, and generation happen asynchronously via Inngest.

---

## Sequence Diagrams

The three flows below cover the system end to end. Source definitions live in
[`sequence-diagrams.md`](./sequence-diagrams.md) (Mermaid) — the rendered images are in
[`diagrams/`](./diagrams).

### 1. Ticket Creation → AI Classification → Tiered Response
Covers the full asynchronous pipeline: ticket save, parallel classification + similarity
search, the duplicate / augmented / cold tier branch, and the notification fan-out.

![Ticket Creation → AI Classification → Tiered Response](./diagrams/01-ticket-creation-classification-flow.svg)

### 2. Ticket Resolution → Feeding the Knowledge Base
Covers how a moderator's resolution note is embedded and written back into Qdrant so it can
be surfaced for the next similar ticket.

![Ticket Resolution → Feeding the Knowledge Base](./diagrams/02-ticket-resolution-knowledge-base-flow.svg)

### 3. Signup → OTP Verification → Login
Covers account creation, email OTP verification, and JWT-based login.

![Signup → OTP Verification → Login](./diagrams/03-signup-otp-login-flow.svg)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Database | MongoDB (Mongoose) |
| Background jobs / event orchestration | Inngest |
| Vector search | Qdrant |
| Classification | `@xenova/transformers` — zero-shot NLI (`distilbert-base-uncased-mnli`) for ticket type & department |
| Priority scoring | Custom fine-tuned RoBERTa model, exported to ONNX, run via `onnxruntime-node` (with a keyword rule-engine fallback) |
| Embeddings | `Xenova/all-MiniLM-L6-v2` (384-dim, mean-pooled, normalized) |
| Generation | Local LLM via Ollama (`qwen2.5:3b-instruct-q4_K_M`), grounded with retrieved context when available |
| Auth | JWT + OTP email verification (bcrypt-hashed passwords) |
| Frontend | React (Vite), role-based views (user / moderator / admin) |
| Email | Nodemailer (Gmail SMTP) |

---

## Core Feature: Tiered Retrieval + Generation

Every new ticket is compared against past resolved tickets in Qdrant. The top match's
similarity score decides how the system responds:

| Similarity | Tier | Behavior |
|---|---|---|
| ≥ 0.92 | **Duplicate** | Reuses the matched ticket's resolution directly. LLM is skipped entirely (cost/latency saving). "Helpful Notes" shown to a moderator are only ever populated from a real, human-resolved past ticket — never from bootstrap/seed data. |
| 0.5 – 0.92 | **Augmented** | All matches scoring ≥ 0.6 are gathered as multi-document context and passed to the LLM, which drafts a grounded, tailored response. |
| < 0.5 | **Cold** | No relevant history. The LLM responds using general support best practices, with no retrieved context. |

This tiering is deliberately biased toward precision on the duplicate boundary: a false
"duplicate" match would skip both the LLM and any human review, which is the costliest
failure mode in the pipeline — so the threshold favors being confident rather than being
maximally inclusive.

Every classification run records lightweight metrics (`aiMetrics` on the `Ticket` document):
top match score, tier, whether the LLM was called, its latency, and whether it failed. These
are aggregated by `scripts/aiMetricsReport.js` for a quick summary of retrieval/generation
health — no separate dashboard required.

---

## Roles & Access Control

| Role | Can do |
|---|---|
| **User** | Create tickets, view their own tickets, view AI-generated guidance and resolution status. Cannot see internal resolution notes or moderator-only helpful notes. |
| **Moderator** | View tickets assigned to them, resolve tickets, see helpful notes and AI draft context. Cannot create tickets. |
| **Admin** | Full visibility across all tickets and users, can update user roles/departments. Cannot create tickets. |

Authorization is enforced at the database query level (field-level `.select()` differs per
role, not just hidden in the UI) as well as in the frontend.

---

## Project Structure

```
ai-ticket-assistant/
├── controllers/          # Express route handlers (user, ticket)
├── middlewares/          # JWT authentication
├── models/                # Mongoose schemas (User, Ticket)
├── routes/                 # Express route definitions
├── inngest/
│   ├── client.js
│   └── functions/         # on-signup, on-ticket-create, on-ticket-resolve, sync-resolved-tickets
├── utils/
│   ├── ai.js               # Classification + priority + embeddings
│   ├── rag.js               # Qdrant read/write (retrieval + storage)
│   ├── llmService.js        # Ollama generation
│   └── mailer.js            # Email sending
├── scripts/
│   ├── seedQdrant.js         # One-time bulk loader from a CSV dataset
│   └── aiMetricsReport.js    # Aggregated retrieval/generation health report
└── index.js

ai-ticket-frontend/
└── src/
    ├── pages/               # login, signup, tickets, ticket detail, admin
    └── components/          # navbar, auth guard, resolution form

diagrams/                    # Rendered sequence diagram images used in this README
screenshots/                 # Product screenshots used in this README
```

---

## Setup

```bash
# Backend
cd ai-ticket-assistant
npm install
cp .env.example .env   # fill in the values below
npm run dev

# In a separate terminal — local LLM
ollama serve
ollama pull qwen2.5:3b-instruct-q4_K_M

# Frontend
cd ai-ticket-frontend
npm install
npm run dev
```

The server checks Ollama's reachability at startup and logs a warning (not a hard failure)
if it's unreachable — the system degrades to retrieval-only responses in that case.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | JWT signing secret |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Outbound email (Nodemailer/Gmail SMTP) |
| `QDRANT_URL` / `QDRANT_API_KEY` | Vector database connection |
| `OLLAMA_URL` | Local LLM server (defaults to `http://localhost:11434`) |
| `OLLAMA_MODEL` | Model name (defaults to `qwen2.5:3b-instruct-q4_K_M`) |
| `APP_URL` | Frontend origin, for CORS |
| `PRIORITY_MODEL_DIR` | Path to the fine-tuned ONNX priority model |

---

## 📸 Screenshots

The following screenshots demonstrate the complete workflow of the AI Ticket Assistant, covering the customer experience, moderator workflow, AI-assisted resolution process, and administrator dashboard.

### 1. Customer – Ticket Creation
**File:** `ScreenShots/User_1.png`

The SignUp Page

![Customer Ticket Creation](./ScreenShots/User_1.png)

---

### 2. Customer – Ticket Confirmation
**File:** `ScreenShots/User_2.png`

Customer portal showing all submitted tickets along with their current status, assigned priority, and latest updates.


![Ticket Confirmation](./ScreenShots/User_2.png)

---

### 3. Customer – Ticket Status
**File:** `ScreenShots/User_3.png`

Confirmation page displayed immediately after ticket submission. The customer receives a ticket ID while AI-based categorization, duplicate detection, and knowledge retrieval continue in the background.

![Customer Dashboard](./ScreenShots/User_3.png)

---

### 4. Moderator – Assigned Tickets
**File:** `ScreenShots/Moderator_1.png`

Moderator dashboard displaying tickets assigned to the moderator. It provides quick visibility into ticket priority, department, status, and enables moderators to review individual requests.

![Moderator Dashboard](./ScreenShots/Moderator_1.png)

---

### 5. AI Resolution & Helpful Notes
**File:** `ScreenShots/HelpFulNotes_1.png`

Detailed ticket view where the AI-generated response is presented alongside internal resolution notes retrieved from similar historical tickets. This demonstrates the Retrieval-Augmented Generation (RAG) workflow used to assist moderators in resolving tickets faster while maintaining consistency.

![Helpful Notes](./ScreenShots/HelpFulNotes_1.png)

---

### 6. Admin Dashboard – Overview
**File:** `ScreenShots/Admin_1.png`

Administrative dashboard providing a global view of tickets, users, departments, and overall system activity.

![Admin Dashboard](./ScreenShots/Admin_1.png)

---

### 7. Admin – User & Department Management
**File:** `ScreenShots/Admin_2.png`

Interface for managing users, assigning roles, and configuring departments responsible for handling support tickets.

![Admin User Management](./ScreenShots/Admin_2.png)

---

### 8. Admin – Analytics & Monitoring
**File:** `ScreenShots/Admin_3.png`

Administrative analytics page displaying ticket distribution, processing statistics, and overall system performance to assist with operational monitoring.

![Admin Analytics](./ScreenShots/Admin_3.png)
---

## Known Limitations

Documented deliberately, for transparency:

- No offline evaluation harness for retrieval quality — the 0.5 / 0.92 thresholds are
  heuristic starting points, not yet validated against labeled duplicate/non-duplicate pairs.
- Moderator load balancing (`ticketsAssignedCount`) only increments; it is not decremented on
  reassignment or deletion, so accuracy drifts over long-running deployments.
- `resolutionNote` has no quality gate before being stored for future retrieval — an
  incorrect resolution, once written, can be resurfaced indefinitely.
- Ticket assignment can fail (e.g., transient DB issues) and currently has no automatic
  re-assignment path beyond the nightly sync job.
- Real-time storage into Qdrant is fire-and-forget; failures are caught and logged, with
  the nightly `sync-resolved-tickets.js` job as the reconciliation backstop.
