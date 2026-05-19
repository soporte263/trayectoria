require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CAMBIA_ESTE_SECRETO";
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://trayectoriaconsultores.com").replace(/\/$/, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PROGRESS_FILE = path.join(DATA_DIR, "progress.json");
const SITE_CONFIG_FILE = path.join(DATA_DIR, "site-config.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureFile(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), "utf8");
  }
}

ensureFile(USERS_FILE, []);
ensureFile(PROGRESS_FILE, {});
ensureFile(SITE_CONFIG_FILE, {
  videos: 11,
  sesiones: 4,
  semanas: 3,
  precio: 14990,
  agendaUrl: "https://calendar.app.google/5V9SZueXryy5k9YV6",
  ctaPrincipal: "Agenda tu diagnóstico",
  ctaPago: "Finalizar inscripción",
  mensaje: "Agenda una conversación de diagnóstico sin costo. 45 minutos. Sin compromiso."
});

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

app.use(express.json());

app.use(cors({
  origin: [
    FRONTEND_URL,
    "https://www.trayectoriaconsultores.com",
    "https://trayectoriaconsultores.com",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  credentials: true
}));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Trayectoria Backend Plataforma V2",
    status: "online"
  });
});

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role || "participant"
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No autorizado." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o expirada." });
  }
}

function adminRequired(req, res, next) {
  const password = req.headers["x-admin-password"] || req.body?.password;

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: "ADMIN_PASSWORD no está configurada." });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Contraseña admin inválida." });
  }

  next();
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role || "participant",
    status: user.status || "active",
    createdAt: user.createdAt
  };
}

function defaultProgress() {
  return {
    progress: 0,
    currentWeek: 1,
    totalWeeks: 3,
    videosCompleted: 0,
    totalVideos: 11,
    nextSession: null,
    modules: [
      {
        id: "diagnostico",
        title: "Diagnóstico profesional",
        status: "available",
        progress: 0
      },
      {
        id: "marca-personal",
        title: "Marca personal y posicionamiento",
        status: "locked",
        progress: 0
      },
      {
        id: "estrategia-laboral",
        title: "Estrategia laboral y entrevistas",
        status: "locked",
        progress: 0
      }
    ],
    videos: [
      { id: "v1", title: "Bienvenida al programa", duration: "5 min", completed: false },
      { id: "v2", title: "Diagnóstico de trayectoria", duration: "7 min", completed: false },
      { id: "v3", title: "Narrativa profesional", duration: "6 min", completed: false }
    ],
    sessions: [
      {
        id: "s1",
        title: "Sesión inicial",
        date: null,
        meetUrl: "",
        status: "pending"
      }
    ],
    materials: [
      {
        id: "m1",
        title: "Guía de diagnóstico inicial",
        url: "#",
        type: "PDF"
      }
    ]
  };
}

// =======================
// AUTH PARTICIPANTES
// =======================

app.post("/participant-auth/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
  }

  const users = readJson(USERS_FILE, []);
  const user = users.find(u => String(u.email).toLowerCase() === String(email).toLowerCase());

  if (!user) {
    return res.status(401).json({ error: "Credenciales inválidas." });
  }

  if ((user.status || "active") !== "active") {
    return res.status(403).json({ error: "Cuenta no activa." });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Credenciales inválidas." });
  }

  const token = createToken(user);

  res.json({
    ok: true,
    token,
    participant: publicUser(user)
  });
});

app.get("/participant-auth/me", authRequired, (req, res) => {
  const users = readJson(USERS_FILE, []);
  const user = users.find(u => u.id === req.user.id);

  if (!user) {
    return res.status(404).json({ error: "Usuario no encontrado." });
  }

  res.json({
    ok: true,
    participant: publicUser(user)
  });
});

app.post("/participant-auth/logout", authRequired, (req, res) => {
  res.json({ ok: true });
});

// =======================
// DASHBOARD PARTICIPANTE
// =======================

