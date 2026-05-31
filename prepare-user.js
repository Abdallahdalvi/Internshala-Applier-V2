const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const user = process.env.DALVI_USER || "default";
const userDir = path.join(__dirname, "users", user);

const pdfPath = path.join(userDir, "resume.pdf");
const txtPath = path.join(userDir, "resume.txt");
const configPath = path.join(userDir, "config.json");

console.log(`\n👤 Preparing environment for user: ${user}`);

if (!fs.existsSync(configPath)) {
  console.error(`❌ User config not found at: ${configPath}`);
  console.error("Please create it (you can copy from users/default/config.json).");
  process.exit(1);
}

const pngPath = path.join(userDir, "resume.png");
const jpgPath = path.join(userDir, "resume.jpg");
const jpegPath = path.join(userDir, "resume.jpeg");

async function extractTextFromImage(filePath, apiKey, model) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey });
  const fs = require("fs");
  const path = require("path");

  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString("base64");
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  const prompt = `
You are a document transcription assistant. Transcribe all readable text from the uploaded resume image verbatim. 
Maintain the structure and section layout as much as possible. Do NOT summarize or add commentary. Just output the transcribed text.
`.trim();

  let visionModel = "gpt-4o-mini";
  if (model.includes("gpt-4o") || model.includes("gpt-5") || model.includes("o4")) {
    visionModel = model;
  }

  const response = await client.chat.completions.create({
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`
            }
          }
        ]
      }
    ]
  });

  return response.choices[0].message.content.trim();
}

(async () => {
  const resumeFiles = [
    { type: "pdf", path: pdfPath },
    { type: "image", path: pngPath },
    { type: "image", path: jpgPath },
    { type: "image", path: jpegPath }
  ].filter(f => fs.existsSync(f.path))
   .map(f => ({ ...f, mtime: fs.statSync(f.path).mtimeMs }));

  let activeResume = null;
  if (resumeFiles.length > 0) {
    resumeFiles.sort((a, b) => b.mtime - a.mtime);
    activeResume = resumeFiles[0];
  }

  if (activeResume) {
    if (activeResume.type === "pdf") {
      console.log(`📄 Found resume.pdf for ${user}, parsing...`);
      try {
        const buffer = fs.readFileSync(activeResume.path);
        const data = await pdfParse(buffer);
        let text = data.text.trim();

        if (text.length < 50) {
          console.error("❌ Failed to parse resume.pdf: The PDF file has no readable text. It seems to be a scanned image-based PDF. Please convert it to a searchable text-based PDF or upload the original PNG/JPG image directly.");
          process.exit(1);
        }

        // Scan PDF binary buffer for hyperlinks (like LinkedIn and Canva/Google Drive portfolio)
        try {
          const binaryStr = buffer.toString('binary');
          const matches = binaryStr.match(/https?:\/\/[^\s\)\(<>]+/g);
          if (matches) {
            const uniqueLinks = Array.from(new Set(matches));
            const linkedin = uniqueLinks.find(l => l.includes('linkedin.com/in/'));
            const portfolio = uniqueLinks.find(l => l.includes('canva.com/') || l.includes('drive.google.com/'));
            
            if (linkedin) {
              text = text.replace(/LinkedIn\b/gi, `LinkedIn: ${linkedin}`);
            }
            if (portfolio) {
              text = text.replace(/Portfolio\b/gi, `Portfolio: ${portfolio}`);
            }
          }
        } catch (err) {
          console.warn("Could not scan binary links:", err.message);
        }

        fs.writeFileSync(txtPath, text);
        console.log(`✅ Extracted resume text to ${txtPath}`);
      } catch (err) {
        console.error(`❌ Failed to parse resume.pdf:`, err.message);
        process.exit(1);
      }
    } else {
      const imgPath = activeResume.path;
      console.log(`📷 Found image resume at ${imgPath}, transcribing...`);
      try {
        if (!fs.existsSync(configPath)) {
          console.error(`❌ Config file not found at ${configPath}. Need OpenAI key for image transcription.`);
          process.exit(1);
        }
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const apiKey = (process.env.OPENAI_API_KEY || config.openaiApiKey || "").trim();
        const model = (process.env.OPENAI_MODEL || config.openaiModel || "gpt-4o-mini").trim();
        
        if (!apiKey || apiKey === "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") {
          console.error("❌ OpenAI API Key is missing. Cannot transcribe image resume.");
          process.exit(1);
        }
        const text = await extractTextFromImage(imgPath, apiKey, model);
        fs.writeFileSync(txtPath, text);
        console.log(`✅ Extracted resume text to ${txtPath}`);
      } catch (err) {
        console.error(`❌ Failed to transcribe image resume:`, err.message);
        process.exit(1);
      }
    }
  } else {
    console.log(`⚠️ resume.pdf/image not found in ${userDir}.`);
    if (fs.existsSync(txtPath)) {
      console.log(`✅ Using existing resume.txt instead.`);
    } else {
      // Fallback to root resume.txt if running "default" and local missing
      const rootResume = path.join(__dirname, "resume.txt");
      if (fs.existsSync(rootResume)) {
        fs.copyFileSync(rootResume, txtPath);
        console.log(`✅ Copied root resume.txt to ${userDir}/resume.txt`);
      } else {
        console.error(`❌ No resume found. Please provide a resume.pdf, image, or resume.txt in ${userDir}`);
        process.exit(1);
      }
    }
  }
})();
