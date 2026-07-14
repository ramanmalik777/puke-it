require("dotenv").config();

// Production Fallbacks for Render deployment
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecretkey123";
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || "ramsningh56812@gmail.com";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const path = require("path");
const User = require("./models/User");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 2000 })
  .then(() => {
    console.log("✅ MongoDB Connected");
    createAdmin();
  })
  .catch(err => {
    console.log("❌ MongoDB Connection failed (due to IP whitelist or server down).");
    console.log("⚠️ Activating resilient local JSON file-based database...");
    require("./dbFallback").patchMongoose();
    createAdmin();
  });

// Create Admin Automatically
async function createAdmin() {
  try {
    const existing = await User.findOne({ email: process.env.ADMIN_EMAIL });
    if (!existing) {
      const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await User.create({
        name: "Admin",
        email: process.env.ADMIN_EMAIL,
        password: hashed,
        role: "admin"
      });
      console.log("👑 Admin Created");
    } else {
      console.log("👑 Admin Already Exists");
    }
  } catch (err) {
    console.log("❌ Error creating admin:", err);
  }
}

// REST Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/shield", require("./routes/shield"));

// Serve Frontend Files
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Serve everything in the current directory as static files
app.use(express.static(__dirname));

// Socket.IO Real-Time Matchmaking Queue
const talkQueue = [];
const listenQueue = [];
const randomQueue = [];

const adjectives = ["SOUR", "SLEEPY", "LOST", "CHAOTIC", "MIDNIGHT", "ANGRY", "COSMIC", "SHY", "WILD", "LONELY"];
const fruits = ["ORANGE", "MANGO", "LEMON", "KIWI", "MELON", "APPLE", "GUAVA", "PEACH"];

function generateAnonName() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const fruit = fruits[Math.floor(Math.random() * fruits.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${adj} ${fruit} ${num}`;
}

io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);
  socket.anonName = generateAnonName();
  socket.roomId = null;
  socket.queueMode = null;

  // Join matchmaking queue
  socket.on("join_queue", ({ mode }) => {
    // Prevent double queueing
    if (socket.roomId || socket.queueMode) return;

    socket.queueMode = mode;
    console.log(`👤 ${socket.anonName} (${socket.id}) joined queue: ${mode}`);

    let matchedSocket = null;

    if (mode === "vent") {
      // Vent wants to talk -> Match with a listener first, then random
      if (listenQueue.length > 0) {
        matchedSocket = listenQueue.shift();
      } else if (randomQueue.length > 0) {
        matchedSocket = randomQueue.shift();
      } else {
        talkQueue.push(socket);
      }
    } else if (mode === "listen") {
      // Listener wants to listen -> Match with a venter first, then random
      if (talkQueue.length > 0) {
        matchedSocket = talkQueue.shift();
      } else if (randomQueue.length > 0) {
        matchedSocket = randomQueue.shift();
      } else {
        listenQueue.push(socket);
      }
    } else if (mode === "random") {
      // Random wants to match with anyone
      if (talkQueue.length > 0) {
        matchedSocket = talkQueue.shift();
      } else if (listenQueue.length > 0) {
        matchedSocket = listenQueue.shift();
      } else if (randomQueue.length > 0) {
        matchedSocket = randomQueue.shift();
      } else {
        randomQueue.push(socket);
      }
    }

    if (matchedSocket) {
      // Setup room
      const roomId = `room_${socket.id}_${matchedSocket.id}`;
      socket.roomId = roomId;
      matchedSocket.roomId = roomId;

      socket.queueMode = null;
      matchedSocket.queueMode = null;

      socket.join(roomId);
      matchedSocket.join(roomId);

      // Store partner references
      socket.partnerId = matchedSocket.id;
      matchedSocket.partnerId = socket.id;

      // Notify clients
      io.to(socket.id).emit("match_found", {
        roomId,
        yourName: socket.anonName,
        partnerName: matchedSocket.anonName
      });

      io.to(matchedSocket.id).emit("match_found", {
        roomId,
        yourName: matchedSocket.anonName,
        partnerName: socket.anonName
      });

      console.log(`🔗 Matched room: ${roomId} -> ${socket.anonName} + ${matchedSocket.anonName}`);
    } else {
      // Send temporary identity to let them know they are queueing
      socket.emit("queueing", { yourName: socket.anonName });
    }
  });

  // Handle message transfer
  socket.on("send_message", ({ text }) => {
    if (!socket.roomId) return;
    // Broadcast text to room
    io.to(socket.roomId).emit("message", {
      senderName: socket.anonName,
      senderId: socket.id,
      text
    });
  });

  // Handle leaving queue
  socket.on("leave_queue", () => {
    removeFromQueue(socket);
    socket.queueMode = null;
  });

  // Handle manual leave chat
  socket.on("leave_chat", () => {
    handleDisconnectOrLeave(socket);
  });

  // Handle client disconnect
  socket.on("disconnect", () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
    removeFromQueue(socket);
    handleDisconnectOrLeave(socket);
  });
});

function removeFromQueue(socket) {
  const indexTalk = talkQueue.indexOf(socket);
  if (indexTalk > -1) talkQueue.splice(indexTalk, 1);

  const indexListen = listenQueue.indexOf(socket);
  if (indexListen > -1) listenQueue.splice(indexListen, 1);

  const indexRandom = randomQueue.indexOf(socket);
  if (indexRandom > -1) randomQueue.splice(indexRandom, 1);
}

function handleDisconnectOrLeave(socket) {
  if (socket.roomId) {
    const roomId = socket.roomId;
    io.to(roomId).emit("partner_disconnected", {
      message: "Your chat partner disconnected."
    });
    
    // Make partner leave the socket room
    const partnerSocket = io.sockets.sockets.get(socket.partnerId);
    if (partnerSocket) {
      partnerSocket.leave(roomId);
      partnerSocket.roomId = null;
      partnerSocket.partnerId = null;
    }

    socket.leave(roomId);
    socket.roomId = null;
    socket.partnerId = null;
  }
}

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});