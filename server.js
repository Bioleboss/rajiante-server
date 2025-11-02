// 🚀 Space Dual Server — v6 (stable, ping route + persistence)
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

// 🩵 route HTTP de test pour "réveiller" Render
app.get("/", (_, res) => res.send("🛰️ Space Dual Server awake and running"));

const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const rooms = new Map(); // code → { hostId, sockets:Set, lastState }

io.on("connection", (socket) => {
  console.log("🛰️ connect:", socket.id);

  socket.on("createRoom", (_, cb) => {
    let code;
    do { code = nano(); } while (rooms.has(code));
    rooms.set(code, { hostId: socket.id, sockets: new Set([socket.id]), lastState: null });
    socket.join(code);
    console.log("🚀 room created:", code);
    cb?.({ ok: true, code, isHost: true, playerIndex: 0 });
  });

  socket.on("joinRoom", (code, cb) => {
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Code invalide ou session expirée." });
    if (room.sockets.size >= 2) return cb?.({ ok: false, error: "Salle pleine." });

    room.sockets.add(socket.id);
    socket.join(code);
    cb?.({ ok: true, code, isHost: false, playerIndex: 1 });
    io.to(room.hostId).emit("peerJoined");
    console.log("👥 join:", socket.id, "room:", code);
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
    socket.to(code).volatile.emit("hostSnapshot", state); // envoi non bloquant
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
        // On garde la room pour permettre une reprise
        room.hostId = null;
        io.to(code).emit("peerLeft", { reason: "host_left" });
        console.log(`⚠️ host left ${code}, room persisted`);
      } else {
        if (room.hostId) io.to(room.hostId).emit("peerLeft", { reason: "peer_left" });
        console.log(`👋 guest left ${code}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("✅ Space Dual Server running on port", PORT);
});