app.get("/participant/dashboard", authRequired, (req, res) => {
  const users = readJson(USERS_FILE, []);
  const progressData = readJson(PROGRESS_FILE, {});

  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });

  const progress = progressData[user.id] || defaultProgress();

  res.json({
    ok: true,
    participant: publicUser(user),
    dashboard: progress
  });
});

app.post("/participant/video/:videoId/complete", authRequired, (req, res) => {
  const progressData = readJson(PROGRESS_FILE, {});
  const current = progressData[req.user.id] || defaultProgress();

  current.videos = current.videos.map(v =>
    v.id === req.params.videoId ? { ...v, completed: true } : v
  );

  current.videosCompleted = current.videos.filter(v => v.completed).length;
  current.totalVideos = current.videos.length || 11;
  current.progress = Math.round((current.videosCompleted / current.totalVideos) * 100);

  progressData[req.user.id] = current;
  writeJson(PROGRESS_FILE, progressData);

  res.json({ ok: true, dashboard: current });
});

// =======================
// ADMIN SIMPLE
// =======================

app.post("/admin/create-participant", adminRequired, async (req, res) => {
  const { fullName, email, password } = req.body || {};

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "Nombre, correo y contraseña son obligatorios." });
  }

  const users = readJson(USERS_FILE, []);
  const exists = users.find(u => String(u.email).toLowerCase() === String(email).toLowerCase());

  if (exists) {
    return res.status(409).json({ error: "Ya existe un usuario con ese correo." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    fullName,
    email,
    passwordHash,
    role: "participant",
    status: "active",
    createdAt: new Date().toISOString()
  };

  users.push(user);
  writeJson(USERS_FILE, users);

  const progressData = readJson(PROGRESS_FILE, {});
  progressData[user.id] = defaultProgress();
  writeJson(PROGRESS_FILE, progressData);

  res.json({
    ok: true,
    participant: publicUser(user)
  });
});

app.get("/admin/participants", adminRequired, (req, res) => {
  const users = readJson(USERS_FILE, []);
  res.json({
    ok: true,
    participants: users.map(publicUser)
  });
});

app.post("/admin/progress/:participantId", adminRequired, (req, res) => {
  const { participantId } = req.params;
  const progressData = readJson(PROGRESS_FILE, {});

  const current = progressData[participantId] || defaultProgress();
  const next = {
    ...current,
    ...req.body.progress
  };

  progressData[participantId] = next;
  writeJson(PROGRESS_FILE, progressData);

  res.json({
    ok: true,
    dashboard: next
  });
});

// =======================
// SITE CONFIG
// =======================

function sanitizeSiteConfig(config) {
  return {
    videos: Number(config.videos || 11),
    sesiones: Number(config.sesiones || 4),
    semanas: Number(config.semanas || 3),
    precio: Number(config.precio || 14990),
    agendaUrl: String(config.agendaUrl || "https://calendar.app.google/5V9SZueXryy5k9YV6").trim(),
    ctaPrincipal: String(config.ctaPrincipal || "Agenda tu diagnóstico").trim(),
    ctaPago: String(config.ctaPago || "Finalizar inscripción").trim(),
    mensaje: String(config.mensaje || "").trim()
  };
}

app.get("/site-config", (req, res) => {
  res.json(sanitizeSiteConfig(readJson(SITE_CONFIG_FILE, {})));
});

app.post("/admin/site-config", (req, res) => {
  const { password, config } = req.body || {};

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: "ADMIN_PASSWORD no está configurada en Render." });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Contraseña admin inválida." });
  }

  const cleanConfig = sanitizeSiteConfig(config || {});
  writeJson(SITE_CONFIG_FILE, cleanConfig);

  res.json({
    ok: true,
    config: cleanConfig
  });
});

// =======================
// STRIPE PLACEHOLDER
// =======================

app.post("/create-checkout-session", (req, res) => {
  return res.status(501).json({
    error: "Stripe todavía no está configurado. Agrega STRIPE_SECRET_KEY y Price IDs para activar checkout."
  });
});

// =======================

app.listen(PORT, () => {
  console.log(`Trayectoria backend escuchando en puerto ${PORT}`);
  console.log(`DATA_DIR usado: ${DATA_DIR}`);
});
