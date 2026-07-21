# Sequence Diagrams

Three flows only — the ones that cover the entire system end to end. Paste these into any
Mermaid-compatible renderer (GitHub markdown, Mermaid Live Editor, Notion, etc.) to generate
the images, or add exported PNGs directly into the README's screenshot placeholders.

---

## 1. Ticket Creation → AI Classification → Tiered Response

```mermaid
sequenceDiagram
    actor Customer
    participant API as Express API
    participant DB as MongoDB
    participant Inngest
    participant AI as Classifier (zero-shot + RoBERTa)
    participant Qdrant
    participant LLM as Ollama

    Customer->>API: POST /api/tickets
    API->>DB: Ticket.create()
    API->>Inngest: send("ticket/created")
    API-->>Customer: 201 Created (immediate)

    Inngest->>DB: fetch-ticket, fetch-creator
    par AI classification
        Inngest->>AI: classifyTicket()
    and Similarity search
        Inngest->>Qdrant: findSimilarTickets()
    end

    alt score >= 0.92 (duplicate)
        Inngest->>Inngest: reuse matched resolution, skip LLM
    else score 0.5 - 0.92 (augmented)
        Inngest->>LLM: generateResponse(context = top matches)
        LLM-->>Inngest: grounded draft
    else score < 0.5 (cold)
        Inngest->>LLM: generateResponse(context = null)
        LLM-->>Inngest: general draft
    end

    Inngest->>DB: update-ticket-data (status, tier, aiMetrics)
    Inngest->>Customer: confirmation email (tier-appropriate content)
    Inngest->>DB: assign-moderator (department → any moderator → admin)
    Inngest->>Inngest: notify moderator + admin
```

---

## 2. Ticket Resolution → Feeding the Knowledge Base

```mermaid
sequenceDiagram
    actor Moderator
    participant API as Express API
    participant DB as MongoDB
    participant Inngest
    participant Qdrant

    Moderator->>API: PATCH /api/tickets/:id/resolve
    API->>DB: status = RESOLVED, save resolutionNote
    API->>Inngest: send("ticket/resolved")
    API-->>Moderator: 200 OK

    Inngest->>DB: fetch resolved ticket
    alt no resolutionNote
        Inngest->>Inngest: throw NonRetriableError (permanent, no retry)
    else has resolutionNote
        Inngest->>Qdrant: embed(title+description), upsert(payload incl. resolutionNote)
        Qdrant-->>Inngest: stored
    end

    Note over Qdrant: Available for retrieval on the NEXT similar ticket
```

---

## 3. Signup → OTP Verification → Login

```mermaid
sequenceDiagram
    actor User
    participant API as Express API
    participant DB as MongoDB
    participant Mailer

    User->>API: POST /api/auth/signup
    API->>DB: create user (isVerified = false), generate OTP
    API->>Mailer: sendOtpEmail()
    Mailer-->>User: OTP email

    User->>API: POST /api/auth/verify-email {otp}
    API->>DB: check OTP + expiry
    API->>DB: isVerified = true

    User->>API: POST /api/auth/login
    API->>DB: verify password (bcrypt)
    API-->>User: JWT { _id, role }
```
