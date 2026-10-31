const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const MAX_PLAYERS = 4;
const ARENA = { width: 900, height: 600 };
const COLORS = ["#00d9ff", "#ff4d67", "#ffd34e", "#9b70ff"];

function makeCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function newPlayer(id, name, index) {
  return {
    id, name: String(name || "Racer").slice(0, 16),
    x: 150 + index * 65, y: 280 + (index % 2) * 65,
    angle: 0, color: COLORS[index % COLORS.length],
    hp: 100, kills: 0, deaths: 0, coins: 0,
    distance: 0, laps: 0, finished: false,
    input: { up: false, down: false, left: false, right: false },
    shootAt: 0, missileAt: 0, invulnerableUntil: 0
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y,
      angle: p.angle, color: p.color, hp: p.hp,
      kills: p.kills, deaths: p.deaths, coins: p.coins,
      laps: p.laps, finished: p.finished
    })),
    bullets: room.bullets,
    missiles: room.missiles,
    explosions: room.explosions,
    winner: room.winner
  };
}

function emitRoom(room) {
  io.to(room.code).emit("roomState", publicRoom(room));
}

function removePlayer(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;

  room.players.delete(socket.id);
  if (room.players.size === 0) {
    clearInterval(room.timer);
    rooms.delete(code);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
  }
  emitRoom(room);
}

io.on("connection", socket => {
  socket.emit("connected", { id: socket.id });

  socket.on("createRoom", ({ name, mode }, callback = () => {}) => {
    removePlayer(socket);
    let code;
    do { code = makeCode(); } while (rooms.has(code));

    const room = {
      code, hostId: socket.id, mode: mode === "race" ? "race" : "both",
      status: "waiting", players: new Map(),
      bullets: [], missiles: [], explosions: [],
      winner: null, timer: null, lastTick: Date.now()
    };
    room.players.set(socket.id, newPlayer(socket.id, name, 0));
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    callback({ ok: true, code, host: true });
    emitRoom(room);
  });

  socket.on("joinRoom", ({ code, name }, callback = () => {}) => {
    removePlayer(socket);
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, error: "Room not found. Check the code." });
    if (room.status !== "waiting") return callback({ ok: false, error: "This game has already started." });
    if (room.players.size >= MAX_PLAYERS) return callback({ ok: false, error: "Room is full (4 players maximum)." });

    const player = newPlayer(socket.id, name, room.players.size);
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;
    callback({ ok: true, code, host: room.hostId === socket.id });
    emitRoom(room);
  });

  socket.on("startGame", callback => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return callback?.({ ok: false, error: "Join a room first." });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Only the room host can start." });
    if (room.players.size < 2) return callback?.({ ok: false, error: "Invite at least one friend first." });
    if (room.status !== "waiting") return callback?.({ ok: false, error: "Game already started." });

    room.status = "playing";
    room.lastTick = Date.now();
    room.timer = setInterval(() => tick(room), 1000 / 30);
    emitRoom(room);
    callback?.({ ok: true });
  });

  socket.on("input", input => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!p || room.status !== "playing") return;
    for (const key of ["up", "down", "left", "right"]) {
      p.input[key] = !!input?.[key];
    }
  });

  socket.on("shoot", () => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!p || room.status !== "playing") return;
    const now = Date.now();
    if (now - p.shootAt < 350) return;
    p.shootAt = now;
    room.bullets.push({
      id: crypto.randomUUID(), owner: p.id,
      x: p.x + Math.cos(p.angle) * 27,
      y: p.y + Math.sin(p.angle) * 27,
      vx: Math.cos(p.angle) * 430,
      vy: Math.sin(p.angle) * 430,
      life: 1.5
    });
  });

  socket.on("missile", () => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!p || room.status !== "playing") return;
    const now = Date.now();
    if (now - p.missileAt < 1400) return;
    p.missileAt = now;
    room.missiles.push({
      id: crypto.randomUUID(), owner: p.id,
      x: p.x + Math.cos(p.angle) * 30,
      y: p.y + Math.sin(p.angle) * 30,
      vx: Math.cos(p.angle) * 250,
      vy: Math.sin(p.angle) * 250,
      life: 3
    });
  });

  socket.on("disconnect", () => removePlayer(socket));
});

function damagePlayer(room, victim, attacker, amount) {
  if (Date.now() < victim.invulnerableUntil) return;
  victim.hp -= amount;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.deaths++;
    if (attacker && attacker.id !== victim.id) attacker.kills++;
    room.explosions.push({ x: victim.x, y: victim.y, life: 0.55 });
    victim.x = 120 + Math.random() * 650;
    victim.y = 100 + Math.random() * 400;
    victim.hp = 100;
    victim.invulnerableUntil = Date.now() + 1800;
  }
}

function tick(room) {
  if (room.status !== "playing") return;
  const now = Date.now();
  const dt = Math.min((now - room.lastTick) / 1000, 0.06);
  room.lastTick = now;

  for (const p of room.players.values()) {
    const i = p.input;
    const turn = (Number(i.right) - Number(i.left)) * 2.8 * dt;
    p.angle += turn;
    const throttle = Number(i.up) - Number(i.down);
    const speed = 210;
    p.x += Math.cos(p.angle) * throttle * speed * dt;
    p.y += Math.sin(p.angle) * throttle * speed * dt;
    p.x = Math.max(35, Math.min(ARENA.width - 35, p.x));
    p.y = Math.max(65, Math.min(ARENA.height - 35, p.y));

    if (throttle > 0) p.distance += speed * dt;
    if (p.distance >= 1800) {
      p.distance -= 1800;
      p.laps++;
      if (p.laps >= 3 && !p.finished) {
        p.finished = true;
        if (!room.winner) room.winner = p.name;
      }
    }
  }

  function moveProjectile(list, isMissile) {
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let hit = false;

      for (const target of room.players.values()) {
        if (target.id === b.owner) continue;
        if (Math.hypot(target.x - b.x, target.y - b.y) < (isMissile ? 25 : 17)) {
          const attacker = room.players.get(b.owner);
          damagePlayer(room, target, attacker, isMissile ? 55 : 25);
          if (isMissile) room.explosions.push({ x: b.x, y: b.y, life: 0.4 });
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0 || b.x < 0 || b.x > ARENA.width || b.y < 0 || b.y > ARENA.height) {
        list.splice(i, 1);
      }
    }
  }

  moveProjectile(room.bullets, false);
  moveProjectile(room.missiles, true);

  room.explosions = room.explosions.filter(e => (e.life -= dt) > 0);
  emitRoom(room);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Turbo Racing server listening on ${PORT}`));