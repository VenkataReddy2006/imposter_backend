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
app.use(express.json());

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
    const { deviceId, playerName, profileImageUrl } = req.body;
    const user = await User.findOneAndUpdate(
      { deviceId },
      { playerName, profileImageUrl },
      { new: true, upsert: true }
    );
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

app.get('/api/users/:deviceId', async (req, res) => {
  try {
    const user = await User.findOne({ deviceId: req.params.deviceId });
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
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
