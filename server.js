// 🚀 Space Dual Server — v3 (room persist + snapshot + pause)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

// room: { hostId, sockets:Set, lastState }
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("🛰️ connect:", socket.id);

  socket.on("createRoom", (_, cb) => {
    let code; do { code = nano(); } while (rooms.has(code));
    rooms.set(code, { hostId: socket.id, sockets: new Set([socket.id]), lastState: null });
    socket.join(code);
    console.log("🚀 room created:", code);
    cb({ ok: true, code, isHost: true, playerIndex: 0 });
  });

  socket.on("joinRoom", (code, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Code invalide ou session expirée." });
    if (!room.hostId) { // host absent mais room gardée
      room.hostId = socket.id;
      room.sockets.add(socket.id);
      socket.join(code);
      console.log("♻️ host resumed on", code);
      return cb({ ok: true, code, isHost: true, playerIndex: 0, resumed: true });
    }
    if (room.sockets.size >= 2) return cb({ ok: false, error: "Salle pleine." });
    room.sockets.add(socket.id);
    socket.join(code);
    cb({ ok: true, code, isHost: false, playerIndex: 1 });
    io.to(room.hostId).emit("peerJoined");
    console.log("👥 join", socket.id, "room", code);
  });

  socket.on("clientInput", ({ code, input }) => {
    const room = rooms.get(code);
    if (!room || !room.hostId) return;
    io.to(room.hostId).emit("clientInput", { id: socket.id, input });
  });

  socket.on("hostSnapshot", ({ code, state }) => {
    const room = rooms.get(code);
    if (!room) return;
    room.lastState = state;
    socket.to(code).emit("hostSnapshot", state);
  });

  socket.on("pauseState", ({ code, paused, player }) => {
    const room = rooms.get(code);
    if (!room) return;
    socket.to(code).emit("pauseState", { paused, player });
  });

  socket.on("requestSnapshot", ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.lastState) return;
    socket.emit("hostSnapshot", room.lastState);
  });

  socket.on("disconnect", () => {
    console.log("❌ disconnect:", socket.id);
    for (const [code, room] of rooms.entries()) {
      if (!room.sockets.has(socket.id)) continue;
      room.sockets.delete(socket.id);
      socket.leave(code);

      if (room.hostId === socket.id) {
        // garde la room + snapshot, notifie le client
        room.hostId = null;
        io.to(code).emit("peerLeft", { reason: "host_left" });
        console.log(`⚠️ host left room ${code}, room persisted`);
      } else {
        // invité parti
        if (room.hostId) io.to(room.hostId).emit("peerLeft", { reason: "peer_left" });
        console.log(`👋 guest left room ${code}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("✅ Space Dual Server running on port", PORT);
});
