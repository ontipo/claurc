CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  birthdate DATE NOT NULL,
  password_hash TEXT NOT NULL,
  member_code CHAR(7) UNIQUE NOT NULL,      -- code principal (0-9)
  nip_hash TEXT NOT NULL,                    -- NIP haché (0-9A-Z, 9 caractères)
  nip_valid BOOLEAN NOT NULL DEFAULT TRUE,   -- devient false une fois utilisé pour un reset
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_member_code ON users(member_code);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
