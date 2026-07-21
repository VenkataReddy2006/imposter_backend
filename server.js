require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
  }).catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
  });

const User = require('./models/User');

app.post('/api/users', async (req, res) => {
  try {
    const { deviceId, playerName, profileImageUrl, email, uid } = req.body;
    
    let user = null;
    
    if (uid) {
      user = await User.findOne({ uid });
    }
    
    if (!user && deviceId) {
      user = await User.findOne({ deviceId });
    }
    
    if (user) {
      user.playerName = playerName || user.playerName;
      if (profileImageUrl) user.profileImageUrl = profileImageUrl;
      if (email) user.email = email;
      if (uid) user.uid = uid;
      
      // If a user uninstalls/reinstalls, their deviceId might change. 
      // Update it so they can still play as guest seamlessly if they log out later.
      if (deviceId) user.deviceId = deviceId;
      
      await user.save();
    } else {
      user = await User.create({ deviceId, playerName, profileImageUrl, email, uid });
    }

    res.json(user);
  } catch (error) {
    console.error('Save profile error:', error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

app.get('/api/users/:identifier', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    
    // Check by uid first, then deviceId
    let user = await User.findOne({ uid: identifier });
    if (!user) {
      user = await User.findOne({ deviceId: identifier });
    }
    
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.post('/api/users/stats', async (req, res) => {
  try {
    const { identifier, scoreToAdd, isWin } = req.body;
    
    // Check by uid first, then deviceId
    let user = await User.findOne({ uid: identifier });
    if (!user) {
      user = await User.findOne({ deviceId: identifier });
    }
    
    if (user) {
      user.gamesPlayed = (user.gamesPlayed || 0) + 1;
      user.totalScore = (user.totalScore || 0) + (scoreToAdd || 0);
      if (isWin) {
        user.wins = (user.wins || 0) + 1;
      }
      user.winRate = user.gamesPlayed > 0 ? (user.wins / user.gamesPlayed) : 0;
      await user.save();
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Stats update error:', error);
    res.status(500).json({ error: 'Failed to update stats' });
  }
});

app.get('/', (req, res) => {
  res.send('Imposter Game Server is running');
});

// Socket.io Game Manager
const gameManager = require('./sockets/gameManager');
gameManager(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
