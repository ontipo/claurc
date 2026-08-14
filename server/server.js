require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const path = require("path");
const { pool } = require("./db");
const { generateMemberCode, generateNip, buildMemberCardPdf } = require("./cardGenerator");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.CLAURC_JWT_SECRET || "change-moi-en-production";
const SESSION_DURATION = "30d"; // "rester connecté" : jeton valide 30 jours

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function publicUser(u) {
  return {
    id: u.id, username: u.username, firstName: u.first_name, lastName: u.last_name,
    email: u.email, birthdate: u.birthdate, memberCode: u.member_code, createdAt: u.created_at,
  };
}
function signSession(u) {
  return jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: SESSION_DURATION });
}

// ---------- Vérifie que la base est prête (crée la table si besoin) ----------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(20) UNIQUE NOT NULL,
      first_name VARCHAR(80) NOT NULL,
      last_name VARCHAR(80) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      birthdate DATE NOT NULL,
      password_hash TEXT NOT NULL,
      member_code CHAR(7) UNIQUE NOT NULL,
      nip_hash TEXT NOT NULL,
      nip_valid BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// ---------- INSCRIPTION ----------
app.post("/api/auth/signup", async (req, res) => {
  const { username, firstName, lastName, email, birthdate, password } = req.body || {};
  const errors = [];
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) errors.push("Nom d'utilisateur invalide.");
  if (!firstName || !firstName.trim()) errors.push("Prénom requis.");
  if (!lastName || !lastName.trim()) errors.push("Nom requis.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email invalide.");
  if (!birthdate) errors.push("Date de naissance requise.");
  if (!password || password.length < 8) errors.push("Mot de passe : 8 caractères minimum.");
  if (errors.length) return res.status(400).json({ errors });

  const client = await pool.connect();
  try {
    const exists = await client.query("SELECT 1 FROM users WHERE email=$1 OR username=$2", [email.toLowerCase(), username]);
    if (exists.rowCount) return res.status(409).json({ errors: ["Email ou nom d'utilisateur déjà utilisé."] });

    let memberCode;
    for (let i = 0; i < 10; i++) {
      const candidate = generateMemberCode();
      const dup = await client.query("SELECT 1 FROM users WHERE member_code=$1", [candidate]);
      if (!dup.rowCount) { memberCode = candidate; break; }
    }
    if (!memberCode) return res.status(500).json({ errors: ["Réessayez, un code membre n'a pas pu être généré."] });

    const nip = generateNip();
    const [passwordHash, nipHash] = await Promise.all([bcrypt.hash(password, 12), bcrypt.hash(nip, 12)]);

    const result = await client.query(
      `INSERT INTO users (username, first_name, last_name, email, birthdate, password_hash, member_code, nip_hash, nip_valid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
      [username, firstName.trim(), lastName.trim(), email.toLowerCase(), birthdate, passwordHash, memberCode, nipHash]
    );
    const user = result.rows[0];

    const cardPdf = await buildMemberCardPdf({
      firstName: user.first_name, lastName: user.last_name, username: user.username,
      birthdate: user.birthdate, memberCode, nip,
    });

    res.status(201).json({
      token: signSession(user),
      user: publicUser(user),
      cardPdfBase64: cardPdf.toString("base64"),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ errors: ["Erreur serveur, réessayez."] });
  } finally {
    client.release();
  }
});

// ---------- CONNEXION (email ou code membre) ----------
app.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ errors: ["Identifiant et mot de passe requis."] });

  const result = await pool.query("SELECT * FROM users WHERE email=$1 OR member_code=$1", [identifier.trim().toLowerCase()]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ errors: ["Identifiants incorrects."] });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ errors: ["Identifiants incorrects."] });

  res.json({ token: signSession(user), user: publicUser(user) });
});

// ---------- SESSION : vérifie/renouvelle un jeton existant (reste connecté) ----------
app.get("/api/auth/me", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Jeton manquant." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [payload.sub]);
    if (!result.rowCount) return res.status(404).json({ error: "Utilisateur introuvable." });
    const user = result.rows[0];
    // jeton glissant : on le renouvelle à chaque vérification réussie pour garder la session active
    res.json({ user: publicUser(user), token: signSession(user) });
  } catch {
    res.status(401).json({ error: "Jeton invalide ou expiré." });
  }
});

// ---------- MOT DE PASSE OUBLIÉ : étape 1, vérifier carte + NIP ----------
app.post("/api/auth/forgot-password/verify", upload.single("card"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ errors: ["Carte (PDF) requise."] });
    const nip = (req.body.nip || "").trim().toUpperCase();
    if (!/^[0-9A-Z]{9}$/.test(nip)) return res.status(400).json({ errors: ["NIP invalide (9 caractères, 0-9 A-Z)."] });

    const parsed = await pdfParse(req.file.buffer);
    const match = parsed.text.match(/(\d[\s]?){7}/);
    if (!match) return res.status(400).json({ errors: ["Impossible de lire le code membre sur cette carte."] });
    const memberCode = match[0].replace(/\s/g, "");

    const result = await pool.query("SELECT * FROM users WHERE member_code=$1", [memberCode]);
    const user = result.rows[0];
    if (!user || !user.nip_valid) return res.status(401).json({ errors: ["Carte ou NIP invalide."] });

    const ok = await bcrypt.compare(nip, user.nip_hash);
    if (!ok) return res.status(401).json({ errors: ["Carte ou NIP invalide."] });

    const resetTicket = jwt.sign({ sub: user.id, purpose: "password-reset" }, JWT_SECRET, { expiresIn: "5m" });
    res.json({ resetTicket });
  } catch (err) {
    console.error(err);
    res.status(400).json({ errors: ["Fichier illisible."] });
  }
});

// ---------- MOT DE PASSE OUBLIÉ : étape 2, nouveau mot de passe ----------
app.post("/api/auth/forgot-password/reset", async (req, res) => {
  const { resetTicket, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ errors: ["Mot de passe : 8 caractères minimum."] });

  let payload;
  try {
    payload = jwt.verify(resetTicket, JWT_SECRET);
    if (payload.purpose !== "password-reset") throw new Error();
  } catch {
    return res.status(401).json({ errors: ["Session de récupération expirée, recommencez."] });
  }

  const client = await pool.connect();
  try {
    const result = await client.query("SELECT * FROM users WHERE id=$1", [payload.sub]);
    const user = result.rows[0];
    if (!user || !user.nip_valid) return res.status(401).json({ errors: ["Ancien NIP déjà utilisé, recommencez."] });

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    const newNip = generateNip();
    const newNipHash = await bcrypt.hash(newNip, 12);

    const updated = await client.query(
      `UPDATE users SET password_hash=$1, nip_hash=$2, nip_valid=TRUE, updated_at=now()
       WHERE id=$3 RETURNING *`,
      [newPasswordHash, newNipHash, user.id]
    );
    const u = updated.rows[0];

    const cardPdf = await buildMemberCardPdf({
      firstName: u.first_name, lastName: u.last_name, username: u.username,
      birthdate: u.birthdate, memberCode: u.member_code, nip: newNip,
    });

    res.json({
      token: signSession(u),
      user: publicUser(u),
      cardPdfBase64: cardPdf.toString("base64"),
    });
  } finally {
    client.release();
  }
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Claurc Auth Server sur http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Impossible de préparer la base Neon :", err);
    process.exit(1);
  });
