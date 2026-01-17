require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const User = require('./models/User');
const nodemailer = require('nodemailer');

const app = express();
const port = 8008;

// Initialize Email Service
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your_email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your_app_password',
  }
});

// Verify transporter connection
transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter error:', error);
  } else {
    console.log('Email transporter ready:', success);
  }
});

// Set view engine
app.set('view engine', 'ejs');

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));
app.use(passport.initialize());
app.use(passport.session());

// Passport Local Strategy
passport.use(new LocalStrategy({ usernameField: 'email' },
  async (email, password, done) => {
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return done(null, false, { message: 'Incorrect email.' });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

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
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/main');
  } else {
    res.sendFile(__dirname + '/public/index.html');
  }
});

app.get('/signup', (req, res) => {
  res.sendFile(__dirname + '/public/signup.html');
});

app.post('/signup', upload.single('profilePicture'), async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const profilePicture = req.file ? req.file.filename : null;
    let uniqueId;
    do {
      uniqueId = Math.random().toString(36).substr(2, 6).toUpperCase();
    } while (await User.findOne({ uniqueId }));
    const user = new User({ firstName, lastName, email, password: hashedPassword, profilePicture, uniqueId });
    await user.save();
    console.log('User saved with ID:', user._id, 'Unique ID:', user.uniqueId);
    res.redirect('/');
  } catch (err) {
    console.log('Error saving user:', err);
    res.redirect('/signup');
  }
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/main',
  failureRedirect: '/',
}));

app.post('/add-friend', async (req, res) => {
  console.log('POST /add-friend request received');
  if (!req.isAuthenticated()) {
    console.log('User not authenticated');
    return res.redirect('/');
  }
  try {
    console.log('Friend Unique ID entered:', req.body.code);
    const friend = await User.findOne({ uniqueId: req.body.code });
    console.log('Friend found:', friend ? 'Yes' : 'No');
    if (friend) {
      console.log('Friend ID:', friend._id.toString());
      console.log('Current user ID:', req.user.id);
      const user = await User.findById(req.user.id);
      console.log('Current user friends:', user.friends);
      if (friend._id.toString() !== req.user.id && !user.friends.includes(friend._id)) {
        user.friends.push(friend._id);
        await user.save();
        console.log('Friend added successfully');
      } else {
        console.log('Friend not added: self or already friends');
      }
    } else {
      console.log('Friend with unique ID', req.body.code, 'not found');
    }
    res.redirect('/main');
  } catch (err) {
    console.error('Error adding friend:', err);
    res.redirect('/main');
  }
});

app.post('/remove-friend', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  try {
    const user = await User.findById(req.user.id);
    user.friends = user.friends.filter(id => id.toString() !== req.body.friendId);
    await user.save();
    console.log('Friend removed successfully');
    res.redirect('/main');
  } catch (err) {
    console.error('Error removing friend:', err);
    res.redirect('/main');
  }
});

app.post('/pager', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  try {
    const friend = await User.findById(req.body.friendId);
    if (friend) {
      const pager = await User.findById(req.user.id);
      console.log(`Sending pager notification to ${friend.email} from ${pager.firstName} ${pager.lastName}`);
      
      // Send email via Nodemailer
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: friend.email,
        subject: `${pager.firstName} ${pager.lastName} paged you!`,
        html: `
          <h2>You've been paged!</h2>
          <p><strong>${pager.firstName} ${pager.lastName}</strong> has sent you a page notification.</p>
          <p>Check your app to respond!</p>
        `
      };
      
      console.log('Mail options:', mailOptions);
      const info = await transporter.sendMail(mailOptions);
      console.log('Pager sent successfully to', friend.email, 'Response:', info.response);
    } else {
      console.log('Friend not found with ID:', req.body.friendId);
    }
    res.redirect('/main');
  } catch (err) {
    console.error('Error sending pager:', err.message);
    console.error('Full error:', err);
    res.redirect('/main');
  }
});

app.get('/main', async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const user = await User.findById(req.user.id).populate('friends', 'firstName lastName profilePicture');
      res.render('main', { user });
    } catch (err) {
      console.log(err);
      res.render('main', { user: req.user });
    }
  } else {
    res.redirect('/');
  }
});

app.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});
// Catch-all error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).send('Server error');
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});