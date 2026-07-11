const express = require("express");
const Order = require("../models/order");
const Block = require("../models/Block");
const Report = require("../models/Report");
const OptOut = require("../models/OptOut");

const router = express.Router();

// Report a Puke
router.post("/report", async (req, res) => {
  try {
    const { pukeCode, reason, description } = req.body;

    if (!pukeCode || !reason) {
      return res.status(400).json({ message: "Puke Code and reason are required" });
    }

    const order = await Order.findOne({ pukeCode: pukeCode.toUpperCase() });
    if (!order) {
      return res.status(404).json({ message: "Invalid Puke Code" });
    }

    const report = new Report({
      pukeCode: pukeCode.toUpperCase(),
      reason,
      description
    });

    await report.save();
    res.json({ success: true, message: "Report submitted successfully." });
  } catch (err) {
    res.status(500).json({ message: "Server error during report", error: err.message });
  }
});

// Block Sender of a Puke
router.post("/block", async (req, res) => {
  try {
    const { pukeCode } = req.body;

    if (!pukeCode) {
      return res.status(400).json({ message: "Puke Code is required" });
    }

    const order = await Order.findOne({ pukeCode: pukeCode.toUpperCase() });
    if (!order) {
      return res.status(404).json({ message: "Invalid Puke Code" });
    }

    const blockerPhone = order.recipient.phone.replace(/\D/g, "");
    const blockedPhone = order.sender.phone.replace(/\D/g, "");

    // Upsert block
    await Block.findOneAndUpdate(
      { blockerPhone, blockedPhone },
      { blockerPhone, blockedPhone },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Sender blocked successfully." });
  } catch (err) {
    res.status(500).json({ message: "Server error during block creation", error: err.message });
  }
});

// Opt out of all future deliveries
router.post("/opt-out", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const cleanPhone = phone.replace(/\D/g, "");

    // Upsert opt-out
    await OptOut.findOneAndUpdate(
      { phone: cleanPhone },
      { phone: cleanPhone },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Phone number successfully opted out from all future Pukes." });
  } catch (err) {
    res.status(500).json({ message: "Server error during opt-out processing", error: err.message });
  }
});

module.exports = router;
