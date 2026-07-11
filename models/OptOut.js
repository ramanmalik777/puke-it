const mongoose = require("mongoose");

const optOutSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("OptOut", optOutSchema);
