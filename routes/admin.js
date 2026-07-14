const express = require("express");
const Order = require("../models/order");
const Report = require("../models/Report");
const User = require("../models/User");
const auth = require("../middleware/auth");

const router = express.Router();

// Helper middleware to ensure user is an admin
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Access denied. Admin role required." });
  }
  next();
}

// Admin dashboard statistics
router.get("/stats", auth, requireAdmin, async (req, res) => {
  try {
    const totalPukes = await Order.countDocuments();
    const ordersResult = await Order.aggregate([
      { $group: { _id: null, totalRevenue: { $sum: "$price" } } }
    ]);
    const revenue = ordersResult.length > 0 ? ordersResult[0].totalRevenue : 0;

    const pukeBackCount = await Order.countDocuments({ parentPukeCode: { $ne: null } });
    const pukeBackRate = totalPukes > 0 ? ((pukeBackCount / totalPukes) * 100).toFixed(1) : "0.0";

    const flaggedCount = await Order.countDocuments({ 
      moderationStatus: { $in: ["pending", "investigate"] },
      safetyScore: { $gte: 50 }
    });
    const totalSignups = await User.countDocuments();

    res.json({
      totalPukes,
      revenue,
      pukeBackCount,
      pukeBackRate: `${pukeBackRate}%`,
      flaggedCount,
      totalSignups,
      activeChatUsers: Math.floor(Math.random() * 15) + 8 // Demo real-time active users
    });
  } catch (err) {
    res.status(500).json({ message: "Server error fetching stats", error: err.message });
  }
});

// Get all orders for moderation / management
router.get("/orders", auth, requireAdmin, async (req, res) => {
  try {
    const { status, moderation } = req.query;
    const query = {};

    if (status) query.status = status;
    if (moderation) query.moderationStatus = moderation;

    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Server error fetching orders", error: err.message });
  }
});

// Update moderation status of an order
router.post("/moderate/:orderId", auth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body; // 'approved', 'rejected', 'investigate'
    
    if (!["approved", "rejected", "investigate"].includes(status)) {
      return res.status(400).json({ message: "Invalid moderation status" });
    }

    const order = await Order.findOne({ orderId: req.params.orderId.toUpperCase() });
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.moderationStatus = status;
    
    // If approved, update status to 'preparing' if it was in placed
    if (status === "approved" && order.status === "placed") {
      order.status = "preparing";
    } else if (status === "rejected") {
      // Don't ship rejected orders
      order.status = "waiting"; // or another inactive state
    }

    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: "Server error during moderation update", error: err.message });
  }
});

// Update physical delivery status of an order
router.post("/delivery/:orderId", auth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body; // 'preparing', 'dispatched', 'delivered'
    
    if (!["preparing", "dispatched", "delivered", "waiting", "puked_back"].includes(status)) {
      return res.status(400).json({ message: "Invalid delivery status" });
    }

    const order = await Order.findOne({ orderId: req.params.orderId.toUpperCase() });
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.status = status;
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: "Server error updating delivery status", error: err.message });
  }
});

// Get recipient reports
router.get("/reports", auth, requireAdmin, async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: "Server error fetching reports", error: err.message });
  }
});

module.exports = router;