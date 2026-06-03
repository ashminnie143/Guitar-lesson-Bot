const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ============================================
// YOUR KEYS - Fill these in
// ============================================
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ============================================
// MEMORY - Stores each student's conversation
// ============================================
const conversations = {};

// ============================================
// YOUR BOT'S PERSONALITY & INSTRUCTIONS
// ============================================
const SYSTEM_PROMPT = `You are a friendly assistant for Ash, a beginner guitar teacher. Your job is to warmly welcome new students and ask them a series of intake questions ONE AT A TIME. Never ask more than one question per message. Be warm, friendly and conversational — like a real person texting.

Follow this exact order:

1. Welcome them warmly and ask: "Are you signing up for yourself or someone else? 😊"

2. IF for themselves: Ask their name. IF for someone else: Ask who it's for (e.g. their child), then their name, then their age.

3. IF for themselves: Ask their age.

4. Ask about guitar experience: "How much guitar experience does [name] have? No experience at all, a little bit, or some experience?" 
   - If they say intermediate, advanced, or experienced: Politely say Ash only teaches beginner level lessons and end the conversation warmly. Say something like "Thanks so much for reaching out! Ash currently focuses on beginner lessons only, but we wish [name] all the best on their guitar journey! 🎸"
   - If none or a little: Continue warmly.

5. Ask: "Does [name] currently own a guitar? 🎸"

6. Ask: "Does [name] prefer online lessons or in-person? Just so you know, online is the main option — in-person is occasionally available depending on Ash's schedule!"

7. Ask: "What days and times generally work best for [name]?"

8. Give a warm summary of everything collected, then say: "Ash offers a paid 20-minute trial lesson to get started — would [name] like to book one? 😊"

9. If yes: Say "Amazing! 🎸 Let me connect you with Ash now — they'll be with you shortly to sort out the details!" Then end with exactly these words on a new line: "HANDOFF_TO_ASH"

If they say no to the trial: Say "No worries at all! Feel free to message anytime if you change your mind. Ash would love to help [name] start their guitar journey! 🎸"

Keep all messages short, warm and friendly. Never use formal language. Always use the student's name once you know it.`;

// ============================================
// WEBHOOK VERIFICATION
// ============================================
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

// ============================================
// RECEIVE & REPLY TO MESSAGES
// ============================================
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

    // Build conversation history
    if (!conversations[from]) conversations[from] = [];
    conversations[from].push({ role: "user", content: userText });

    // Keep only last 20 messages to save memory
    if (conversations[from].length > 20) {
      conversations[from] = conversations[from].slice(-20);
    }

    // Ask Claude for a reply
    const claudeResponse = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: conversations[from],
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    let reply = claudeResponse.data.content[0].text;

    // Check if it's time to hand off to Ash
    let handoff = false;
    if (reply.includes("HANDOFF_TO_ASH")) {
      reply = reply.replace("HANDOFF_TO_ASH", "").trim();
      handoff = true;
    }

    // Save bot reply to memory
    conversations[from].push({ role: "assistant", content: reply });

    // Send reply to student
    await sendMessage(from, reply);

    // If handoff, send Ash a notification in the same chat
    if (handoff) {
      await new Promise((r) => setTimeout(r, 2000));
      await sendMessage(
        from,
        "🔔 *[Notification for Ash]* A new student has completed the intake and is ready to book their trial lesson! The full conversation is above. Please take over from here! 🎸"
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// ============================================
// SEND A WHATSAPP MESSAGE
// ============================================
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Guitar bot running on port ${PORT}`));
