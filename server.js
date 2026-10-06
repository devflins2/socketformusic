const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },

  pingInterval: 25000,
  pingTimeout: 60000,

  transports: ["websocket", "polling"],
});

const rooms = new Map();

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "FlinsMusic Socket Server",
  });
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // CREATE ROOM
  socket.on("room:create", ({ roomId, userId }) => {
    if (!roomId || !userId) {
      return socket.emit("room:error", {
        message: "Invalid room information",
      });
    }

    if (rooms.has(roomId)) {
      return socket.emit("room:error", {
        message: "Room already exists",
      });
    }

    const room = {
      roomId,
      hostId: userId,

      members: new Map([
        [userId, socket.id],
      ]),

      currentSong: null,
      isPlaying: false,
      position: 0,
      updatedAt: Date.now(),
    };

    rooms.set(roomId, room);

    socket.join(roomId);

    socket.roomId = roomId;
    socket.userId = userId;

    socket.emit("room:state", getRoomState(room));
  });

  // JOIN ROOM
  socket.on("room:join", ({ roomId, userId }) => {
    const room = rooms.get(roomId);

    if (!room) {
      return socket.emit("room:error", {
        message: "Room not found",
      });
    }

    room.members.set(userId, socket.id);

    socket.join(roomId);

    socket.roomId = roomId;
    socket.userId = userId;

    socket.emit("room:state", getRoomState(room));

    socket.to(roomId).emit("room:member-joined", {
      userId,
    });
  });

  // LEAVE ROOM
  socket.on("room:leave", () => {
    leaveRoom(socket);
  });

  // PLAY
  socket.on("player:play", (data) => {
    const room = rooms.get(socket.roomId);

    if (!room) return;

    room.isPlaying = true;
    room.updatedAt = Date.now();

    socket.to(socket.roomId).emit("player:play", {
      ...data,
      timestamp: Date.now(),
    });
  });

  // PAUSE
  socket.on("player:pause", (data) => {
    const room = rooms.get(socket.roomId);

    if (!room) return;

    room.isPlaying = false;
    room.updatedAt = Date.now();

    socket.to(socket.roomId).emit("player:pause", {
      ...data,
      timestamp: Date.now(),
    });
  });

  // SEEK
  socket.on("player:seek", ({ position }) => {
    const room = rooms.get(socket.roomId);

    if (!room) return;

    room.position = Number(position) || 0;
    room.updatedAt = Date.now();

    socket.to(socket.roomId).emit("player:seek", {
      position: room.position,
      timestamp: Date.now(),
    });
  });

  // SONG CHANGE
  socket.on("player:song-change", ({ song }) => {
    const room = rooms.get(socket.roomId);

    if (!room) return;

    room.currentSong = song;
    room.position = 0;
    room.updatedAt = Date.now();

    socket.to(socket.roomId).emit("player:song-change", {
      song,
      timestamp: Date.now(),
    });
  });

  // WEBRTC OFFER
  socket.on("webrtc:offer", (data) => {
    socket.to(data.roomId).emit("webrtc:offer", {
      ...data,
      senderId: socket.userId,
    });
  });

  // WEBRTC ANSWER
  socket.on("webrtc:answer", (data) => {
    socket.to(data.roomId).emit("webrtc:answer", {
      ...data,
      senderId: socket.userId,
    });
  });

  // ICE CANDIDATE
  socket.on("webrtc:ice-candidate", (data) => {
    socket.to(data.roomId).emit("webrtc:ice-candidate", {
      ...data,
      senderId: socket.userId,
    });
  });

  // MIC STATUS
  socket.on("voice:start", () => {
    if (!socket.roomId) return;

    socket.to(socket.roomId).emit("voice:start", {
      userId: socket.userId,
    });
  });

  socket.on("voice:stop", () => {
    if (!socket.roomId) return;

    socket.to(socket.roomId).emit("voice:stop", {
      userId: socket.userId,
    });
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    leaveRoom(socket);
  });
});

function getRoomState(room) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    members: [...room.members.keys()],
    currentSong: room.currentSong,
    isPlaying: room.isPlaying,
    position: room.position,
    updatedAt: room.updatedAt,
  };
}

function leaveRoom(socket) {
  const roomId = socket.roomId;
  const userId = socket.userId;

  if (!roomId || !userId) return;

  const room = rooms.get(roomId);

  if (!room) return;

  room.members.delete(userId);

  socket.leave(roomId);

  socket.to(roomId).emit("room:member-left", {
    userId,
  });

  // Host migration
  if (room.hostId === userId) {
    const nextHost = room.members.keys().next().value;

    if (nextHost) {
      room.hostId = nextHost;

      io.to(roomId).emit("room:host-changed", {
        hostId: nextHost,
      });
    }
  }

  // Delete empty room
  if (room.members.size === 0) {
    rooms.delete(roomId);
  }

  socket.roomId = null;
  socket.userId = null;
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FlinsMusic Socket Server running on port ${PORT}`);
});
