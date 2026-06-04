const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const conversations = {};

const SYSTEM_PROMPT = `You are a friendly assistant for Ash, a beginner guitar teacher. Your job is to warmly welcome new students and ask them intake questions ONE AT A TIME. Be warm, friendly and conversational.

Follow this order:
1. "Are you signing up for yourself or someone else? 😊"
2. If for themselves: ask name. If for someone else: ask who it's for, their name, their age.
3. If for themselves: ask age.
4. "How much guitar experience does [name] have? None, a little, or some?"
   - If intermediate+: "Thanks so much for reaching out! Ash currently focuses on beginner lessons only, but we wish [name] all the best on their guitar journey! 🎸"
   - If none or a little: continue
5. "Does [name] currently own a guitar? 🎸"
6. "Does [name] prefer online or in-person? Online is the main option — in-person is occasionally available!"
7. "What days and times work best for [name]?"
8. "Ash offers a paid 20-minute trial lesson — would [name] like to book one? 😊"
9. If yes: "Amazing! 🎸 Let me connect you with Ash now — they'll be with you shortly!" End with: HANDOFF_TO_ASH

Keep messages short, warm, friendly. Use the student's name once you know it.`;

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return res.sendStatus(404);

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== "text") return res.sendStatus(200);

    const from = message.from;
    const userText = message.text.body;

    console.log(`Message from ${from}: ${userText}`);

    if (!conversations[from]) conversations[from] = [];
    conversations[from].push({ role: "user", parts: [{ text: userText }] });

    if (conversations[from].length > 20) {
      conversations[from] = conversations[from].slice(-20);
    }

    const geminiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: conversations[from],
        generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
      },
      { headers: { "Content-Type": "application/json" } }
    );

    let reply = geminiResponse.data.candidates[0].content.parts[0].text;

    conversations[from].push({ role: "model", parts: [{ text: reply }] });

    let handoff = false;
    if (reply.includes("HANDOFF_TO_ASH")) {
      reply = reply.replace("HANDOFF_TO_ASH", "").trim();
      handoff = true;
    }

    await sendMessage(from, reply);

    if (handoff) {
      await new Promise((r) => setTimeout(r, 2000));
      await sendMessage(
        from,
        "🔔 *[Notification for Ash]* A new student has completed intake and is ready to book! Full conversation above. Take over from here! 🎸"
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Guitar bot running on port ${PORT}`));
