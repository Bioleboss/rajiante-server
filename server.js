// 🚀 Space Dual Server — v6 (clean rooms + ping)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  perMessageDeflate: false
});

const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const rooms = new Map();

// 🔄 nettoyage automatique des rooms vides/inactives
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (!room.hostId && (!room.lastActive || now - room.lastActive > 5 * 60 * 1000)) {
      rooms.delete(code);
      console.log(`🧹 Room ${code} supprimée (inactive)`);
    }
  }
}, 60000);

io.on("connection", (socket) => {
  console.log("🛰️ Nouveau client:", socket.id);

  const updateRoomActivity = (code) => {
    const r = rooms.get(code);
    if (r) r.lastActive = Date.now();
  };

  socket.on("pingTest", (_, cb) => cb && cb("pong"));

  // 🏗️ Création de room
  socket.on("createRoom", (_, cb) => {
    let code;
    do { code = nano(); } while (rooms.has(code));
    rooms.set(code, { hostId: socket.id, sockets: new Set([socket.id]), lastState: null, lastActive: Date.now() });
    socket.join(code);
    console.log(`🚀 Room créée: ${code}`);
    cb({ ok: true, code, isHost: true, playerIndex: 0 });
  });

  // 🔗 Rejoindre room
  socket.on("joinRoom", (code, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Code invalide." });
    if (room.sockets.size >= 2) return cb({ ok: false, error: "Salle pleine." });

    room.sockets.add(socket.id);
    room.lastActive = Date.now();
    socket.join(code);
    cb({ ok: true, code, isHost: false, playerIndex: 1 });
    io.to(room.hostId).emit("peerJoined");
    console.log(`👥 ${socket.id} a rejoint ${code}`);
  });

  // 🎮 Inputs client → host
  socket.on("clientInput", ({ code, input }) => {
    const room = rooms.get(code);
    if (!room) return;
    updateRoomActivity(code);
    io.to(room.hostId).emit("clientInput", { id: socket.id, input });
  });

  // 📡 Snapshot host → client
  socket.on("hostSnapshot", ({ code, state }) => {
    const room = rooms.get(code);
    if (!room) return;
    updateRoomActivity(code);
    room.lastState = state;
    socket.to(code).volatile.emit("hostSnapshot", state);
  });

  // ⏸️ Pause sync
  socket.on("pauseState", ({ code, paused, player }) => {
    const room = rooms.get(code);
    if (!room) return;
    updateRoomActivity(code);
    socket.to(code).emit("pauseState", { paused, player });
  });

  // 🕹️ Requête d’état instantané (pour reprise)
  socket.on("requestSnapshot", ({ code }) => {
    const room = rooms.get(code);
    if (room?.lastState) socket.emit("hostSnapshot", room.lastState);
  });

  // 🚪 Déconnexion
  socket.on("disconnect", () => {
    console.log("❌ Déco:", socket.id);
    for (const [code, room] of rooms.entries()) {
      if (!room.sockets.has(socket.id)) continue;
      room.sockets.delete(socket.id);
      socket.leave(code);

      if (room.hostId === socket.id) {
        io.to(code).emit("peerLeft", { reason: "host_left" });
        room.hostId = null;
        console.log(`⚠️ Host a quitté ${code}`);
      } else {
        io.to(room.hostId).emit("peerLeft", { reason: "peer_left" });
        console.log(`👋 Joueur a quitté ${code}`);
      }

      if (room.sockets.size === 0) {
        rooms.delete(code);
        console.log(`🗑️ Room ${code} vidée et supprimée`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("✅ Space Dual Server running on port", PORT);
});
