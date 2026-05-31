/**
 * Answer Engine
 *
 * Decision tree for answering any job-application form question:
 *
 *  1. Structural questions (salary, notice, location…) → Rule Engine  [no API cost]
 *  2. AI questions (explanation, cover letter, experience narrative…)
 *       a. Check answer cache (disk)  → reuse if same company+role+question  [no API cost]
 *       b. Call OpenAI API            → store in cache for future reuse
 *  3. Unknown fallback               → Rule Engine (may return null → "NOT_SURE")
 */

const { ruleBasedAnswer } = require("./rule-engine");
const { askAI }           = require("../ai-helper");

/**
 * @param {Object} opts
 * @param {string} opts.question  – Raw form question text
 * @param {string} opts.type      – Classified question type
 * @param {Object} opts.job       – { title, company, jd, jdText, … }
 * @param {string} opts.resume    – Candidate resume text
 * @param {Object} opts.profile   – User profile configuration
 */
async function getAnswer({ question, type, job, resume, goal, profile }) {

  /* ── 1. RULE ENGINE for fast / structured answers ──────── */
  const ruleAnswer = ruleBasedAnswer({ question, type, profile });
  if (ruleAnswer !== null && ruleAnswer !== undefined) {
    return String(ruleAnswer);
  }

  /* ── 2. AI FALLBACK for narrative / custom / unmatched answers ── */
  const company = job.company || "the company";
  const role    = job.title   || "the role";

  // Determine the OpenAI field-type hint
  let fieldType = "text";
  if (type === "cover_letter")       fieldType = "cover_letter";
  else if (type === "experience")     fieldType = "numeric";
  else if (type === "rating")         fieldType = "short";
  else if (type === "months_experience") fieldType = "numeric";

  /* ── 2a. Call OpenAI ──────────────────────────────────── */
  const jd = job.jdText || job.jd || `${role} at ${company}`;

  const answer = await askAI({
    question,
    jd,
    resume,
    company,
    role,
    fieldType,
    goal
  });

  /* ── AI unavailable (no key) → skip field cleanly ─────── */
  if (answer === null) {
    return "NOT_SURE"; // form-fill loop will skip this field
  }

  return String(answer);
}

module.exports = { getAnswer };
