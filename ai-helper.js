/**
 * AI Helper – OpenAI API wrapper
 *
 * ─── MODEL ────────────────────────────────────────────────────────────────
 * Set OPENAI_MODEL in your .env to override.
 * Default: gpt-5.4  (OpenAI flagship as of May 2026)
 *
 * To use a newer model, just update .env:
 *   OPENAI_MODEL=gpt-5.4
 * No code change needed.
 *
 * Full model list: https://platform.openai.com/docs/models
 *
 * ─── NO API KEY ───────────────────────────────────────────────────────────
 * If OPENAI_API_KEY is missing or blank:
 *  • AI_AVAILABLE is set to false
 *  • askAI() returns null instead of crashing
 *  • The Answer Engine will skip AI fields gracefully
 *  • The bot still runs using only the Rule Engine
 *    (salary, notice period, location, yes/no answers still work)
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");

const user = process.env.DALVI_USER || "default";
const configPath = path.join(__dirname, "users", user, "config.json");

let fileApiKey = null;
let fileModel = null;
if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config) {
      if (config.openaiApiKey) fileApiKey = config.openaiApiKey.trim();
      if (config.openaiModel) fileModel = config.openaiModel.trim();
    }
  } catch (err) {}
}

const rawApiKey = (process.env.OPENAI_API_KEY || fileApiKey || "").trim();

/* ── Detect API key availability ──────────────────────────── */
const AI_AVAILABLE = Boolean(
  rawApiKey &&
  rawApiKey !== "" &&
  rawApiKey !== "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
);

/* ── Model selection ──────────────────────────────────────── */
// gpt-5.4 = latest confirmed OpenAI model (May 2026).
// Override via OPENAI_MODEL in .env or the config.
const MODEL = (process.env.OPENAI_MODEL || fileModel || "gpt-5.4").trim();

/* ── Log status once at startup ───────────────────────────── */
if (AI_AVAILABLE) {
  console.log(`🤖  AI enabled — model: ${MODEL}`);
} else {
  console.warn(
    "⚠️  OPENAI_API_KEY not set — AI form answers disabled.\n" +
    "   Copy .env.example → .env and add your key to enable AI.\n" +
    "   Rule-based answers (salary, notice, location, etc.) still work."
  );
}

/* ── Lazy-load OpenAI client (only when key exists) ─────── */
let client = null;
if (AI_AVAILABLE) {
  const OpenAI = require("openai");
  client = new OpenAI({ apiKey: rawApiKey });
}

/**
 * Ask the AI to generate a tailored, professional answer for a
 * single job-application form field.
 *
 * Returns null (instead of throwing) if no API key is configured.
 *
 * @param {Object} opts
 * @param {string} opts.question   – Exact question from the application form
 * @param {string} opts.jd         – Full job description text
 * @param {string} opts.resume     – Candidate's full resume text
 * @param {string} opts.company    – Hiring company name (for personalisation)
 * @param {string} opts.role       – Job role / title
 * @param {string} opts.fieldType  – "text" | "short" | "cover_letter"
 * @param {string} opts.goal       – Candidate's stated application goal
 * @returns {Promise<string|null>} – Generated answer, or null if AI unavailable
 */
async function askAI({ question, jd, resume, company, role, fieldType, goal }) {
  /* ── No key: fail silently ──────────────────────────────── */
  if (!AI_AVAILABLE || !client) {
    return null; // Answer Engine will treat null as "NOT_SURE" → field skipped
  }

  const today = new Date().toLocaleDateString("en-IN", {
    year: "numeric", month: "long", day: "numeric"
  });

  const lengthGuide =
    fieldType === "cover_letter"
      ? "Write a professional cover letter (8–12 sentences, 3 paragraphs). Address it to the Hiring Manager at the specific company."
      : fieldType === "short"
        ? "Keep the answer concise (1–3 sentences or a single value)."
        : fieldType === "numeric"
          ? "Output ONLY a single integer representing the number (digits only, e.g. 12 or 36). Do NOT write any letters, words, units, or punctuation. Just the digits."
          : "Write a focused, professional answer (3–5 sentences).";

  const prompt = `
You are an expert job application assistant helping a candidate apply to a role in May 2026.

════════════════════════════════════════════════
CANDIDATE RESUME
════════════════════════════════════════════════
${resume}

════════════════════════════════════════════════
JOB DESCRIPTION
Company : ${company}
Role    : ${role}
Date    : ${today}

${jd}
════════════════════════════════════════════════
CANDIDATE'S STATED GOAL
${goal || "Apply for relevant roles using transferable skills."}

════════════════════════════════════════════════
FORM QUESTION
"${question}"
Field type: ${fieldType}

════════════════════════════════════════════════
INSTRUCTIONS
- ${lengthGuide}
- Personalise specifically to "${company}" and the "${role}" role using details from the JD above.
- Highlight transferable skills that match the JD requirements.
- CRITICAL: If the question asks for a portfolio link, work sample link, website, LinkedIn profile, or links to your work, look at the CANDIDATE RESUME for the corresponding URL (e.g. https://www.canva.com/... or https://www.linkedin.com/...) and output the exact URL. Do NOT write a sentence, introduction, or placeholder (like "[insert link]"). Output ONLY the URL.
- Do NOT invent degrees, certifications, or tools not present in the resume.
- Do NOT use the name of any other company — only reference "${company}".
- No emojis. Professional tone. No filler phrases like "I am writing to express my interest."
- CRITICAL: Use ONLY plain ASCII characters. Do NOT use smart/curly quotes (“”‘’), em-dashes (—), en-dashes (–), ellipsis (…), bullet points (•’), or any Unicode special characters. Use straight quotes, regular hyphens, and standard punctuation only.
- Output ONLY the answer text — no labels, no explanations.
`.trim();

  const maxTok = fieldType === "cover_letter" ? 600 : 250;

  // GPT-5.x models use max_completion_tokens, older models use max_tokens
  const tokenParam = MODEL.startsWith("gpt-5") || MODEL.startsWith("o")
    ? { max_completion_tokens: maxTok }
    : { max_tokens: maxTok };

  const requestParams = {
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    ...tokenParam,
  };
  if (!MODEL.startsWith("gpt-5") && !MODEL.startsWith("o")) {
    requestParams.temperature = 0.35;
  }
  const response = await client.chat.completions.create(requestParams);

  const raw = response.choices[0].message.content.trim();
  return sanitizeAnswer(raw);
}

