const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  pukeCode: { type: String, required: true },
  reason: { type: String, required: true },
  description: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Report", reportSchema);
