process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT ERROR:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED PROMISE:", err);
});

require("dotenv").config();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname));

const LINE_ACCESS_TOKEN = (process.env.LINE_ACCESS_TOKEN || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim().replace(/\/$/, "");

// ==========================
// 📁 Upload Image Storage
// ==========================
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();

    const safeName =
      Date.now() +
      "-" +
      Math.random().toString(36).substring(2, 8) +
      ext;

    cb(null, safeName);
  },
});

const upload = multer({ storage });
app.use("/uploads", express.static(uploadDir));

// ==========================
// 📤 Upload Image API
// ==========================
app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const imageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

/* ========================= โหลด keyword ========================= */

let keywordCache = [];

function loadKeywords() {
  try {
    const raw = fs.readFileSync("./keywordReplies.json", "utf8");
    keywordCache = JSON.parse(raw);
    console.log("🔄 Keyword reloaded");
  } catch (err) {
    console.error("โหลด keywordReplies.json ไม่ได้:", err.message);
    keywordCache = [];
  }
}

loadKeywords();

/* ========================= API: โหลด keyword ========================= */
app.get("/api/keywords", (req, res) => {
  res.json(keywordCache);
});

/* ========================= API: บันทึก keyword ========================= */
app.post("/api/keywords", (req, res) => {
  try {
    const data = req.body;

    fs.writeFileSync(
      "./keywordReplies.json",
      JSON.stringify(data, null, 2),
      "utf8"
    );

    loadKeywords(); // ⭐ reload ทันที

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================= API: Reload manual ========================= */
app.post("/reload-keyword", (req, res) => {
  loadKeywords();
  res.json({ ok: true });
});

/* ========================= แปลงข้อความให้เทียบง่าย ========================= */

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\wก-๙%]/g, "");
}

/* ========================= keyword matching ========================= */

function findKeywordReply(message) {
  const raw = message.toLowerCase().trim();
  const msg = normalize(message);

  const exact = [];
  const partial = [];

  for (const item of keywordCache) {
    for (const keyword of item.keywords) {
      const kRaw = keyword.toLowerCase().trim();
      const k = normalize(keyword);
      exact.push({ kRaw, k, item });
      partial.push({ kRaw, k, item });
    }
  }

  /* ===== EXACT ===== */
  for (const obj of exact) {
    if (raw === obj.kRaw || msg === obj.k) {
      return obj.item;
    }
  }

  /* ===== PARTIAL ===== */
  partial.sort((a, b) => b.k.length - a.k.length);
  for (const obj of partial) {
    if (msg.includes(obj.k)) {
      return obj.item;
    }
  }

  return null;
}

/* ========================= Gemini ========================= */

// 1️⃣ อ่านไฟล์ครั้งเดียวตอนเริ่มระบบ
let scriptData = "";
try {
  scriptData = fs.readFileSync("./ScriptPG.md", "utf8");
} catch {
  console.error("ScriptPG.md not found");
}

// 2️⃣ แยกฐานข้อมูลเป็นหมวดตาม [หัวข้อ]
function parseSections(text) {
  const sections = {};
  const parts = text.split(/\[(.*?)\]/g);

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim();
    const content = parts[i + 1]?.trim() || "";
    sections[title] = content;
  }

  return sections;
}

// 3️⃣ สร้าง knowledgeSections
const knowledgeSections = parseSections(scriptData);