/**
 * Replace Unicode typographic characters with plain ASCII equivalents.
 * Prevents Internshala's "different language or special characters" error.
 */
function sanitizeAnswer(text) {
  if (!text) return text;
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes -> '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // curly double quotes -> "
    .replace(/[\u2013]/g, '-')                       // en-dash -> hyphen
    .replace(/[\u2014\u2015]/g, ' - ')               // em-dash -> " - "
    .replace(/[\u2026]/g, '...')                     // ellipsis -> ...
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '-') // bullet points -> -
    .replace(/[\u00A0]/g, ' ')                       // non-breaking space -> space
    .replace(/[^\x00-\x7F]/g, '');                   // strip any remaining non-ASCII
}

/**
 * Scrape all questions, JD, resume, and profile, and answer them all in a single batch.
 */
async function askAIBatch({ questions, jd, resume, company, role, goal, profile }) {
  if (!AI_AVAILABLE || !client) {
    return {};
  }

  const today = new Date().toLocaleDateString("en-IN", {
    year: "numeric", month: "long", day: "numeric"
  });

  const questionsListText = questions.map(q => {
    return `${q.id}: "${q.question}" (type: ${q.type})`;
  }).join('\n');

  const prompt = `
You are an expert job application assistant helping a candidate apply to a role in May 2026.

════════════════════════════════════════════════
CANDIDATE RESUME
════════════════════════════════════════════════
${resume}

════════════════════════════════════════════════
CANDIDATE SETTINGS, PREFERENCES & PROFILE
════════════════════════════════════════════════
- Target Location: ${profile.location || "mumbai"}
- Expected Salary: ${profile.minSalary || 300000} LPA
- Notice Period: ${profile.noticePeriodDays ?? 0} days
- Availability: ${profile.availability || "Immediate"}
- Target Goal: ${goal || "Apply for relevant roles using transferable skills."}
- Skill Experience (years): ${JSON.stringify(profile.experienceYears || {})}

════════════════════════════════════════════════
JOB DESCRIPTION
Company : ${company}
Role    : ${role}
Date    : ${today}

${jd}

════════════════════════════════════════════════
QUESTIONS TO ANSWER
${questionsListText}

════════════════════════════════════════════════
INSTRUCTIONS
For each question listed above:
1. Provide a professional, tailored, and accurate answer based on the CANDIDATE RESUME, SETTINGS, and JOB DESCRIPTION.
2. Formats:
   - For type "cover_letter": write 8-12 sentences.
   - For type "months_experience": output ONLY a single integer representing months. Calculate this by reading the resume for the duration of the matching skills (e.g. 1 year = 12, 3 years = 36). If 0 or not found, output 0.
   - For type "experience" (years of experience): output ONLY a single integer representing years (e.g. 3 or 1). If not found, output 0.
   - For type "salary": output a clean number based on expected salary preferences (either monthly or yearly depending on the question context, e.g. 300000 or 25000).
   - For type "location": output the candidate's preferred location (e.g. mumbai).
   - For type "yes_no": answer with a polite positive statement (e.g. "Yes, I am comfortable with this").
   - For other text/explanation questions: write a focused 2-3 sentence answer.
3. Personalise specifically to "${company}" and "${role}". Do NOT use any other company name.
4. Use ONLY plain ASCII characters. No smart quotes, curly quotes, en-dashes, or bullet points.
5. Return the answers as a single JSON object mapping each question ID (as a string) to its corresponding answer string.
Example format:
{
  "0": "answer text",
  "1": "12",
  "2": "300000"
}

Output ONLY the raw JSON object. Do not wrap it in markdown block backticks or add any other text.
`.trim();

  try {
    const maxTok = Math.min(2000, 400 * questions.length + 300);
    const tokenParam = MODEL.startsWith("gpt-5") || MODEL.startsWith("o")
      ? { max_completion_tokens: maxTok }
      : { max_tokens: maxTok };

    const requestParams = {
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      ...tokenParam,
    };
    if (!MODEL.startsWith("gpt-5") && !MODEL.startsWith("o")) {
      requestParams.temperature = 0.35;
    }
    const response = await client.chat.completions.create(requestParams);

    const raw = response.choices[0].message.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const rawData = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

    const sanitized = {};
    for (const [key, value] of Object.entries(rawData)) {
      sanitized[key] = sanitizeAnswer(String(value));
    }
    return sanitized;
  } catch (err) {
    console.error("   ⚠ OpenAI batch generation failed:", err.message);
    return {};
  }
}

module.exports = { askAI, askAIBatch, MODEL, AI_AVAILABLE };
