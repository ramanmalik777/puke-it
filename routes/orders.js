const express = require("express");
const Order = require("../models/order");
const Block = require("../models/Block");
const OptOut = require("../models/OptOut");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const router = express.Router();

const OLLAMA_URL = "http://localhost:11434";
const OLLAMA_MODELS = ["qwen2.5:1.5b", "gemma4:e2b"];

// Initialize Google Generative AI if key is present
let genAI = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  console.log("🤖 Gemini API initialized for cloud fallback.");
}

// Dynamic local model auto-detector with 1200ms timeout threshold
async function getOllamaModel() {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(id);
    if (res.ok) {
      const data = await res.json();
      for (const modelName of OLLAMA_MODELS) {
        if (data.models.some(m => m.name === modelName || m.name.startsWith(modelName))) {
          return modelName;
        }
      }
    }
  } catch (err) {
    // Ollama is offline
  }
  return null;
}

// Generate unique custom keys (e.g. PK-8X4F2A or ORD-7F91K2)
async function generateUniqueId(prefix) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let uniqueId = "";
  let isUnique = false;

  while (!isUnique) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    uniqueId = `${prefix}-${code}`;

    const query = prefix === "PK" ? { pukeCode: uniqueId } : { orderId: uniqueId };
    const existing = await Order.findOne(query);
    if (!existing) {
      isUnique = true;
    }
  }
  return uniqueId;
}

// AI Message Shortening Endpoint
router.post("/shorten", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ message: "Message is required" });

  const localShorten = (text) => {
    let shortened = text.trim();
    shortened = shortened
      .replace(/I've been wanting to tell you for a very long time that/gi, "I've wanted to say this for a long time:")
      .replace(/I have been wanting to tell you for a very long time that/gi, "I've wanted to say this for a long time:")
      .replace(/I just wanted to let you know that/gi, "I want to say:")
      .replace(/really really|really/gi, "really")
      .replace(/hope you are doing well and/gi, "")
      .replace(/I am writing this because/gi, "")
      .replace(/to be completely honest with you/gi, "honestly")
      .replace(/for what it's worth/gi, "anyway")
      .replace(/at the end of the day/gi, "ultimately")
      .replace(/without further ado/gi, "");

    if (shortened === text.trim() && text.length > 50) {
      const sentences = text.split(/[.!?]+/);
      const result = sentences
        .map(s => s.trim().replace(/^(actually|so|basically|well|honestly|literally|seriously),?\s+/i, ""))
        .filter(s => s.length > 0)
        .join(". ");
      shortened = result + ".";
    }

    if (shortened.length >= text.length) {
      shortened = text.substring(0, Math.floor(text.length * 0.75)) + "...";
    }
    return shortened;
  };

  const activeModel = await getOllamaModel();
  if (activeModel) {
    try {
      console.log(`🤖 Routing shortening query to local Ollama (${activeModel})...`);
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: activeModel,
          prompt: `You are PUKE IT AI. Shorten the following message so it is extremely concise and fits on a real physical orange. 
Each orange fits 28 characters of handwriting. Keep it under 28 characters if possible, or make it as short as possible.
Preserve the core emotional message, facts, and tone.
Do not add quotes, introductory text, or explanations. Only return the shortened message text.

Original message: "${message}"`,
          stream: false
        })
      });
      const data = await response.json();
      const text = data.response.trim().replace(/^["']|["']$/g, "");
      if (text && text.length < message.length) {
        return res.json({ original: message, shortened: text });
      }
    } catch (err) {
      console.error("Local Ollama Shorten Error:", err.message);
    }
  }

  // Cloud Gemini API fallback
  if (genAI) {
    try {
      console.log("☁️ Routing shortening query to Gemini Cloud API...");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `You are PUKE IT AI. Shorten the following message so it is concise and fits on a real physical orange. 
Each orange fits 28 characters of handwriting. Keep it under 28 characters if possible, or make it as short as possible.
Preserve the core emotional message, facts, and tone.
Do not add quotes, introductory text, or explanations. Only return the shortened message text.

Original message: "${message}"`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim().replace(/^["']|["']$/g, "");
      if (text && text.length < message.length) {
        return res.json({ original: message, shortened: text });
      }
    } catch (err) {
      console.error("Gemini Cloud Shorten Error:", err.message);
    }
  }

  // Local heuristic fallback
  res.json({ original: message, shortened: localShorten(message) });
});

