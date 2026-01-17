const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: { type: String, unique: true },
  password: String,
  profilePicture: String, // path to the image
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  uniqueId: { type: String, unique: true },
  // Add other fields as needed
});

module.exports = mongoose.model('User', userSchema);