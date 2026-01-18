require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const User = require("./models/User");
const PageEvent = require("./models/PageEvent");
// const Presence = require("./models/Presence"); // Removed
const { MailerSend, EmailParams, Recipient } = require("mailersend");
const { aiHookConfigured, callAIHook } = require("./utils/aiHook");
// const { fetchNearbyPlaces } = require("./utils/places"); // Moved to suggestionEngine
const suggestionEngine = require("./utils/suggestionEngine");

const app = express();
const port = 8008;

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error(
    "Missing required env var: MONGODB_URI. Add it to your .env (see README.md).",
  );
  process.exit(1);
}

const sessionSecret =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET not set; using a random ephemeral secret (sessions will reset on restart).",
  );
}

// Initialize MailerSend Service
const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY || "",
});
const EMAIL_ENABLED = !!process.env.MAILERSEND_API_KEY;
const DEV_MODE_EMAIL = process.env.DEV_MODE_EMAIL === "true";

console.log("MailerSend initialized");
console.log(
  "API Key loaded:",
  process.env.MAILERSEND_API_KEY ? "✅ Yes" : "❌ No",
);
console.log("Verified sender:", process.env.MAILERSEND_FROM || "❌ Not set");
if (DEV_MODE_EMAIL) {
  console.log("📧 Dev mode enabled: emails will be logged instead of sent.");
}

// Set view engine
app.set("view engine", "ejs");

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Connect to MongoDB
mongoose
  .connect(mongoUri)
  .then(() => {
    console.log("MongoDB connected");
    // Trigger AI generation on startup
    suggestionEngine.prefetchAll();
  })
  .catch((err) => console.log(err));

// Middleware
app.use(express.json()); // Moved to top to ensure parsing matches
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
  }),
);

// Optimization: Public Config Endpoint (No DB lookup required)
app.get("/api/config", (req, res) => {
  res.json({
    amplitudeApiKey: process.env.AMPLITUDE_API_KEY,
  });
});

app.use(passport.initialize());
app.use(passport.session());

// Passport Local Strategy
passport.use(
  new LocalStrategy(
    { usernameField: "email" },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email });
        if (!user) {
          return done(null, false, { message: "Incorrect email." });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: "Incorrect password." });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select("-profilePicture");
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Routes
app.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect("/main");
  } else {
    res.sendFile(__dirname + "/public/index.html");
  }
});

app.get("/signup", (req, res) => {
  res.sendFile(__dirname + "/public/signup.html");
});

app.post("/signup", upload.single("profilePicture"), async (req, res) => {
  try {
    const { firstName, lastName, email, password, croppedImage } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    let profilePicture = null;

    // Handle cropped image from base64 - store directly in DB
    if (croppedImage) {
      profilePicture = croppedImage; // Store full base64 string
    } else if (req.file) {
      // Convert uploaded file to base64
      const fileBuffer = fs.readFileSync(req.file.path);
      const base64Image = `data:${req.file.mimetype};base64,${fileBuffer.toString("base64")}`;
      profilePicture = base64Image;
      // Delete the temporary file
      fs.unlinkSync(req.file.path);
    }

    let uniqueId;
    do {
      uniqueId = Math.random().toString(36).substr(2, 6).toUpperCase();
    } while (await User.findOne({ uniqueId }));
    const user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      profilePicture,
      uniqueId,
    });
    await user.save();
    console.log("User saved with ID:", user._id, "Unique ID:", user.uniqueId);
    res.redirect("/");
  } catch (err) {
    console.log("Error saving user:", err);
    res.redirect("/signup");
  }
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/main",
    failureRedirect: "/",
  }),
);

