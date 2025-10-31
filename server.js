// 🚀 Space Dual Server (v3) — pause auto + reconnexion
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" } // autorise tous les domaines (Netlify, Render, etc.)
});

// Générateur de codes de room (5 lettres/chiffres)
const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

// Structure interne des rooms :
// {
//   hostId: "socketId",
//   sockets: Set([...]),
//   lastState: {}  ← snapshot du host pour reprise solo/rejoin
// }
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("🛰️ Client connecté :", socket.id);

  // --- Création de room
  socket.on("createRoom", (_, cb) => {
    let code;
    do { code = nano(); } while (rooms.has(code));

    rooms.set(code, {
      hostId: socket.id,
      sockets: new Set([socket.id]),
      lastState: null
    });

    socket.join(code);
    console.log(`🚀 Room créée : ${code}`);
    cb({ ok: true, code, isHost: true, playerIndex: 0 });
  });

  // --- Rejoindre une room existante
  socket.on("joinRoom", (code, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Code invalide ou session expirée." });

    // Si le host est parti mais la room existe toujours → reprise possible
    if (!room.hostId) {
      room.hostId = socket.id;
      room.sockets.add(socket.id);
      socket.join(code);
      console.log(`♻️ Reconnexion en tant que nouveau host sur ${code}`);
      return cb({ ok: true, code, isHost: true, playerIndex: 0, resumed: true });
    }

    // Cas normal : rejoindre la partie en cours
    if (room.sockets.size >= 2) return cb({ ok: false, error: "Salle pleine." });
    room.sockets.add(socket.id);
    socket.join(code);

    cb({ ok: true, code, isHost: false, playerIndex: 1 });
    io.to(room.hostId).emit("peerJoined");
    console.log(`👥 ${socket.id} a rejoint la room ${code}`);
  });

  // --- Input du client vers host
  socket.on("clientInput", ({ code, input }) => {
    const room = rooms.get(code);
    if (!room || !room.hostId) return;
    io.to(room.hostId).emit("clientInput", { id: socket.id, input });
  });

  // --- Snapshot du host vers client
  socket.on("hostSnapshot", ({ code, state }) => {
    const room = rooms.get(code);
    if (!room) return;
    room.lastState = state; // garde le dernier snapshot pour reprise
    socket.to(code).emit("hostSnapshot", state);
  });

  // --- Pause synchronisée
  socket.on("pauseState", ({ code, paused, player }) => {
    const room = rooms.get(code);
    if (!room) return;
    socket.to(code).emit("pauseState", { paused, player });
  });

  // --- Requête de snapshot (client se reconnecte)
  socket.on("requestSnapshot", ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.lastState) return;
    console.log(`📦 Envoi snapshot de reprise à ${socket.id} (room ${code})`);
    socket.emit("hostSnapshot", room.lastState);
  });

  // --- Déconnexion d’un joueur
  socket.on("disconnect", () => {
    console.log("❌ Déconnexion :", socket.id);

    for (const [code, room] of rooms.entries()) {
      if (!room.sockets.has(socket.id)) continue;

      room.sockets.delete(socket.id);
      socket.leave(code);

      // Si le host quitte :
      if (room.hostId === socket.id) {
        console.log(`⚠️ Host ${socket.id} a quitté la room ${code}`);
        room.hostId = null; // on garde la room et le snapshot
        io.to(code).emit("peerLeft", { reason: "host_left" });
        continue;
      }

      // Si c’est un joueur invité
      io.to(room.hostId).emit("peerLeft", { reason: "peer_left" });
      console.log(`👋 Joueur invité parti (room ${code})`);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("✅ Space Dual Server running on port", PORT);
});
