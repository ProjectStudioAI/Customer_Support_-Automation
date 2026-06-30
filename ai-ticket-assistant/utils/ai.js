import { pipeline, AutoTokenizer } from "@xenova/transformers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TICKET_TYPES = ["Incident", "Request", "Problem", "Change"];

const DEPARTMENTS = [
  "Technical Support",
  "Billing",
  "Account Management",
  "Returns and Exchanges",
  "General Enquiry",
  "Security",
  "Network Operations",
  "Software Support",
];

const PRIORITY_LABELS = ["low", "medium", "high"];

const PRIORITY_MODEL_DIR = path.join(__dirname, "../models/priority_model_onnx");
const PRIORITY_MODEL_PATH = path.join(PRIORITY_MODEL_DIR, "model.onnx");

let _classifier = null;
let _embedder = null;
let _prioritySession = null;
let _priorityTokenizer = null;
let _ort = null;
let _priorityDisabled = false;

async function getClassifier() {
  if (!_classifier) {
    console.log("Loading NLI classifier (first load ~15s)...");
    _classifier = await pipeline(
      "zero-shot-classification",
      "Xenova/nli-MiniLM-L2-mnli"
    );
    console.log("Classifier ready");
  }
  return _classifier;
}

export async function getEmbedder() {
  if (!_embedder) {
    console.log("Loading embedding model (first load ~10s)...");
    _embedder = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    console.log("Embedder ready");
  }
  return _embedder;
}

async function getPriorityModel() {
  if (_priorityDisabled) {
    throw new Error("Priority ONNX model unavailable");
  }

  if (!fs.existsSync(PRIORITY_MODEL_PATH)) {
    _priorityDisabled = true;
    throw new Error(
      `Priority model not found at ${PRIORITY_MODEL_PATH} — using rule-engine fallback`
    );
  }

  if (!_prioritySession) {
    try {
      _ort = await import("onnxruntime-node");
      console.log("Loading DistilBERT priority model...");
      _prioritySession = await _ort.InferenceSession.create(PRIORITY_MODEL_PATH);
      _priorityTokenizer = await AutoTokenizer.from_pretrained(PRIORITY_MODEL_DIR);
      console.log("Priority model ready");
    } catch (err) {
      _priorityDisabled = true;
      _prioritySession = null;
      _priorityTokenizer = null;
      _ort = null;
      throw err;
    }
  }

  return { session: _prioritySession, tokenizer: _priorityTokenizer, ort: _ort };
}

function fallbackPriority(title, description) {
  const text = (title + " " + description).toLowerCase();
  if (
    ["offline", "down", "outage", "blocked", "cannot access", "urgent", "critical", "locked out", "disruption"].some(
      (w) => text.includes(w)
    )
  ) {
    return "high";
  }
  if (
    ["query", "question", "information", "interested", "how to", "inquiry", "wondering"].some(
      (w) => text.includes(w)
    )
  ) {
    return "low";
  }
  return "medium";
}

async function scorePriority(title, description) {
  try {
    const { session, tokenizer, ort } = await getPriorityModel();
    const text = `${title} ${description}`.substring(0, 512);

    const encoded = await tokenizer(text, {
      truncation: true,
      max_length: 128,
      padding: "max_length",
      return_tensors: "np",
    });

    const inputIds = encoded.input_ids.data;
    const attentionMask = encoded.attention_mask.data;
    const seqLen = encoded.input_ids.dims[1];

    const feeds = {
      input_ids: new ort.Tensor(
        "int64",
        BigInt64Array.from(Array.from(inputIds).map(BigInt)),
        [1, seqLen]
      ),
      attention_mask: new ort.Tensor(
        "int64",
        BigInt64Array.from(Array.from(attentionMask).map(BigInt)),
        [1, seqLen]
      ),
    };

    const output = await session.run(feeds);
    const logits = Array.from(output.logits.data);

    const maxLogit = Math.max(...logits);
    const expLogits = logits.map((l) => Math.exp(l - maxLogit));
    const sumExp = expLogits.reduce((a, b) => a + b, 0);
    const probs = expLogits.map((e) => e / sumExp);

    const predictedIdx = probs.indexOf(Math.max(...probs));
    const priority = PRIORITY_LABELS[predictedIdx];
    const confidence = (probs[predictedIdx] * 100).toFixed(1);

    console.log(`Priority: ${priority} (${confidence}% confidence)`);
    return priority;
  } catch (err) {
    if (!_priorityDisabled) {
      console.error("DistilBERT priority failed, using fallback:", err.message);
    }
    return fallbackPriority(title, description);
  }
}

export async function embedText(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

const classifyTicket = async (ticket) => {
  try {
    const clf = await getClassifier();
    const text = `${ticket.title} ${ticket.description}`;

    const [typeResult, deptResult, priority] = await Promise.all([
      clf(text, TICKET_TYPES, { multi_label: false }),
      clf(text, DEPARTMENTS, { multi_label: false }),
      scorePriority(ticket.title, ticket.description),
    ]);

    const ticketType = typeResult.labels[0];
    const department = deptResult.labels[0];

    console.log(
      `Classified: Type=${ticketType}, Dept=${department}, Priority=${priority}`
    );
    return { ticketType, department, priority };
  } catch (err) {
    console.error("classifyTicket failed:", err.message);
    return { ticketType: "Request", department: null, priority: "medium" };
  }
};

export default classifyTicket;