// Puke AI Companion Chat Endpoint
router.post("/puke-ai", async (req, res) => {
  const { message: userMsg, history } = req.body;
  if (!userMsg) return res.status(400).json({ message: "Message is required" });

  const localFallbackChat = (text) => {
    const t = text.toLowerCase();
    
    if (/suicid|kill myself|end my life|self harm|hurt myself/.test(t))
      return "I’m really sorry you’re carrying this. I’m not equipped for a crisis, and I don’t want you to face immediate danger alone. Please contact local emergency help or a trusted person near you right now.";
    if (/lonely|alone|nobody|no one/.test(t))
      return "It sounds like the loneliness is the part weighing on you most. Is this about missing one particular person, or feeling disconnected from everyone lately?";
    if (/love|crush|like him|like her|like them/.test(t))
      return "There’s a lot of feeling behind that. What are you most afraid would happen if you said it directly—rejection, awkwardness, or changing the relationship?";
    if (/sorry|apolog|regret|guilt/.test(t))
      return "You sound like you’re carrying guilt or regret. If you could say one honest sentence to that person without defending yourself, what would it be?";
    if (/angry|hate|furious|mad|betray/.test(t))
      return "I can hear the anger in that. What hurt underneath the anger most—what they did, or that they never understood the impact?";
    if (/sad|cry|hurt|broken|depress/.test(t))
      return "That sounds genuinely heavy. I don’t want to give you a generic 'cheer up.' What happened that made today feel especially difficult?";
    
    const prompts = [
      "I’m listening. What happened right before you started feeling this way?",
      "You don’t have to make it sound neat here. What is the part you haven’t been able to say out loud yet?",
      "If I understand you correctly, this has been sitting with you for a while. What hurts or bothers you most about it?",
      "Let’s slow it down. If you had to reduce everything you just said to one completely honest sentence, what would that sentence be?"
    ];
    return prompts[Math.floor(Math.random() * prompts.length)];
  };

  const activeModel = await getOllamaModel();
  if (activeModel) {
    try {
      console.log(`🤖 Routing chat query to local Ollama (${activeModel})...`);
      
      const systemPrompt = `You are Puke AI, an anonymous, raw, and empathetic listening companion. You listen to things people are afraid or unable to say directly. Your style is direct, streetwear-inspired, and emotionally grounded. Keep responses short (1-3 sentences). Do not use lists or bullet points. Guide the user to unpack their feelings. 
If they share a confession or strong feeling, suggest they turn this message into a physical orange delivery via Puke It. Do not repeat warnings about professional mental health care unless they are in self-harm crisis.`;

      const messages = [{ role: "system", content: systemPrompt }];
      
      if (history && history.length > 0) {
        history.forEach(h => {
          messages.push({
            role: h.role === "model" ? "assistant" : "user",
            content: h.parts[0].text
          });
        });
      }
      
      // Push new user message
      messages.push({ role: "user", content: userMsg });

      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: activeModel,
          messages,
          stream: false
        })
      });
      
      const data = await response.json();
      const text = data.message.content.trim();
      if (text) {
        return res.json({ response: text });
      }
    } catch (err) {
      console.error("Local Ollama Chat Error:", err.message);
    }
  }

  // Cloud Gemini API fallback
  if (genAI) {
    try {
      console.log("☁️ Routing chat query to Gemini Cloud API...");
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: `You are Puke AI, an anonymous, raw, and empathetic listening companion. You listen to things people are afraid or unable to say directly. Your style is direct, streetwear-inspired, and emotionally grounded. Keep responses short (1-3 sentences). Do not use lists or bullet points. Guide the user to unpack their feelings. 
If they share a confession or strong feeling, suggest they turn this message into a physical orange delivery via Puke It. Do not repeat warnings about professional mental health care unless they are in self-harm crisis.`
      });

      let contents = [];
      if (history && history.length > 0) {
        contents = history.map(h => ({
          role: h.role === "model" ? "model" : "user",
          parts: [{ text: h.parts[0].text }]
        }));
      }
      contents.push({ role: "user", parts: [{ text: userMsg }] });

      const result = await model.generateContent({ contents });
      const response = await result.response;
      const responseText = response.text().trim();
      
      if (responseText) {
        return res.json({ response: responseText });
      }
    } catch (err) {
      console.error("Gemini Cloud Chat Error:", err.message);
    }
  }

  // Return local rule-based response
  res.json({ response: localFallbackChat(userMsg) });
});

