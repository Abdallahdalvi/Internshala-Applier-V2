/**
 * internshala-profile-builder.js
 *
 * Automatically builds the student profile on Internshala using the uploaded resume.
 * 1. Connects to the browser via remote debugging port 9222.
 * 2. Navigates to the resume edit page.
 * 3. Prompts the user to log in if they aren't already.
 * 4. Uploads the PDF resume.
 * 5. Uses OpenAI to extract structured sections (skills, education, experience, projects).
 * 6. Automates filling the profile forms with high-robustness page evaluations.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const user = process.env.DALVI_USER || "default";
const USER_DIR = path.join(__dirname, "../users", user);
const RESUME_TXT_PATH = path.join(USER_DIR, "resume.txt");
const RESUME_PDF_PATH = path.join(USER_DIR, "resume.pdf");
const CONFIG_PATH = path.join(USER_DIR, "config.json");

async function convertImageToPDF(imagePath, pdfPath) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ autoFirstPage: false });
  const stream = fs.createWriteStream(pdfPath);
  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(pdfPath));
    stream.on("error", reject);
    doc.pipe(stream);
    try {
      const img = doc.openImage(imagePath);
      doc.addPage({ size: [img.width, img.height] });
      doc.image(img, 0, 0, { width: img.width, height: img.height });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

(async () => {
  console.log("🚀 Starting Internshala Profile Builder Automation...");

  // Verify paths
  if (!fs.existsSync(RESUME_TXT_PATH)) {
    console.error(`❌ Resume text not found at: ${RESUME_TXT_PATH}. Please upload a resume PDF first.`);
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ Config file not found at: ${CONFIG_PATH}.`);
    process.exit(1);
  }

  // Load config & resume
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const resumeText = fs.readFileSync(RESUME_TXT_PATH, "utf-8");

  const apiKey = (process.env.OPENAI_API_KEY || config.openaiApiKey || "").trim();
  const model = (process.env.OPENAI_MODEL || config.openaiModel || "gpt-4o-mini").trim();

  if (!apiKey || apiKey === "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") {
    console.error("❌ OpenAI API Key is missing. Please enter your API Key in the UI settings first.");
    process.exit(1);
  }

  const structuredDataPath = path.join(USER_DIR, "structured_resume.json");
  let structuredData = null;

  if (fs.existsSync(structuredDataPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(structuredDataPath, "utf-8"));
      if (cached && (cached.skills?.length > 0 || cached.education?.length > 0)) {
        console.log("💾 Found existing structured resume data, skipping OpenAI API call.");
        structuredData = cached;
      }
    } catch (err) {
      console.log(`⚠️ Failed to load structured_resume.json cached file: ${err.message}`);
    }
  }

  if (!structuredData) {
    console.log(`🤖 Using OpenAI model: ${model} to analyze resume...`);
    try {
      structuredData = await extractProfileData(resumeText, apiKey, model);
      console.log("✅ Successfully structured resume data via AI!");
      console.log(`📎 Extracted Skills: ${structuredData.skills.join(", ")}`);
      console.log(`📎 Extracted Education: ${structuredData.education.length} entries`);
      console.log(`📎 Extracted Experience: ${structuredData.experience.length} entries`);
      console.log(`📎 Extracted Projects: ${structuredData.projects.length} entries`);
      console.log(`📎 Extracted LinkedIn URL: ${structuredData.linkedin_link || "None"}`);
      console.log(`📎 Extracted Work Samples: ${structuredData.work_samples ? structuredData.work_samples.length : 0} entries`);

      fs.writeFileSync(structuredDataPath, JSON.stringify(structuredData, null, 2), "utf-8");
      console.log(`💾 Saved structured resume data to: ${structuredDataPath}`);
    } catch (err) {
      console.error(`❌ Failed to structure resume with OpenAI: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`📎 Loaded Skills: ${structuredData.skills.join(", ")}`);
    console.log(`📎 Loaded Education: ${structuredData.education.length} entries`);
    console.log(`📎 Loaded Experience: ${structuredData.experience.length} entries`);
    console.log(`📎 Loaded Projects: ${structuredData.projects.length} entries`);
    console.log(`📎 Loaded LinkedIn URL: ${structuredData.linkedin_link || "None"}`);
    console.log(`📎 Loaded Work Samples: ${structuredData.work_samples ? structuredData.work_samples.length : 0} entries`);
  }

  // 2. Connect to Electron CDP Browser
  console.log("🌐 Connecting to browser window...");
  let browser, context, page;
  try {
    browser = await chromium.connectOverCDP("http://localhost:9222");
    context = browser.contexts()[0];
    const allPages = context.pages();
    page = allPages.find(p => !p.url().includes('main_window') && !p.url().startsWith('devtools://')) || allPages[0];
    console.log("✅ Connected to browser session!");
  } catch (err) {
    console.error(`❌ Could not connect to browser over CDP: ${err.message}. Is the app running?`);
    process.exit(1);
  }

  // 3. Navigate and Login Check
  console.log("🌐 Navigating to Internshala profile page...");
  await page.goto("https://internshala.com/student/resume", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2000);

  // Loop wait if we are redirected to login
  while (page.url().includes("/login") || await page.locator(".login-container, #google-login-button").count() > 0) {
    console.log("🔑 Please sign in or register to Internshala in the browser window...");
    await page.waitForTimeout(3000);
  }

  console.log("👤 Logged in! Loading profile builder interface...");
  if (!page.url().includes("/student/resume")) {
    await page.goto("https://internshala.com/student/resume");
    await page.waitForTimeout(3000);
  }

  // 4. Upload Resume File
  console.log("📄 Uploading resume file...");
  let tempPdfPath = "";
  try {
    const resumeFiles = [
      path.join(USER_DIR, "resume.pdf"),
      path.join(USER_DIR, "resume.png"),
      path.join(USER_DIR, "resume.jpg"),
      path.join(USER_DIR, "resume.jpeg")
    ].filter(p => fs.existsSync(p))
     .map(p => ({ path: p, mtime: fs.statSync(p).mtimeMs }));

    if (resumeFiles.length > 0) {
      resumeFiles.sort((a, b) => b.mtime - a.mtime);
      const activeResumePath = resumeFiles[0].path;
      const ext = path.extname(activeResumePath).toLowerCase();
      const isImage = ['.png', '.jpg', '.jpeg'].includes(ext);
      let uploadFilePath = activeResumePath;

      if (isImage) {
        // Crop the candidate's profile picture from the resume image!
        try {
          console.log("📷 Cropping candidate headshot from resume image...");
          const profilePicPath = path.join(USER_DIR, "profile_pic.png");
          const imageBase64 = fs.readFileSync(activeResumePath).toString("base64");
          const croppedResult = await page.evaluate(async (dataUrl) => {
            return new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                try {
                  const canvas = document.createElement("canvas");
                  const ctx = canvas.getContext("2d");
                  const imgWidth = img.naturalWidth;
                  const imgHeight = img.naturalHeight;
                  
                  // Crop box for top-right candidate picture
                  const cropX = Math.round(imgWidth * 0.81);
                  const cropY = Math.round(imgHeight * 0.025);
                  const cropW = Math.round(imgWidth * 0.165);
                  const cropH = Math.round(imgHeight * 0.115);
                  
                  canvas.width = cropW;
                  canvas.height = cropH;
                  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                  resolve(canvas.toDataURL("image/png"));
                } catch (e) {
                  reject(e.message);
                }
              };
              img.onerror = () => reject("Failed to load image");
              img.src = dataUrl;
            });
          }, `data:${ext === '.png' ? 'image/png' : 'image/jpeg'};base64,${imageBase64}`);

          fs.writeFileSync(profilePicPath, Buffer.from(croppedResult.replace(/^data:image\/png;base64,/, ""), "base64"));
          console.log(`✅ Saved cropped headshot to: ${profilePicPath}`);
        } catch (cropErr) {
          console.log(`⚠️ Candidate headshot cropping failed: ${cropErr.message}`);
        }

        // Convert the image to PDF for Internshala upload
        try {
          console.log("📄 Converting image resume to PDF for Internshala compatibility...");
          tempPdfPath = path.join(USER_DIR, "resume_converted.pdf");
          await convertImageToPDF(activeResumePath, tempPdfPath);
          uploadFilePath = tempPdfPath;
          console.log("✅ Converted image to PDF!");
        } catch (pdfErr) {
          console.log(`⚠️ PDF conversion failed: ${pdfErr.message}`);
        }
      }

      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await fileInput.setInputFiles(uploadFilePath);
        console.log(`✅ Resume (${path.basename(uploadFilePath)}) uploaded successfully!`);
        await page.waitForTimeout(3000);
      } else {
        console.log("⚠️ Could not find file input on profile page to upload resume.");
      }
    } else {
      console.log("⚠️ No resume file found in user directory, skipping resume upload.");
    }
  } catch (err) {
    console.log(`⚠️ Resume upload failed: ${err.message}`);
  } finally {
    // Delete temporary converted PDF if it exists
    if (tempPdfPath && fs.existsSync(tempPdfPath)) {
      try {
        fs.unlinkSync(tempPdfPath);
        console.log("🧹 Cleaned up temporary converted PDF file.");
      } catch (e) {}
    }
  }

  const monthMap = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    january: "01", february: "02", march: "03", april: "04", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
  };

  function parseDateString(str) {
    if (!str) return "";
    const cleaned = str.trim().toLowerCase();
    if (cleaned.includes("present") || cleaned.includes("current")) {
      return "present";
    }
    const match = cleaned.match(/([a-z]+|\d+)\s*[\/\-\s]\s*(\d{4})/);
    if (match) {
      const monthPart = match[1];
      const yearPart = match[2];
      let monthNum = "01";
      if (monthMap[monthPart]) {
        monthNum = monthMap[monthPart];
      } else if (/^\d+$/.test(monthPart)) {
        monthNum = monthPart.padStart(2, '0');
      }
      return `${yearPart}-${monthNum}-01`;
    }
    const yearMatch = cleaned.match(/\b(\d{4})\b/);
    if (yearMatch) {
      return `${yearMatch[1]}-01-01`;
    }
    return "";
  }

  // Helper function to handle Chosen dropdowns & autocomplete triggers
  async function selectDropdownOption(selector, textValue) {
    await page.evaluate(({ sel, val }) => {
      const select = document.querySelector(sel);
      if (!select) return false;
      const option = Array.from(select.options).find(o =>
        o.value.toLowerCase() === val.toLowerCase() ||
        o.text.toLowerCase().includes(val.toLowerCase())
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery && window.jQuery(select).trigger) {
          window.jQuery(select).trigger('chosen:updated');
        }
        return true;
      }
      return false;
    }, { sel: selector, val: textValue });
  }

  // Helper for text inputs that trigger autocomplete suggestions
  async function fillAutocompleteInput(selector, value) {
    if (!value) return;
    const input = page.locator(selector).first();
    if (await input.count() && await input.isVisible()) {
      await input.scrollIntoViewIfNeeded();
      await input.fill(value);
      await page.waitForTimeout(1500); // Wait for suggestions to render
      
      const clickedText = await page.evaluate(({ searchVal }) => {
        const visibleList = Array.from(document.querySelectorAll("ul.ui-autocomplete")).find(ul => {
          return ul.style.display === "block" || (ul.offsetWidth > 0 && ul.offsetHeight > 0);
        });
        if (visibleList) {
          const items = Array.from(visibleList.querySelectorAll("li.ui-menu-item, li"));
          if (items.length > 0) {
            // Filter out 'can't find', 'no match', etc. items
            const SKIP_KEYWORDS = ["no match found", "no suggestion", "can't find", "cannot find", "not found"];
            const validItems = items.filter(item => {
              const t = (item.innerText || item.textContent || "").trim().toLowerCase();
              return !SKIP_KEYWORDS.some(k => t.includes(k));
            });
            if (validItems.length === 0) return null;

            // Find the best matching item — prefer one containing any keyword from the search
            const lowerSearch = searchVal.toLowerCase();
            const keywords = lowerSearch.split(/[\s\/\-]+/).filter(w => w.length > 2);
            let bestMatch = null;
            for (const kw of keywords) {
              bestMatch = validItems.find(item => {
                const t = (item.innerText || item.textContent || "").trim().toLowerCase();
                return t.includes(kw);
              });
              if (bestMatch) break;
            }
            const target = bestMatch || validItems[0];
            const text = (target.innerText || target.textContent || "").trim();
            target.click();
            return text;
          }
        }
        return null;
      }, { searchVal: value });

      if (clickedText) {
        console.log(`      ✅ Selected autocomplete suggestion for ${selector}: "${clickedText.trim()}"`);
      } else {
        // Fallback: set value directly via JS so the field is not blank
        console.log(`      ⚠️ No suggestion found for ${selector}, setting value directly via JS`);
        await page.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel);
          if (el) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (window.jQuery) window.jQuery(el).trigger('change');
          }
        }, { sel: selector, val: value });
      }
      await page.waitForTimeout(1000);
    }
  }

  async function waitForLoading() {
    const toast = page.locator("#loading_toast").first();
    if (await toast.count()) {
      await toast.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    }
  }

  async function handleErrorAndReset(errMessage) {
    console.log(`   ⚠️ Skipped entry due to error: ${errMessage}`);
    console.log("   🔄 Reloading profile page to clear broken modal states...");
    try {
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log("   ⚠️ Reload failed:", e.message);
    }
  }

  // Reload page to clear any lingering open modals
  console.log("🔄 Resetting profile page state...");
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2000);

  // Helper to clear existing section entries
  async function clearSection(deleteButtonSelector, sectionName) {
    console.log(`🧹 Clearing all existing entries in ${sectionName} using selector: ${deleteButtonSelector}...`);
    let count = 0;
    while (true) {
      const deleteBtn = page.locator(deleteButtonSelector).first();
      const hasBtn = await deleteBtn.count() > 0;
      const isVisible = hasBtn ? await deleteBtn.isVisible() : false;
      if (isVisible) {
        console.log(`   [${sectionName}] Clicking delete button...`);
        await deleteBtn.scrollIntoViewIfNeeded();
        await deleteBtn.click({ force: true });
        await page.waitForTimeout(1000);
        
        // Confirm deletion
        const confirmBtn = page.locator("#confirmation_modal .yes-button").first();
        const hasConfirm = await confirmBtn.count() > 0;
        const confirmVisible = hasConfirm ? await confirmBtn.isVisible() : false;
        if (confirmVisible) {
          console.log(`   [${sectionName}] Clicking confirmation "Yes" button...`);
          await confirmBtn.click({ force: true });
          await page.waitForTimeout(1500);
          await waitForLoading();
          count++;
        } else {
          console.log("   ⚠️ No confirmation button found for deletion, stopping loop.");
          break;
        }
      } else {
        break;
      }
    }
    if (count > 0) {
      console.log(`   ✅ Cleared ${count} entries from ${sectionName}.`);
    } else {
      console.log(`   ⏭️ No existing entries found in ${sectionName}.`);
    }
  }

  async function clearSkills() {
    console.log("🧹 Clearing all existing skills...");
    let count = 0;
    while (true) {
      const deleteBtn = page.locator("i.skills_delete").first();
      const hasBtn = await deleteBtn.count() > 0;
      const isVisible = hasBtn ? await deleteBtn.isVisible() : false;
      if (isVisible) {
        console.log(`   [Skills] Clicking delete button...`);
        await deleteBtn.scrollIntoViewIfNeeded();
        await deleteBtn.click({ force: true });
        await page.waitForTimeout(1000);
        
        // Confirm modal if any
        const confirmBtn = page.locator("#confirmation_modal .yes-button").first();
        const hasConfirm = await confirmBtn.count() > 0;
        const confirmVisible = hasConfirm ? await confirmBtn.isVisible() : false;
        if (confirmVisible) {
          console.log(`   [Skills] Clicking confirmation "Yes" button...`);
          await confirmBtn.click({ force: true });
          await page.waitForTimeout(1500);
        }
        await waitForLoading();
        count++;
      } else {
        break;
      }
    }
    if (count > 0) {
      console.log(`   ✅ Cleared ${count} skills.`);
    } else {
      console.log("   ⏭️ No existing skills found.");
    }
  }

  async function clearWorkSamples() {
    console.log("🧹 Clearing all existing work samples...");
    let count = 0;
    while (true) {
      const deleteBtn = page.locator("a.work-sample-delete, a.work-samples-delete").first();
      const hasBtn = await deleteBtn.count() > 0;
      const isVisible = hasBtn ? await deleteBtn.isVisible() : false;
      if (isVisible) {
        console.log(`   [Work Samples] Clicking delete button...`);
        await deleteBtn.scrollIntoViewIfNeeded();
        await deleteBtn.click({ force: true });
        await page.waitForTimeout(1000);
        
        const confirmBtn = page.locator("#confirmation_modal .yes-button").first();
        const hasConfirm = await confirmBtn.count() > 0;
        const confirmVisible = hasConfirm ? await confirmBtn.isVisible() : false;
        if (confirmVisible) {
          console.log(`   [Work Samples] Clicking confirmation "Yes" button...`);
          await confirmBtn.click({ force: true });
          await page.waitForTimeout(1500);
          await waitForLoading();
        }
        count++;
      } else {
        break;
      }
    }
    if (count > 0) {
      console.log(`   ✅ Cleared ${count} work samples.`);
    } else {
      console.log("   ⏭️ No existing work samples found.");
    }
  }

  // Clear everything to build fresh
  await clearSection("a.education_delete", "Education");
  await clearSection("a.work_experiences_delete", "Work Experience");
  await clearSection("a.other_experiences_delete", "Projects");
  await clearSkills();
  await clearWorkSamples();

  // 5. Automate Education Profile entries
  console.log("🎓 Automating Education entries...");
  for (const edu of structuredData.education) {
    try {
      const pageText = await page.innerText("body");
      const cleanSchool = (edu.college_school || "").toLowerCase();
      if (cleanSchool && pageText.toLowerCase().includes(cleanSchool)) {
        console.log(`   ⏭️ Education "${edu.college_school}" already exists on profile, skipping.`);
        continue;
      }

      console.log(`   🏫 Adding education: ${edu.college_school || edu.degree || "schooling"}`);
      await waitForLoading();
      const eduMainBtn = page.locator("#education").first();
      if (await eduMainBtn.count() && await eduMainBtn.isVisible()) {
        await eduMainBtn.scrollIntoViewIfNeeded();
        await eduMainBtn.click();
        await page.waitForTimeout(1000);
      }

      let tabSelector = "";
      if (edu.type === "graduation" || edu.type === "post_graduation") {
        tabSelector = "#graduation-tab";
      } else if (edu.type === "xii") {
        tabSelector = "#senior_secondary-tab";
      } else if (edu.type === "diploma") {
        tabSelector = "#diploma-tab";
      } else {
        tabSelector = "#secondary-tab";
      }

      const addBtn = page.locator(tabSelector).first();
      if (await addBtn.count() && await addBtn.isVisible()) {
        await addBtn.click();
        await page.waitForTimeout(2000);

        if (edu.type === "graduation" || edu.type === "post_graduation" || edu.type === "diploma") {
          const collegeName = edu.college_school || "University College";
          const degreeName = edu.degree || "Bachelor's Degree";
          const streamName = edu.stream || "General";
          await fillAutocompleteInput("#college", collegeName);
          await fillAutocompleteInput("#degree", degreeName);
          await fillAutocompleteInput("#stream", streamName);
          
          const startYearVal = edu.start_year || "2020";
          const endYearVal = edu.end_year || "2023";
          await selectDropdownOption("#start_year", startYearVal);
          await selectDropdownOption("#end_year", endYearVal);
          
          if (edu.performance) {
            const isCgpa = edu.performance.includes(".") || edu.performance.toLowerCase().includes("cgpa") || !edu.performance.includes("%");
            await selectDropdownOption("#performance-scale-college", isCgpa ? "CGPA (10)" : "Percentage");
            await page.fill("#performance-college", edu.performance.replace(/[^\d\.]/g, ""));
          }
          
          await page.locator("#college-submit").click();
          // Wait for modal to hide, proving it successfully saved
          await page.locator("#college-modal").waitFor({ state: "hidden", timeout: 8000 }).catch(() => {
            throw new Error("Form validation failed inside college modal (fields might be incorrect or missing)");
          });
        } else {
          const schoolName = edu.college_school || "State Board School";
          await fillAutocompleteInput("#school", schoolName);
          await page.waitForTimeout(800);
          
          // If "Can't find my school" was selected, a fallback manual input may appear — fill it
          const manualSchoolInput = page.locator("#school_other_name, #school-manual-name, input[name='school_name']").first();
          if (await manualSchoolInput.count() > 0 && await manualSchoolInput.isVisible()) {
            console.log(`      📝 Filling manual school name field: "${schoolName}"`);
            await manualSchoolInput.fill(schoolName);
          }
          
          // Check "Completed" status radio button with force: true to bypass overlay/styling interceptions
          await page.locator("#school_completion_status_completed").check({ force: true }).catch(() => {});
          
          const endYearVal = edu.end_year || (edu.type === "xii" ? "2020" : "2018");
          await selectDropdownOption("#year_of_completion", endYearVal);
          // Use extracted board field, fallback to inferring from college_school text
          const boardVal = edu.board || (edu.college_school || "").replace(/[,.].*$/, "").trim() || "Maharashtra State Board";
          await fillAutocompleteInput("#board", boardVal);
          
          if (edu.type === "xii") {
            let streamValue = "Science";
            if (edu.stream?.toLowerCase().includes("comm")) streamValue = "Commerce";
            if (edu.stream?.toLowerCase().includes("art")) streamValue = "Arts";
            await selectDropdownOption("#stream-school", streamValue);
          }
          
          if (edu.performance) {
            const isCgpa = edu.performance.includes(".") || edu.performance.toLowerCase().includes("cgpa") || !edu.performance.includes("%");
            await selectDropdownOption("#performance-scale-school", isCgpa ? "CGPA (10)" : "Percentage");
            await page.fill("#performance-school", edu.performance.replace(/[^\d\.]/g, ""));
          }
          
          await page.locator("#school-submit").click();
          // Wait for modal to hide, proving it successfully saved
          await page.locator("#school-modal").waitFor({ state: "hidden", timeout: 8000 }).catch(() => {
            throw new Error("Form validation failed inside school modal (fields might be incorrect or missing)");
          });
        }

        console.log(`   ✅ Added education successfully!`);
        await page.waitForTimeout(2000);
      }
    } catch (err) {
      await handleErrorAndReset(err.message);
    }
  }

  // 6. Automate Experiences / Internships / Jobs
  console.log("💼 Automating Work Experience entries...");
  for (const exp of structuredData.experience) {
    try {
      const pageText = await page.innerText("body");
      if (pageText.toLowerCase().includes(exp.organization.toLowerCase())) {
        console.log(`   ⏭️ Experience at "${exp.organization}" already exists, skipping.`);
        continue;
      }

      console.log(`   🏢 Adding experience: ${exp.designation || exp.profile} at ${exp.organization}`);
      await waitForLoading();
      const btnSelector = exp.type === "job" ? "#job" : "#internship";
      
      const addBtn = page.locator(btnSelector).first();
      if (await addBtn.count() && await addBtn.isVisible()) {
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        await page.waitForTimeout(2000);

        // Fill exact Designation if visible (jobs have designations, internships typically hide this field)
        const designationInput = page.locator("#experience_designation").first();
        if (await designationInput.count() && await designationInput.isVisible()) {
          await designationInput.fill(exp.designation || exp.profile || "");
        }
        await fillAutocompleteInput("#experience_profile", exp.profile);
        await fillAutocompleteInput("#experience_organization", exp.organization);
        
        const isWfh = exp.location?.toLowerCase().includes("home") || exp.location?.toLowerCase().includes("wfh");
        if (isWfh) {
          const wfhCheckbox = page.locator("#experience_is_work_from_home");
          const checked = await wfhCheckbox.isChecked().catch(() => false);
          if (!checked) {
            await wfhCheckbox.check({ force: true }).catch(() => {});
          }
        } else {
          await fillAutocompleteInput("#experience_location", exp.location);
        }

        if (exp.start_month_year) {
          const startVal = parseDateString(exp.start_month_year);
          if (startVal) {
            await page.evaluate(({ val }) => {
              const el = document.getElementById("experience_start_date");
              if (el) {
                el.value = val;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }, { val: startVal });
          }
        }

        const isCurrent = exp.end_month_year?.toLowerCase().includes("present") || exp.end_month_year?.toLowerCase().includes("current");
        if (isCurrent) {
          const ongoingCheckbox = page.locator("#experience_on_going");
          const checked = await ongoingCheckbox.isChecked().catch(() => false);
          if (!checked) {
            await ongoingCheckbox.check({ force: true }).catch(() => {});
          }
        } else if (exp.end_month_year) {
          const endVal = parseDateString(exp.end_month_year);
          if (endVal) {
            await page.evaluate(({ val }) => {
              const el = document.getElementById("experience_end_date");
              if (el) {
                el.value = val;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }, { val: endVal });
          }
        }

        // Fill rich text Summernote description securely using evaluate code trigger
        if (exp.description) {
          await page.evaluate(({ id, val }) => {
            const el = document.getElementById(id);
            if (el) {
              if (window.jQuery && window.jQuery(el).summernote) {
                window.jQuery(el).summernote('code', val);
              } else {
                el.value = val;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }
          }, { id: "experience_description", val: exp.description });
        }

        await page.locator("#internship-job-submit").click();
        await page.locator("#internship-job-modal").waitFor({ state: "hidden", timeout: 8000 }).catch(() => {
          throw new Error("Form validation failed inside experience modal (fields might be incorrect or missing)");
        });
        console.log(`   ✅ Added experience successfully!`);
        await page.waitForTimeout(2000);
      }
    } catch (err) {
      await handleErrorAndReset(err.message);
    }
  }

  // 7. Automate Projects
  console.log("📁 Automating Project entries...");
  for (const proj of structuredData.projects) {
    try {
      const pageText = await page.innerText("body");
      if (pageText.toLowerCase().includes(proj.title.toLowerCase())) {
        console.log(`   ⏭️ Project "${proj.title}" already exists, skipping.`);
        continue;
      }

      console.log(`   📂 Adding project: ${proj.title}`);
      await waitForLoading();
      const addBtn = page.locator("#project-resume").first();
      if (await addBtn.count() && await addBtn.isVisible()) {
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        await page.waitForTimeout(2000);

        await page.fill("#other_experiences_title", proj.title || "");

        if (proj.start_month_year) {
          const startVal = parseDateString(proj.start_month_year);
          if (startVal) {
            await page.evaluate(({ val }) => {
              const el = document.getElementById("other_experiences_project_start_date");
              if (el) {
                el.value = val;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }, { val: startVal });
          }
        }

        const isCurrent = proj.end_month_year?.toLowerCase().includes("present") || proj.end_month_year?.toLowerCase().includes("current");
        if (isCurrent) {
          const ongoingCheckbox = page.locator("#other_experiences_project_is_on_going");
          const checked = await ongoingCheckbox.isChecked().catch(() => false);
          if (!checked) {
            await ongoingCheckbox.check({ force: true }).catch(() => {});
          }
        } else if (proj.end_month_year) {
          const endVal = parseDateString(proj.end_month_year);
          if (endVal) {
            await page.evaluate(({ val }) => {
              const el = document.getElementById("other_experiences_project_end_date");
              if (el) {
                el.value = val;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }, { val: endVal });
          }
        }

        if (proj.link) {
          await page.fill("#other_experiences_project_link", proj.link);
        }

        // Fill rich text Summernote description securely using evaluate code trigger
        if (proj.description) {
          await page.evaluate(({ id, val }) => {
            const el = document.getElementById(id);
            if (el) {
              if (window.jQuery && window.jQuery(el).summernote) {
                window.jQuery(el).summernote('code', val);
              } else {
                el.value = val;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }
          }, { id: "other_experiences_project_description", val: proj.description });
        }

        await page.locator("#project-submit").click();
        await page.locator("#project-modal").waitFor({ state: "hidden", timeout: 8000 }).catch(() => {
          throw new Error("Form validation failed inside project modal (fields might be incorrect or missing)");
        });
        console.log(`   📂 Added project successfully!`);
        await page.waitForTimeout(2000);
      }
    } catch (err) {
      await handleErrorAndReset(err.message);
    }
  }

  // 8. Automate Skills
  console.log("⚡ Automating Skill entries...");
  try {
    await waitForLoading();
    const addSkillBtn = page.locator("#skill-form-modal").first();
    if (await addSkillBtn.count() && await addSkillBtn.isVisible()) {
      // Open the Skill Modal ONCE
      await addSkillBtn.scrollIntoViewIfNeeded();
      await addSkillBtn.click();
      await page.waitForTimeout(2000);

      for (const skill of structuredData.skills) {
        try {
          const existingSkills = await page.evaluate(() => {
            const container = document.getElementById("prefilled-skills-detail-table");
            if (!container) return [];
            const rows = container.querySelectorAll(".prefilled-skills-details-row");
            return Array.from(rows).map(row => (row.innerText || row.textContent || "").trim().toLowerCase());
          });
          if (existingSkills.includes(skill.toLowerCase())) {
            console.log(`   ⏭️ Skill "${skill}" already exists on profile, skipping.`);
            continue;
          }

          console.log(`   🎯 Adding skill: ${skill}`);
          
          // Verify modal is open and reopen if it closed unexpectedly (e.g. from previous suggestion clicks)
          let skillInput = page.locator("#skill").first();
          let visible = await skillInput.count() > 0 ? await skillInput.isVisible() : false;
          if (!visible) {
            console.log("   ⚠️ Skill modal closed unexpectedly. Reopening modal...");
            if (await addSkillBtn.count() && await addSkillBtn.isVisible()) {
              await addSkillBtn.click();
              await page.waitForTimeout(2000);
            }
          }

          await fillAutocompleteInput("#skill", skill);
          await page.waitForTimeout(1500); // Wait for Internshala save action
        } catch (err) {
          console.log(`   ⚠️ Could not add skill: ${skill} (${err.message})`);
        }
      }

      // Close the modal once at the end
      const closeBtn = page.locator("#skill-modal-close").first();
      if (await closeBtn.count() && await closeBtn.isVisible()) {
        await closeBtn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    } else {
      console.log("⚠️ Could not find Skill modal button (#skill-form-modal).");
    }
  } catch (err) {
    await handleErrorAndReset(err.message);
  }

  // 9. Automate Personal Details (Name, Phone, LinkedIn, Profile Pic)
  console.log("👤 Automating Personal Details...");
  try {
    await waitForLoading();

    // Check if we need to update name, phone, linkedin or upload profile picture
    const editBtn = page.locator("#personal_details_edit").first();
    if (await editBtn.count() && await editBtn.isVisible()) {
      await editBtn.scrollIntoViewIfNeeded();
      await editBtn.click();
      await page.waitForTimeout(2000);

      // Verify fields exist
      const firstNameInput = page.locator("#personal-details-modal #first_name").first();
      const lastNameInput = page.locator("#personal-details-modal #last_name").first();
      const phoneInput = page.locator("#personal-details-modal #phone").first();
      const linkedinInput = page.locator("#personal-details-modal #linkedin_url").first();
      const profilePicInput = page.locator("#personal-details-modal #profile_pic").first();

      let needsUpdate = false;
      
      // First Name
      if (structuredData.first_name && await firstNameInput.count() && await firstNameInput.isVisible()) {
        const currVal = await firstNameInput.inputValue();
        if (currVal.trim().toLowerCase() !== structuredData.first_name.trim().toLowerCase()) {
          console.log(`   👤 Updating First Name: "${currVal}" -> "${structuredData.first_name}"`);
          await firstNameInput.fill(structuredData.first_name);
          needsUpdate = true;
        }
      }

      // Last Name
      if (structuredData.last_name && await lastNameInput.count() && await lastNameInput.isVisible()) {
        const currVal = await lastNameInput.inputValue();
        if (currVal.trim().toLowerCase() !== structuredData.last_name.trim().toLowerCase()) {
          console.log(`   👤 Updating Last Name: "${currVal}" -> "${structuredData.last_name}"`);
          await lastNameInput.fill(structuredData.last_name);
          needsUpdate = true;
        }
      }

      // Phone
      if (structuredData.phone && await phoneInput.count() && await phoneInput.isVisible()) {
        const currVal = await phoneInput.inputValue();
        const cleanExtractedPhone = structuredData.phone.replace(/[^\d]/g, "").slice(-10); // get last 10 digits
        const cleanCurrVal = currVal.replace(/[^\d]/g, "").slice(-10);
        if (cleanExtractedPhone && cleanExtractedPhone !== cleanCurrVal) {
          console.log(`   📞 Updating Phone Number: "${currVal}" -> "${cleanExtractedPhone}"`);
          await phoneInput.fill(cleanExtractedPhone);
          needsUpdate = true;
        }
      }

      // LinkedIn
      if (structuredData.linkedin_link && await linkedinInput.count() && await linkedinInput.isVisible()) {
        const currVal = await linkedinInput.inputValue();
        if (!currVal.includes("linkedin.com")) {
          console.log(`   🔗 Updating LinkedIn URL: "${currVal}" -> "${structuredData.linkedin_link}"`);
          await linkedinInput.fill(structuredData.linkedin_link);
          needsUpdate = true;
        }
      }

      // Candidate Profile Pic
      const profilePicPath = path.join(USER_DIR, "profile_pic.png");
      if (fs.existsSync(profilePicPath) && await profilePicInput.count() && await profilePicInput.isVisible()) {
        console.log(`   📷 Uploading cropped candidate profile picture: ${profilePicPath}`);
        await profilePicInput.setInputFiles(profilePicPath);
        needsUpdate = true;
      }

      if (needsUpdate) {
        const submitBtn = page.locator("#personal-details-modal .submit-cta, #personal-details-modal button[type='submit']").first();
        await submitBtn.click();
        await page.waitForTimeout(3000);
        await waitForLoading();

        // Check if an OTP / verification modal is triggered!
        const otpModal = page.locator("#otp-modal, .otp-container, [id*='otp'], [class*='otp']").first();
        const otpCount = await otpModal.count().catch(() => 0);
        const otpVisible = otpCount > 0 ? await otpModal.isVisible().catch(() => false) : false;
        
        // Also check if personal details modal is still open (meaning submit failed or is blocking on verify)
        const isModalStillVisible = await page.locator("#personal-details-modal").first().isVisible().catch(() => false);

        if (otpVisible || isModalStillVisible) {
          console.log("   ⚠️ Phone/email change triggered OTP or verification alert! Reverting personal details update...");
          await page.reload({ waitUntil: "load" });
          await page.waitForTimeout(2000);
        } else {
          console.log("   ✅ Personal details updated successfully! Reloading page...");
          await page.reload({ waitUntil: "load" });
          await page.waitForTimeout(2000);
        }
      } else {
        console.log("   ⏭️ Personal details are already up-to-date. Closing modal...");
        const closeBtn = page.locator("#personal-details-modal .close_action, #personal-details-modal [data-dismiss='modal']").first();
        if (await closeBtn.count()) {
          await closeBtn.click();
          await page.waitForTimeout(1000);
        }
      }
    }
  } catch (err) {
    await handleErrorAndReset(err.message);
  }

  // 10. Automate Portfolio & Work Samples Links
  if (structuredData.work_samples && structuredData.work_samples.length > 0) {
    console.log(`🔗 Automating Work Samples & Links (${structuredData.work_samples.length} entries)...`);
    
    // Clear any stuck modals before starting work samples
    await page.evaluate(() => {
      if (window.jQuery) window.jQuery(".modal").modal("hide");
    });
    await page.waitForTimeout(2000);

    for (const ws of structuredData.work_samples) {
      if (!ws.url) continue;
      
      try {
        await waitForLoading();
        const pageText = await page.innerText("body");
        
        let urlCleaned = ws.url.trim();
        try {
          const urlObj = new URL(urlCleaned);
          urlObj.search = "";
          urlObj.hash = "";
          urlCleaned = urlObj.toString();
        } catch (e) {
          urlCleaned = urlCleaned.split(/[?#]/)[0];
        }

        const checkSubstring = urlCleaned.toLowerCase().replace(/https?:\/\/(www\.)?/, "").slice(0, 30);
        
        if (pageText.toLowerCase().includes(checkSubstring)) {
          console.log(`   ⏭️ Work sample "${urlCleaned}" already exists on profile, skipping.`);
          continue;
        }

        console.log(`   🔗 Adding work sample link: ${urlCleaned} (using ${ws.chip_id || "to_add_portfolio"})`);
        const workSamplesBtn = page.locator("#work-modal").first();
        if (await workSamplesBtn.count() && await workSamplesBtn.isVisible()) {
          await workSamplesBtn.scrollIntoViewIfNeeded();
          await workSamplesBtn.click();
          await page.waitForTimeout(1500);

          const chipSelector = `#${ws.chip_id || "to_add_portfolio"}`;
          const chip = page.locator(chipSelector).first();
          if (await chip.count() && await chip.isVisible()) {
            await chip.click();
            await page.waitForTimeout(1500);

            const linkInput = page.locator("#work-sample-single-modal #link").first();
            if (await linkInput.count() && await linkInput.isVisible()) {
              await linkInput.fill(urlCleaned);
              await page.waitForTimeout(1000);

              await page.locator("#work-sample-single-modal #work-sample-submit").click();
              await page.waitForTimeout(3000);

              console.log("      ✅ Saved successfully! Reloading page to clear modals...");
              await page.reload({ waitUntil: "load" });
              await page.waitForTimeout(2000);
            }
          } else {
            console.log(`   ⚠️ Chip selector "${chipSelector}" not found or visible in work samples modal. Reloading page...`);
            await page.reload({ waitUntil: "load" });
            await page.waitForTimeout(2000);
          }
        }
      } catch (err) {
        await handleErrorAndReset(err.message);
      }
    }
  }

  console.log("\n🎉 Internshala profile building automation complete!");
  process.exit(0);
})();

/**
 * Call OpenAI to structure the raw resume text into Internshala profile data schema
 */