// 4️⃣ หา section ที่เหมาะสมที่สุด
function findBestSection(question) {
  const cleanQuestion = question.replace(/\s+/g, "");

  let bestScore = 0;
  let bestContent = null;

  for (const [title, content] of Object.entries(knowledgeSections)) {
    let score = 0;

    const cleanTitle = title.replace(/\s+/g, "");
    const cleanContent = content.replace(/\s+/g, "");

    // ✅ ให้คะแนนชื่อหัวข้อแรงมาก
    if (cleanQuestion.includes(cleanTitle)) {
      score += 20;
    }

    // ✅ ถ้าคำถามมีคำว่า สมัคร และหัวข้อคือ สมัคร
    if (cleanTitle.includes("สมัคร") && cleanQuestion.includes("สมัคร")) {
      score += 30;
    }

    // ให้คะแนนเนื้อหาเบากว่า
    if (cleanContent.includes(cleanQuestion)) {
      score += 5;
    }

    // chunk match เบาลง
    for (let i = 0; i < cleanQuestion.length - 2; i++) {
      const chunk = cleanQuestion.substring(i, i + 3);
      if (cleanContent.includes(chunk)) {
        score += 0.5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestContent = content;
    }
  }

  if (bestScore <= 5) return null;

  return bestContent;
}

// 5️⃣ เรียก Gemini
async function askGemini(userMessage) {
  try {
    const filteredSection = findBestSection(userMessage);

    console.log("=== SECTION SENT TO GEMINI ===");
    console.log(filteredSection);
    console.log("================================");
    console.log("Filtered Section:", filteredSection ? "FOUND" : "NOT FOUND");

    if (!filteredSection) return null;

    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "ให้ตอบโดยใช้ข้อมูลจากฐานข้อมูลเท่านั้น ห้ามเดา ห้ามแต่งเพิ่ม " +
                  "ให้ตอบเป็นภาษาไทยเท่านั้น ห้ามใช้ภาษาอังกฤษ ห้ามคิดเอง " +
                  "ตอบเฉพาะข้อความจากฐานข้อมูล ตรงประเด็น กระชับ " +
                  "ถ้ามีคำตอบให้ตอบลงท้ายด้วยค่ะทุกครั้ง " +
                  "ให้เลือกข้อความจากฐานข้อมูลที่มีความหมายตรงกับคำถาม แม้ถ้อยคำจะไม่ตรงกันทุกคำ " +
                  "ห้ามแต่งเพิ่ม ห้ามสรุปเอง ให้คัดลอกประโยคจากฐานข้อมูลเท่านั้น " +
                  "ถ้าไม่มีข้อมูลที่เกี่ยวข้องจริง ๆ จริง ๆ เท่านั้น ให้ตอบคำว่า NO_DATA \n\n"+
                  "===== ฐานข้อมูล =====\n" +
                  filteredSection +
                  "\n\n===== คำถาม =====\n" +
                  userMessage,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 400,
          topP: 0,
          topK: 1,
        },
      }
    );

    const reply =
      res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    console.log("Gemini RAW Reply:", reply);

    if (!reply || reply === "NO_DATA") {
      return null;
    }

    return reply;
  } catch (err) {
    console.error("Gemini error:", err.response?.data || err.message);
    return null;
  }  
}

module.exports = { askGemini };

/* ========================= LINE Webhook ========================= */

app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.send("OK");

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userMessage = event.message.text;
    console.log("USER:", userMessage);

    let replyText = null;
    let replyImage = null;

    /* ===== 1. keyword ก่อน ===== */
    const keywordReply = findKeywordReply(userMessage);
    if (keywordReply) {
      replyText = keywordReply.reply;
      replyImage = keywordReply.image || null;
    }

    /* ===== 2. AI ===== */
    if (!replyText) {
      const aiReply = await askGemini(userMessage);
      if (aiReply) replyText = aiReply;
    }

    if (!replyText) continue;

    try {
      const messages = [];

      if (replyText) {
        messages.push({ type: "text", text: replyText });
      }

      if (replyImage) {
        const toFullUrl = (url) => {
          if (!url) return null;

          // ถ้าเป็น http → บังคับ https
          if (url.startsWith("http://")) {
            return url.replace("http://", "https://");
          }

          // ถ้าเป็น /uploads → ต่อ PUBLIC_URL
          if (url.startsWith("/uploads")) {
            return `${PUBLIC_URL}${url}`;
          }

          // ถ้ายังไม่ใช่ https → ถือว่าใช้ไม่ได้
          if (!url.startsWith("https://")) {
            return null;
          }

          return url;
        };

        if (Array.isArray(replyImage)) {
          replyImage.forEach((img) => {
            const fullUrl = toFullUrl(img);
            if (!fullUrl) return;

            messages.push({
              type: "image",
              originalContentUrl: fullUrl,
              previewImageUrl: fullUrl,
            });
          });
        } else {
          const fullUrl = toFullUrl(replyImage);
          if (fullUrl) {
            messages.push({
              type: "image",
              originalContentUrl: fullUrl,
              previewImageUrl: fullUrl,
            });
          }
        }
      }


      if (messages.length === 0) continue;

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (err) {
      console.error("LINE ERROR:", err.response?.data || err.message);
    }
  }

  res.send("OK");
});

/* ========================= Start Server ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server running on port", PORT);
});
