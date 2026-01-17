const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: { type: String, unique: true },
  password: String,
  profilePicture: String, // path to the image
  friends: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  uniqueId: { type: String, unique: true },

  // Location & Presence
  available: { type: Boolean, default: false },
  lat: { type: Number },
  lon: { type: Number },
  accuracy: { type: Number },
  isBusy: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