async function extractProfileData(resumeText, apiKey, model) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey });

  const prompt = `
You are a career assistant. Read the resume below and extract all details needed to fill an Internshala profile.
Extract the following information:
1. "first_name": "First name of the candidate (e.g. 'Mohammed Mubeen' from 'Mohammed Mubeen Dalvi')"
2. "last_name": "Last name/surname of the candidate (e.g. 'Dalvi')"
3. "phone": "Clean phone number digits including country code if any (e.g. '97439905907' or '7400239134')"
4. "education": Array of graduation/schooling details. Each should have:
   - "type": "graduation" | "post_graduation" | "diploma" | "xii" | "x"
   - "college_school": "Name of college/university (for graduation/diploma) OR the actual high school institution name (NOT board name) for xii/x. If only a board/city is mentioned without a school name, use an empty string."
   - "degree": "Standard abbreviated degree name EXACTLY as used on Internshala (e.g. 'B.E.', 'B.Tech', 'B.Sc.', 'B.Com', 'B.B.A. / B.M.S.', 'BCA', 'B.Arch', 'MBA', 'M.Tech', 'M.Sc.', 'M.Com'). For Bachelor of Management Studies use 'B.B.A. / B.M.S.'. For Bachelor of Business Administration use 'B.B.A. / B.M.S.'. DO NOT write full degree names. Omit for xii/x."
   - "stream": "Academic stream short form (e.g. 'Management Studies', 'Computer Science', 'Science', 'Commerce', 'Arts'). Omit for xii/x."
   - "board": "For xii/x ONLY — examination board name as it appears on Internshala (e.g. 'Maharashtra State Board', 'CBSE', 'ICSE', 'IGCSE', 'IB'). Leave empty for graduation/diploma."
   - "start_year": "YYYY (If missing in resume, estimate/guess a reasonable year based on overall timeline. DO NOT leave empty or null)"
   - "end_year": "YYYY (If missing in resume, estimate/guess a reasonable year based on overall timeline. For schooling, this is the year of completion. DO NOT leave empty or null)"
   - "performance": "Percentage or CGPA, e.g. 85% or 8.5/10"
5. "experience": Array of jobs/internships. Each should have:
   - "type": "job" | "internship"
   - "designation": "Exact designation/role name from the resume, e.g., Digital Content Creator - Event Project"
   - "profile": "Closest standard Internshala profile category (must choose one of: 'Social Media Marketing', 'Digital Marketing', 'Content Writing', 'Graphic Design', 'Video Making/Editing', 'Marketing', 'Search Engine Optimization (SEO)', 'Web Development', 'Business Development', 'Software Development', 'Public Relations (PR)', 'Event Management')"
   - "organization": "Company name"
   - "location": "City name, or 'Work from home'"
   - "start_month_year": "Start month and year, e.g., 'Feb 2024'"
   - "end_month_year": "End month and year, e.g., 'May 2025' or 'Present'"
   - "description": "Short description of duties (max 100 words)"
6. "projects": Array of projects. Each should have:
   - "title": "Project Title"
   - "start_month_year": "Start month and year, e.g., 'Feb 2024' (estimate/guess if missing in resume)"
   - "end_month_year": "End month and year, e.g., 'May 2025' or 'Present' (estimate/guess if missing)"
   - "link": "Project Link (if any, else empty)"
   - "description": "Description of project (max 100 words)"
7. "skills": Array of strings. ALWAYS generate at least 15 highly relevant skills (and up to 25) that will help the user get a job. Make sure to map these skills to standard Internshala skill names so they match Internshala's autocomplete database (for example, instead of 'CapCut' or 'Clipchamp', use 'Video Editing' or 'Video Making'; instead of 'SEMrush', use 'Search Engine Optimization (SEO)'; instead of 'Meta Business Suite', use 'Social Media Marketing'; instead of 'Team Coordination', use 'Team Management'; instead of 'Analytics Reporting', use 'Web Analytics' or 'Google Analytics'). Suggest and include standard, sought-after industry skills in their domain if fewer than 15 skills are explicitly mentioned in the resume, to ensure the array has AT LEAST 15 total skills. Do not exceed 25 skills.
8. "linkedin_link": "The LinkedIn profile URL if found in the resume, e.g. 'https://www.linkedin.com/in/username'. If not found, use empty string."
9. "work_samples": Array of objects. Extract ALL links found in the resume INCLUDING LinkedIn. Each object must have:
   - "url": "Full absolute URL, e.g. 'https://github.com/username' or 'https://www.behance.net/username'"
   - "chip_id": "The ID of the matching chip on Internshala. Map the URL domain to one of the following exact string values:
     * If URL contains 'linkedin.com' -> 'to_add_portfolio'
     * If URL contains 'github.com' -> 'to_add_github'
     * If URL contains 'behance' -> 'to_add_behance'
     * If URL contains 'canva' -> 'to_add_canva'
     * If URL contains 'figma' -> 'to_add_figma'
     * If URL contains 'dribbble' -> 'to_add_dribbble'
     * If URL contains 'medium' -> 'to_add_medium'
     * If URL contains 'wordpress' -> 'to_add_wordpress'
     * If URL contains 'wix' or 'wixsite' -> 'to_add_wixsite'
     * If URL contains 'blogspot' -> 'to_add_blogspot'
     * If URL contains 'blog' -> 'to_add_blog'
     * If URL contains 'leetcode' -> 'to_add_leetcode'
     * If URL contains 'hackerrank' -> 'to_add_hackerrank'
     * If URL contains 'kaggle' -> 'to_add_kaggle'
     * If URL contains 'codechef' -> 'to_add_codechef'
     * If URL contains 'bitbucket' -> 'to_add_bitbucket'
     * If URL contains 'notion' -> 'to_add_notion'
     * If URL contains 'substack' -> 'to_add_substack'
     * If URL contains 'tumblr' -> 'to_add_tumblr'
     * If URL contains 'quora' -> 'to_add_quora'
     * For all other domains (e.g. twitter.com, x.com, instagram.com, facebook.com, youtube.com, or custom personal websites/portfolios) -> 'to_add_portfolio'"

Respond with ONLY valid JSON matching this schema:
{
  "first_name": "",
  "last_name": "",
  "phone": "",
  "education": [
    {
      "type": "graduation",
      "college_school": "",
      "degree": "",
      "stream": "",
      "board": "",
      "start_year": "",
      "end_year": "",
      "performance": ""
    }
  ],
  "experience": [],
  "projects": [],
  "skills": [],
  "linkedin_link": "",
  "work_samples": []
}

RESUME:
${resumeText.slice(0, 4000)}
`.trim();

  const tokenParam = model.startsWith("gpt-5") || model.startsWith("o")
    ? { max_completion_tokens: 2000 }
    : { max_tokens: 2000 };

  const requestParams = {
    model,
    messages: [{ role: "user", content: prompt }],
    ...tokenParam
  };
  if (!model.startsWith("gpt-5") && !model.startsWith("o")) {
    requestParams.temperature = 0.2;
  }
  const resp = await client.chat.completions.create(requestParams);

  const raw = resp.choices[0].message.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not find valid JSON block in OpenAI response");
  }
  return JSON.parse(jsonMatch[0]);
}
