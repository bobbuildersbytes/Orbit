const mongoose = require("mongoose");

const pageEventSchema = new mongoose.Schema(
  {
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    toUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: { type: String },
    status: {
      type: String,
      enum: ["sent", "accepted"],
      default: "sent",
    },
    meta: {
      type: Object,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("PageEvent", pageEventSchema);