app.post(
  "/update-profile-picture",
  upload.single("profilePicture"),
  async (req, res) => {
    console.log("POST /update-profile-picture request received");
    console.log("Authenticated:", req.isAuthenticated());
    console.log("File received:", !!req.file);

    if (!req.isAuthenticated())
      return res.status(401).json({ error: "Not authenticated" });

    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ error: "User not found" });

      if (req.file) {
        console.log("Updating profile picture for user:", user._id);

        // Convert file to base64 and store in MongoDB
        const fileBuffer = fs.readFileSync(req.file.path);
        const base64Image = `data:${req.file.mimetype};base64,${fileBuffer.toString("base64")}`;
        user.profilePicture = base64Image;

        // Delete the temporary file
        fs.unlinkSync(req.file.path);

        await user.save();
        console.log("Profile picture updated successfully");
        res.json({ success: true, base64: base64Image });
      } else {
        console.log("No file in request");
        res.status(400).json({ error: "No file uploaded" });
      }
    } catch (err) {
      console.error("Error updating profile picture:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

app.post("/add-friend", async (req, res) => {
  console.log("POST /add-friend request received");
  if (!req.isAuthenticated()) {
    console.log("User not authenticated");
    return res.redirect("/");
  }
  try {
    console.log("Friend Unique ID entered:", req.body.code);
    const friend = await User.findOne({ uniqueId: req.body.code });
    console.log("Friend found:", friend ? "Yes" : "No");
    if (friend) {
      console.log("Friend ID:", friend._id.toString());
      console.log("Current user ID:", req.user.id);
      const user = await User.findById(req.user.id);
      console.log("Current user friends:", user.friends);
      if (
        friend._id.toString() !== req.user.id &&
        !user.friends.includes(friend._id)
      ) {
        user.friends.push(friend._id);
        await user.save();
        // Re-fetch friend to get latest state before modifying
        const friendUpdated = await User.findById(friend._id);
        if (!friendUpdated.friends) friendUpdated.friends = [];
        if (!friendUpdated.friends.includes(user._id)) {
          friendUpdated.friends.push(user._id);
          await friendUpdated.save();
        }
        console.log("Friend added successfully (bidirectional)");
      } else {
        console.log("Friend not added: self or already friends");
      }
    } else {
      console.log("Friend with unique ID", req.body.code, "not found");
    }
    res.redirect("/main");
  } catch (err) {
    console.error("Error adding friend:", err);
    res.redirect("/main");
  }
});

app.post("/remove-friend", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/");
  try {
    const user = await User.findById(req.user.id);
    const friendId = req.body.friendId;

    console.log("Removing friend:", friendId, "for user:", user._id.toString());
    console.log(
      "User friends before:",
      user.friends.map((id) => id.toString()),
    );

    // Remove from current user's friends list
    user.friends = user.friends.filter(
      (id) => id.toString() !== friendId.toString(),
    );
    await user.save();

    console.log(
      "User friends after:",
      user.friends.map((id) => id.toString()),
    );

    // Re-fetch friend to get latest state before modifying (bidirectional)
    const friend = await User.findById(friendId);
    if (friend) {
      console.log("Friend found:", friend._id.toString());
      if (!friend.friends) friend.friends = [];
      console.log(
        "Friend's friends before:",
        friend.friends.map((id) => id.toString()),
      );

      friend.friends = friend.friends.filter(
        (id) => id.toString() !== user._id.toString(),
      );
      await friend.save();

      console.log(
        "Friend's friends after:",
        friend.friends.map((id) => id.toString()),
      );
      console.log("Friend removed successfully (bidirectional)");
    } else {
      console.log("Friend not found with ID:", friendId);
    }

    res.redirect("/main");
  } catch (err) {
    console.error("Error removing friend:", err);
    res.redirect("/main");
  }
});

// Helper function to send emails via MailerSend
async function sendEmail(emailContent) {
  if (DEV_MODE_EMAIL) {
    console.log("📧 [DEV MODE] Email would be sent:", emailContent);
    return { success: true, devMode: true };
  }

  if (!EMAIL_ENABLED) {
    throw new Error(
      "MailerSend not configured. Set MAILERSEND_API_KEY in .env",
    );
  }

  const fromEmail = process.env.MAILERSEND_FROM;
  if (!fromEmail) {
    throw new Error("MAILERSEND_FROM not set in .env");
  }

  const params = new EmailParams()
    .setFrom({ email: fromEmail, name: "Orbit" })
    .setTo([new Recipient(emailContent.to)])
    .setReplyTo({ email: fromEmail })
    .setSubject(emailContent.subject)
    .setHtml(emailContent.html);

  return await mailerSend.email.send(params);
}

app.post("/pager", async (req, res) => {
  const wantsJson = req.is("application/json");
  if (!req.isAuthenticated()) {
    if (wantsJson)
      return res.status(401).json({ error: "Authentication required" });
    return res.redirect("/");
  }
  try {
    const friend = await User.findById(req.body.friendId);
    if (!friend) {
      console.log("Friend not found with ID:", req.body.friendId);
      if (wantsJson) return res.status(404).json({ error: "Friend not found" });
      return res.redirect("/main");
    }

    const pager = await User.findById(req.user.id);
    console.log(
      `Sending pager notification to ${friend.email} from ${pager.firstName} ${pager.lastName}`,
    );

    const emailContent = {
      to: friend.email,
      subject: `${pager.firstName} ${pager.lastName} paged you!`,
      html: `
          <h2>You've been paged!</h2>
          <p><strong>${pager.firstName} ${pager.lastName}</strong> has sent you a page notification.</p>
          <p>Message: ${req.body.message || "No message provided."}</p>
          <p>Check your app to respond!</p>
        `,
    };

    const emailResponse = await sendEmail(emailContent);
    console.log(
      "Pager sent successfully to",
      friend.email,
      "Response:",
      emailResponse,
    );

    const pageEvent = new PageEvent({
      fromUser: req.user.id,
      toUser: friend._id,
      message: req.body.message,
      meta: {
        emailResponse: JSON.stringify(emailResponse),
        toEmail: friend.email,
      },
    });
    await pageEvent.save();

    if (wantsJson) {
      return res.json({ success: true, pageEventId: pageEvent._id });
    }
    res.redirect("/main");
  } catch (err) {
    console.error("Error sending pager:", err.message);
    console.error("Full error:", err);
    if (wantsJson) return res.status(500).json({ error: err.message });
    res.redirect("/main");
  }
});

app.get("/main", async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const user = await User.findById(req.user.id).populate(
        "friends",
        "firstName lastName profilePicture",
      );
      res.render("main", { user });
    } catch (err) {
      console.log(err);
      res.render("main", { user: req.user });
    }
  } else {
    res.redirect("/");
  }
});

