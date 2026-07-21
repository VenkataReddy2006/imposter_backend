const rooms = {};

const generateRoomCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const getSafeRoom = (room) => {
  const safeRoom = { ...room };
  delete safeRoom.phaseTimeout;
  return safeRoom;
};

const { wordsByCategory, cluesByWord } = require('./wordsData');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create Room
    socket.on('createRoom', (data) => {
      const { playerName, profileImageUrl, numPlayers, numImposters, categories, timeLimit } = data;
      const roomCode = generateRoomCode();
      const selectedCategories = categories && categories.length > 0 ? categories : ['everyday'];
      
      rooms[roomCode] = {
        code: roomCode,
        host: socket.id,
        players: [{ id: socket.id, name: playerName, profileImageUrl, isHost: true }],
        settings: { numPlayers, numImposters, categories: selectedCategories, timeLimit },
        state: 'lobby', // lobby, playing, voting, leaderboard
        imposters: [],
        word: '',
        clue: '',
        readyPlayers: [],
        discussionStarter: null,
        votes: {}, // voterId: targetId
        totalScores: {}, // Accumulate scores across rounds
      };

      socket.join(roomCode);
      io.to(roomCode).emit('roomCreated', getSafeRoom(rooms[roomCode]));
      console.log('Room created:', roomCode);
    });

    // Join Room
    socket.on('joinRoom', (data) => {
      console.log('Join room requested:', data);
      const { playerName, profileImageUrl, roomCode } = data;
      const room = rooms[roomCode];

      if (!room) {
        console.log('Room not found:', roomCode);
        return socket.emit('error', 'Room not found');
      }

      if (room.state !== 'lobby') {
        console.log('Game already started:', roomCode);
        return socket.emit('error', 'Game already started');
      }

      if (room.players.length >= room.settings.numPlayers) {
        console.log('Room full:', roomCode);
        return socket.emit('error', 'Room full');
      }

      if (!room.players.find(p => p.id === socket.id)) {
        room.players.push({ id: socket.id, name: playerName, profileImageUrl, isHost: false });
      }
      socket.join(roomCode);
      console.log('Player successfully joined:', roomCode, 'Total players:', room.players.length);
      io.to(roomCode).emit('playerJoined', getSafeRoom(room));
    });

    // Start Game
    socket.on('startGame', (roomCode) => {
      const room = rooms[roomCode];
      if (!room || room.host !== socket.id) return;
      if (room.phaseTimeout) clearTimeout(room.phaseTimeout);
      startNewRound(io, room);
    });

    // Player Ready (Transition to discussion)
    socket.on('playerReady', (roomCode) => {
      const room = rooms[roomCode];
      if (!room || room.state !== 'playing') return;

      if (!room.readyPlayers.includes(socket.id)) {
        room.readyPlayers.push(socket.id);
      }

      // Check if all players are ready
      if (room.readyPlayers.length === room.players.length) {
        room.state = 'discussion';
        
        // Pick a random player to start the discussion
        const starter = room.players[Math.floor(Math.random() * room.players.length)];
        room.discussionStarter = starter.name;

        let phaseEndTime = null;
        if (room.settings.timeLimit) {
          phaseEndTime = Date.now() + (room.settings.timeLimit * 1000);
          room.phaseTimeout = setTimeout(() => {
            room.state = 'voting';
            let votingEndTime = Date.now() + (30 * 1000);
            room.phaseTimeout = setTimeout(() => {
              calculateScoresAndEnd(io, room);
            }, 30 * 1000);
            io.to(roomCode).emit('votingStarted', {
              ...getSafeRoom(room),
              state: room.state,
              phaseEndTime: votingEndTime
            });
          }, room.settings.timeLimit * 1000);
        }

        io.to(roomCode).emit('discussionStarted', {
          ...getSafeRoom(room),
          state: room.state,
          discussionStarter: room.discussionStarter,
          phaseEndTime
        });
      }
    });

    // End Phase (Go to voting manually by host)
    socket.on('endPhase', (roomCode) => {
      const room = rooms[roomCode];
      if (!room || room.host !== socket.id) return;

      if (room.phaseTimeout) clearTimeout(room.phaseTimeout);

      room.state = 'voting';
      let phaseEndTime = null;
      if (room.settings.timeLimit) {
        phaseEndTime = Date.now() + (30 * 1000);
        room.phaseTimeout = setTimeout(() => {
          calculateScoresAndEnd(io, room);
        }, 30 * 1000);
      }
      io.to(roomCode).emit('votingStarted', {
        ...getSafeRoom(room),
        state: room.state,
        phaseEndTime
      });
    });

    // Submit Vote
    socket.on('submitVote', (data) => {
      const { roomCode, targetId } = data;
      const room = rooms[roomCode];
      if (!room || room.state !== 'voting') return;

      room.votes[socket.id] = targetId;

      // Check if everyone has voted
      if (Object.keys(room.votes).length === room.players.length) {
        calculateScoresAndEnd(io, room);
      } else {
        io.to(roomCode).emit('voteRegistered', { voterId: socket.id });
      }
    });

    // Continue Game (Next round)
    socket.on('continueGame', (roomCode) => {
      const room = rooms[roomCode];
      if (!room || room.host !== socket.id) return;
      startNewRound(io, room);
    });

    // Leave Room
    socket.on('leaveRoom', (roomCode) => {
      const room = rooms[roomCode];
      if (!room) return;

      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const wasHost = room.players[playerIndex].isHost;
        room.players.splice(playerIndex, 1);
        socket.leave(roomCode);
        console.log('Player left:', socket.id);

        if (room.players.length === 0) {
          if (room.phaseTimeout) clearTimeout(room.phaseTimeout);
          delete rooms[roomCode];
          console.log('Room deleted:', roomCode);
        } else {
          if (wasHost) {
            room.players[0].isHost = true;
            room.host = room.players[0].id;
          }
          // Re-use playerJoined to update the UI for remaining players
          io.to(roomCode).emit('playerJoined', getSafeRoom(room)); 
        }
      }
    });

    // Final Leaderboard (Host only)
    socket.on('showFinalLeaderboard', (roomCode) => {
      const room = rooms[roomCode];
      if (!room || room.host !== socket.id) return;
      
      room.state = 'final_leaderboard';
      io.to(roomCode).emit('finalLeaderboard', getSafeRoom(room));
    });

    // End Room (Host only)
    socket.on('endRoom', (roomCode) => {
      const room = rooms[roomCode];
      if (!room || room.host !== socket.id) return;
      
      if (room.phaseTimeout) clearTimeout(room.phaseTimeout);
      io.to(roomCode).emit('roomEnded', 'Host ended the room');
      delete rooms[roomCode];
      console.log('Room ended by host:', roomCode);
      
      io.in(roomCode).socketsLeave(roomCode);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      for (const roomCode in rooms) {
        const room = rooms[roomCode];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          const wasHost = room.players[playerIndex].isHost;
          room.players.splice(playerIndex, 1);
          
          if (room.players.length === 0) {
            if (room.phaseTimeout) clearTimeout(room.phaseTimeout);
            delete rooms[roomCode];
            console.log('Room deleted due to disconnect:', roomCode);
          } else {
            if (wasHost) {
              room.players[0].isHost = true;
              room.host = room.players[0].id;
            }
            io.to(roomCode).emit('playerJoined', getSafeRoom(room));
          }
          break;
        }
      }
    });
  });
};

