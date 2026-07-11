const mongoose = require("mongoose");

const blockSchema = new mongoose.Schema({
  blockerPhone: { type: String, required: true }, // recipient
  blockedPhone: { type: String, required: true }, // sender
  createdAt: { type: Date, default: Date.now }
});

// Avoid duplicate blocks
blockSchema.index({ blockerPhone: 1, blockedPhone: 1 }, { unique: true });

module.exports = mongoose.model("Block", blockSchema);