// Create Order (Send a Puke)
router.post("/", async (req, res) => {
  try {
    const { sender, recipient, message, parentPukeCode } = req.body;

    if (!sender || !recipient || !message) {
      return res.status(400).json({ message: "Missing required order fields" });
    }

    const cleanSenderPhone = sender.phone.replace(/\D/g, "");
    const cleanRecipientPhone = recipient.phone.replace(/\D/g, "");

    // 1. Opt-out check (Suppression List)
    const optedOut = await OptOut.findOne({ phone: cleanRecipientPhone });
    if (optedOut) {
      return res.status(400).json({ 
        message: "We can't process this delivery. The recipient has opted out of all future Pukes." 
      });
    }

    // 2. Block check (silent rejection representation)
    const isBlocked = await Block.findOne({ 
      blockerPhone: cleanRecipientPhone, 
      blockedPhone: cleanSenderPhone 
    });
    if (isBlocked) {
      return res.status(400).json({ 
        message: "We can't process this delivery." 
      });
    }

    // 3. Puke Fit calculation
    const msgLen = message.trim().length;
    const CAPACITY = 28;
    const orangesCount = Math.max(1, Math.ceil(msgLen / CAPACITY));
    
    // Pricing: ₹199 (1st), +₹49 (2nd), +₹29 (additional)
    let price = 199;
    if (orangesCount === 2) {
      price = 199 + 49;
    } else if (orangesCount > 2) {
      price = 199 + 49 + (orangesCount - 2) * 29;
    }

    // 4. Simulated automated safety check
    let safetyScore = Math.floor(Math.random() * 20) + 5; // default 5-25%
    let flaggedReason = "";
    let moderationStatus = "approved";

    const textToModerate = message.toLowerCase();
    const safetyKeywords = {
      harassment: ["loser", "idiot", "destroy you", "kill you", "die", "bastard", "hate you"],
      personal_info: ["aadhaar", "passport", "pan card", "social security"],
      dangerous: ["bomb", "attack", "acid", "weapon", "shoot"],
      threat: ["warn you", "watch out", "know where you live", "better sleep with", "pay for this"]
    };

    for (const [category, keywords] of Object.entries(safetyKeywords)) {
      for (const keyword of keywords) {
        if (textToModerate.includes(keyword)) {
          safetyScore = Math.floor(Math.random() * 25) + 70; // 70-95%
          flaggedReason = `POSSIBLE_${category.toUpperCase()}`;
          moderationStatus = "pending";
          break;
        }
      }
      if (flaggedReason) break;
    }

    // Generate keys
    const pukeCode = await generateUniqueId("PK");
    const orderId = await generateUniqueId("ORD");

    // Handle swap addresses if Puke Back reply is active
    let finalRecipient = { ...recipient };
    if (parentPukeCode) {
      const originalOrder = await Order.findOne({ pukeCode: parentPukeCode.toUpperCase() });
      if (originalOrder) {
        // Swap recipient to be the original sender!
        finalRecipient = {
          name: originalOrder.sender.name,
          phone: originalOrder.sender.phone,
          house: originalOrder.sender.address,
          street: originalOrder.sender.address,
          city: "Secure Route",
          state: "Secure Route",
          pin: "000000",
          instructions: "Secure return delivery"
        };
      }
    }

    // Save to Database
    const order = new Order({
      orderId,
      pukeCode,
      sender,
      recipient: finalRecipient,
      message,
      orangesCount,
      price,
      status: "placed",
      safetyScore,
      moderationStatus,
      flaggedReason,
      parentPukeCode: parentPukeCode || null
    });

    await order.save();

    res.json({
      success: true,
      orderId: order.orderId,
      pukeCode: order.pukeCode,
      price: order.price,
      orangesCount: order.orangesCount,
      moderationStatus: order.moderationStatus
    });
  } catch (err) {
    res.status(500).json({ message: "Server error during order submission", error: err.message });
  }
});

// Track Order by Private Order ID
router.get("/track/:orderId", async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId.toUpperCase() });
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json({
      orderId: order.orderId,
      status: order.status,
      orangesCount: order.orangesCount,
      price: order.price,
      createdAt: order.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: "Server error during tracking lookup", error: err.message });
  }
});

// Got Puked: Find connection details by Puke Code
router.get("/got-puked/:pukeCode", async (req, res) => {
  try {
    const order = await Order.findOne({ pukeCode: req.params.pukeCode.toUpperCase() });
    if (!order) return res.status(404).json({ message: "Invalid Puke Code" });

    res.json({
      pukeCode: order.pukeCode,
      found: true,
      parentPukeCode: order.parentPukeCode
    });
  } catch (err) {
    res.status(500).json({ message: "Server error during code verification", error: err.message });
  }
});

module.exports = router;