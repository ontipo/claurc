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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function publicUser(u) {
  return {
    id: u.id, username: u.username, firstName: u.first_name, lastName: u.last_name,
    email: u.email, birthdate: u.birthdate, memberCode: u.member_code, createdAt: u.created_at,
  };
}
function signToken(u) {
  return jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: "7d" });
}

// ---------- INSCRIPTION ----------
app.post("/api/auth/signup", async (req, res) => {
  const { username, firstName, lastName, email, birthdate, password } = req.body || {};
  const errors = [];
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) errors.push("Nom d'utilisateur invalide.");
  if (!firstName || firstName.trim().length < 1) errors.push("Prénom requis.");
  if (!lastName || lastName.trim().length < 1) errors.push("Nom requis.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email invalide.");
  if (!birthdate) errors.push("Date de naissance requise.");
  if (!password || password.length < 8) errors.push("Mot de passe : 8 caractères minimum.");
  if (errors.length) return res.status(400).json({ errors });

  const client = await pool.connect();
  try {
    const exists = await client.query("SELECT 1 FROM users WHERE email=$1 OR username=$2", [email.toLowerCase(), username]);
    if (exists.rowCount) return res.status(409).json({ errors: ["Email ou nom d'utilisateur déjà utilisé."] });

    // code membre unique
    let memberCode;
    for (let i = 0; i < 10; i++) {
      const candidate = generateMemberCode();
      const dup = await client.query("SELECT 1 FROM users WHERE member_code=$1", [candidate]);
      if (!dup.rowCount) { memberCode = candidate; break; }
    }
    if (!memberCode) return res.status(500).json({ errors: ["Impossible de générer un code membre, réessayez."] });

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
      token: signToken(user),
      user: publicUser(user),
      cardPdfBase64: cardPdf.toString("base64"),
    });
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

  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get("/api/auth/me", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Jeton manquant." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [payload.sub]);
    if (!result.rowCount) return res.status(404).json({ error: "Utilisateur introuvable." });
    res.json({ user: publicUser(result.rows[0]) });
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
      token: signToken(u),
      user: publicUser(u),
      cardPdfBase64: cardPdf.toString("base64"),
    });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => console.log(`Claurc Auth Server sur http://localhost:${PORT}`));
