const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, required: true },
  pukeCode: { type: String, unique: true, required: true },
  sender: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String, required: true }
  },
  recipient: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    house: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pin: { type: String, required: true },
    instructions: { type: String, default: "" }
  },
  message: { type: String, required: true },
  orangesCount: { type: Number, required: true },
  price: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ["placed", "preparing", "dispatched", "delivered", "waiting", "puked_back"], 
    default: "placed" 
  },
  safetyScore: { type: Number, default: 0 },
  moderationStatus: { 
    type: String, 
    enum: ["pending", "approved", "rejected", "investigate"], 
    default: "pending" 
  },
  flaggedReason: { type: String, default: "" },
  parentPukeCode: { type: String, default: null },
  paymentScreenshotUrl: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Order", orderSchema);