app.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});
// Catch-all error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).send("Server error");
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// API Routes
app.get("/api/me", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "Not authenticated" });
  try {
    const user = await User.findById(req.user.id).select("-password");
    // Remove presence lookup, return user fields directly
    // const presence = await Presence.findOne({ userId: req.user.id });

    // Construct a "presence-like" object from user data for backward compat if needed,
    // or just rely on the user object.
    // Client (me check) expects { user, presence }, so let's mock presence from user
    const presence = {
      available: user.available,
      isBusy: user.isBusy,
      lat: user.lat,
      lon: user.lon,
    };

    res.json({ user, presence });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/presence", async (req, res) => {
  try {
    if (!req.user) return res.json({ presences: [] });

    // Fetch current user to get friends list
    const currentUser = await User.findById(req.user.id);
    const friendIds = currentUser.friends || [];

    // Find friends directly from User collection
    // only those who are available (or show all for debugging?)
    // Let's show all friends for now to fix the "friends list empty" issue,
    // but client might expect only available ones.
    // The UI normally filters, but let's return them.

    const friends = await User.find({
      _id: { $in: friendIds },
    }).select(
      "firstName lastName email lat lon available isBusy uniqueId profilePicture lastSeen",
    );

    const mapped = friends.map((f) => ({
      userId: f._id,
      name: `${f.firstName} ${f.lastName}`,
      email: f.email,
      lat: f.lat,
      lon: f.lon,
      isBusy: f.isBusy,
      available: f.available,
      profilePicture: f.profilePicture,
      lastSeen: f.lastSeen,
    }));

    // Add current user to the presences list
    const userPresence = {
      userId: currentUser._id,
      name: `${currentUser.firstName} ${currentUser.lastName}`,
      email: currentUser.email,
      lat: currentUser.lat,
      lon: currentUser.lon,
      isBusy: currentUser.isBusy,
      available: currentUser.available,
      profilePicture: currentUser.profilePicture,
      lastSeen: currentUser.lastSeen,
      isCurrentUser: true,
    };

    res.json({ presences: [userPresence, ...mapped] });
  } catch (err) {
    console.error("Error in /api/presence:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/availability", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "Login required" });
  try {
    const { available, isBusy } = req.body;

    // Update USER directly
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.available = available;
    user.isBusy = isBusy;
    user.lastSeen = Date.now();

    await user.save();

    res.json({
      success: true,
      presence: { available: user.available, isBusy: user.isBusy },
    });
  } catch (err) {
    console.error("Error in /api/availability:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/location", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "Login required" });
  try {
    const { lat, lon, accuracy } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.lat = lat;
    user.lon = lon;
    user.accuracy = accuracy;
    user.lastSeen = Date.now();
    // If we receive location, imply available? Or keep explicit?
    // Usually explicit toggle is better.

    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark a page event as accepted (for response-rate tracking)
app.post("/api/page-events/:id/accept", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "Login required" });
  try {
    const evt = await PageEvent.findById(req.params.id);
    if (!evt) return res.status(404).json({ error: "Event not found" });
    if (String(evt.toUser) !== req.user.id)
      return res.status(403).json({ error: "Not authorized to accept" });

    evt.status = "accepted";
    evt.meta = { ...(evt.meta || {}), acceptedAt: new Date() };
    await evt.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Error accepting page:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/suggestions/context", async (req, res) => {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: "Login required" });
  try {
    const { suggestions, context } = await suggestionEngine.getSuggestions(
      req.user,
    );
    res.json({ suggestions, context });
  } catch (err) {
    console.error("Error getting suggestions:", err);
    res.status(500).json({ error: err.message, suggestions: [] });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// ---------- Helper functions ----------
// Helpers moved to utils/suggestionEngine.js
