const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  playerName: {
    type: String,
    required: true,
  },
  profileImageUrl: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    sparse: true,
    unique: true
  },
  uid: {
    type: String,
    sparse: true,
    unique: true
  },
  totalScore: {
    type: Number,
    default: 0,
  },
  gamesPlayed: {
    type: Number,
    default: 0,
  },
  wins: {
    type: Number,
    default: 0,
  },
  winRate: {
    type: Number,
    default: 0,
  },
  deviceId: {
    type: String,
    required: true, // Used to identify unique users (from local storage)
    unique: true
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
