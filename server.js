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
// const Presence = require("./models/Presence"); // Removed
const nodemailer = require("nodemailer");

const app = express();
const port = 8008;

// Initialize Email Service
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "your_email@gmail.com",
    pass: process.env.EMAIL_PASS || "your_app_password",
  },
});

// Verify transporter connection
transporter.verify((error, success) => {
  if (error) {
    console.error("Email transporter error:", error);
  } else {
    console.log("Email transporter ready:", success);
  }
});

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
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
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
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  }),
);
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
    const user = await User.findById(id);
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
    
    // Handle cropped image from base64
    if (croppedImage) {
      const base64Data = croppedImage.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const filename = Date.now() + "-cropped.jpg";
      fs.writeFileSync(path.join("public/uploads", filename), buffer);
      profilePicture = filename;
    } else if (req.file) {
      profilePicture = req.file.filename;
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

app.post("/update-profile-picture", upload.single("profilePicture"), async (req, res) => {
  console.log("POST /update-profile-picture request received");
  console.log("Authenticated:", req.isAuthenticated());
  console.log("File received:", !!req.file);
  
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    
    if (req.file) {
      console.log("Updating profile picture for user:", user._id);
      // Delete old profile picture if it exists
      if (user.profilePicture) {
        const oldPath = path.join("public/uploads", user.profilePicture);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      
      user.profilePicture = req.file.filename;
      await user.save();
      console.log("Profile picture updated successfully:", req.file.filename);
      res.json({ success: true, filename: req.file.filename });
    } else {
      console.log("No file in request");
      res.status(400).json({ error: "No file uploaded" });
    }
  } catch (err) {
    console.error("Error updating profile picture:", err);
    res.status(500).json({ error: err.message });
  }
});

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
    user.friends = user.friends.filter(
      (id) => id.toString() !== req.body.friendId,
    );
    await user.save();
    console.log("Friend removed successfully");
    res.redirect("/main");
  } catch (err) {
    console.error("Error removing friend:", err);
    res.redirect("/main");
  }
});

app.post("/pager", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/");
  try {
    const friend = await User.findById(req.body.friendId);
    if (friend) {
      const pager = await User.findById(req.user.id);
      console.log(
        `Sending pager notification to ${friend.email} from ${pager.firstName} ${pager.lastName}`,
      );

      // Send email via Nodemailer
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: friend.email,
        subject: `${pager.firstName} ${pager.lastName} paged you!`,
        html: `
          <h2>You've been paged!</h2>
          <p><strong>${pager.firstName} ${pager.lastName}</strong> has sent you a page notification.</p>
          <p>Check your app to respond!</p>
        `,
      };

      console.log("Mail options:", mailOptions);
      const info = await transporter.sendMail(mailOptions);
      console.log(
        "Pager sent successfully to",
        friend.email,
        "Response:",
        info.response,
      );
    } else {
      console.log("Friend not found with ID:", req.body.friendId);
    }
    res.redirect("/main");
  } catch (err) {
    console.error("Error sending pager:", err.message);
    console.error("Full error:", err);
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
    const user = await User.findById(req.user.id);
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
      "firstName lastName email lat lon available isBusy uniqueId profilePicture",
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

app.post("/api/suggestions/context", async (req, res) => {
  // Placeholder for suggestions API
  res.json({ suggestions: [] });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
