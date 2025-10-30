import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" } // autorise tous les domaines (Netlify, etc.)
});

// Générateur de codes de room (5 lettres/chiffres)
const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

// Dictionnaire des rooms : { CODE: { hostId, sockets:Set() } }
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("🛰️ Nouveau client connecté:", socket.id);

  // Création de room
  socket.on("createRoom", (_, cb) => {
    let code;
    do { code = nano(); } while (rooms.has(code));
    rooms.set(code, { hostId: socket.id, sockets: new Set([socket.id]) });
    socket.join(code);
    console.log(`🚀 Room créée: ${code}`);
    cb({ ok: true, code, isHost: true, playerIndex: 0 });
  });

  // Rejoindre une room
  socket.on("joinRoom", (code, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Code invalide." });
    if (room.sockets.size >= 2) return cb({ ok: false, error: "Salle pleine." });

    room.sockets.add(socket.id);
    socket.join(code);
    cb({ ok: true, code, isHost: false, playerIndex: 1 });

    io.to(room.hostId).emit("peerJoined");
    console.log(`👥 ${socket.id} a rejoint la room ${code}`);
  });

  // Input du joueur → relayé vers le host
  socket.on("clientInput", ({ code, input }) => {
    const room = rooms.get(code);
    if (!room) return;
    io.to(room.hostId).emit("clientInput", { id: socket.id, input });
  });

  // Snapshot du host → relayé vers les autres
  socket.on("hostSnapshot", ({ code, state }) => {
    const room = rooms.get(code);
    if (!room) return;
    socket.to(code).emit("hostSnapshot", state);
  });

  // Déconnexion
  socket.on("disconnect", () => {
    console.log("❌ Client déconnecté:", socket.id);
    for (const [code, room] of rooms.entries()) {
      if (room.sockets.has(socket.id)) {
        room.sockets.delete(socket.id);
        socket.leave(code);

        if (room.hostId === socket.id) {
          // Host quitte = fermer la room
          io.to(code).emit("roomClosed");
          io.in(code).socketsLeave(code);
          rooms.delete(code);
          console.log(`💥 Room ${code} fermée (host parti)`);
        } else {
          io.to(room.hostId).emit("peerLeft");
          console.log(`👋 Un joueur a quitté la room ${code}`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("✅ Space Dual Server running on port", PORT);
});
