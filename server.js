// 🚀 Space Dual Server — v6.1 (WS fallback-safe + health routes)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

const app = express();

// Petites routes de santé (aident Netlify/Render à vérifier que le service répond)
app.get("/", (_req, res) => res.status(200).send("OK Space Dual"));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  perMessageDeflate: false, // évite des soucis proxys
  // path: "/socket.io" // défaut; garde-le si tu veux expliciter
});

const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const rooms = new Map();

// Nettoyage périodique des rooms inactives
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const inactive = !room.hostId && (!room.lastActive || now - room.lastActive > 5 * 60 * 1000);
    if (inactive || room.sockets.size === 0) {
      rooms.delete(code);
      console.log(`🧹 Room ${code} supprimée`);
    }
  }
}, 60_000);

io.on("connection", (socket) => {
  console.log("🛰️ Nouveau client:", socket.id);

  const touch = (code) => {
    const r = rooms.get(code);
    if (r) r.lastActive = Date.now();
  };

  socket.on("pingTest", (_, cb) => cb && cb("pong"));

  socket.on("createRoom", (_, cb) => {
    try {
      let code;
      do { code = nano(); } while (rooms.has(code));
      rooms.set(code, { hostId: socket.id, sockets: new Set([socket.id]), lastState: null, lastActive: Date.now() });
      socket.join(code);
      console.log(`🚀 Room créée: ${code}`);
      cb?.({ ok: true, code, isHost: true, playerIndex: 0 });
    } catch (e) {
      console.error("createRoom error:", e);
      cb?.({ ok: false, error: "Erreur serveur (createRoom)" });
    }
  });

  socket.on("joinRoom", (code, cb) => {
    try {
      const room = rooms.get(code);
      if (!room) return cb?.({ ok: false, error: "Code invalide." });
      if (room.sockets.size >= 2) return cb?.({ ok: false, error: "Salle pleine." });

      room.sockets.add(socket.id);
      touch(code);
      socket.join(code);
      cb?.({ ok: true, code, isHost: false, playerIndex: 1 });
      io.to(room.hostId).emit("peerJoined");
      console.log(`👥 ${socket.id} a rejoint ${code}`);
    } catch (e) {
      console.error("joinRoom error:", e);
      cb?.({ ok: false, error: "Erreur serveur (joinRoom)" });
    }
  });

  socket.on("clientInput", ({ code, input }) => {
    const room = rooms.get(code);
    if (!room) return;
    touch(code);
    io.to(room.hostId).emit("clientInput", { id: socket.id, input });
  });

  socket.on("hostSnapshot", ({ code, state }) => {
    const room = rooms.get(code);
    if (!room) return;
    touch(code);
    room.lastState = state;
    socket.to(code).volatile.emit("hostSnapshot", state);
  });

  socket.on("pauseState", ({ code, paused, player }) => {
    const room = rooms.get(code);
    if (!room) return;
    touch(code);
    socket.to(code).emit("pauseState", { paused, player });
  });

  socket.on("requestSnapshot", ({ code }) => {
    const room = rooms.get(code);
    if (room?.lastState) socket.emit("hostSnapshot", room.lastState);
  });

  socket.on("disconnect", () => {
    console.log("❌ Déco:", socket.id);
    for (const [code, room] of rooms.entries()) {
      if (!room.sockets.has(socket.id)) continue;
      room.sockets.delete(socket.id);
      socket.leave(code);

      if (room.hostId === socket.id) {
        io.to(code).emit("peerLeft", { reason: "host_left" });
        room.hostId = null; // laisse la room vivante quelques minutes
        console.log(`⚠️ Host a quitté ${code}`);
      } else if (room.hostId) {
        io.to(room.hostId).emit("peerLeft", { reason: "peer_left" });
        console.log(`👋 Joueur a quitté ${code}`);
      }

      if (room.sockets.size === 0) {
        rooms.delete(code);
        console.log(`🗑️ Room ${code} supprimée (vide)`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("✅ Space Dual Server running on port", PORT);
});