function startNewRound(io, room) {
  // Assign Imposters
  const shuffledPlayers = [...room.players].sort(() => 0.5 - Math.random());
  const imposters = shuffledPlayers.slice(0, room.settings.numImposters).map(p => p.id);
  room.imposters = imposters;

  // Select Word from combined categories
  let availableWords = [];
  for (const cat of room.settings.categories) {
    if (wordsByCategory[cat]) {
      availableWords.push(...wordsByCategory[cat]);
    }
  }
  if (availableWords.length === 0) {
    availableWords = wordsByCategory['everyday'] || [];
  }
  
  const word = availableWords[Math.floor(Math.random() * availableWords.length)];
  room.word = word;
  room.clue = cluesByWord[word] || 'NO CLUE';
  room.state = 'playing';
  room.votes = {};
  room.readyPlayers = [];
  room.discussionStarter = null;

  io.to(room.code).emit('gameStarted', {
    state: room.state,
  });

  // Send roles privately to each player
  room.players.forEach(p => {
    const isImposter = imposters.includes(p.id);
    io.to(p.id).emit('roleRevealed', {
      isImposter,
      word: isImposter ? null : room.word,
      clue: isImposter ? room.clue : null,
    });
  });
}

function calculateScoresAndEnd(io, room) {
  if (room.phaseTimeout) clearTimeout(room.phaseTimeout);
  room.state = 'leaderboard';
  if (!room.totalScores) room.totalScores = {};
  
  const roundScores = {};
  
  // Initialize scores for this round
  room.players.forEach(p => {
    roundScores[p.id] = 0;
    if (room.totalScores[p.id] === undefined) {
      room.totalScores[p.id] = 0;
    }
  });

  let correctInnocentVotes = 0;
  let wrongVotes = 0;

  for (const [voterId, targetId] of Object.entries(room.votes)) {
    const isVoterImposter = room.imposters.includes(voterId);
    const isTargetImposter = room.imposters.includes(targetId);

    if (!isVoterImposter) {
      if (isTargetImposter) {
        correctInnocentVotes++;
      } else {
        wrongVotes++;
      }
    }
  }

  // Assign points
  room.players.forEach(p => {
    if (!room.imposters.includes(p.id)) {
       const votedTarget = room.votes[p.id];
       if (room.imposters.includes(votedTarget)) {
          roundScores[p.id] += correctInnocentVotes * 10;
       }
    } else {
       roundScores[p.id] += wrongVotes * 10;
    }
    
    // Accumulate into totalScores
    room.totalScores[p.id] += roundScores[p.id];
  });

  io.to(room.code).emit('leaderboard', {
    scores: room.totalScores,
    imposters: room.imposters,
    votes: room.votes
  });
}
