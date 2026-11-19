-- MATRIX CRM · banco de dados (etapa 1: contas, logins e subcontas)
CREATE TABLE IF NOT EXISTS subcontas (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, cor TEXT NOT NULL DEFAULT '#00e676',
  ativa INTEGER NOT NULL DEFAULT 1, cliente_controla INTEGER NOT NULL DEFAULT 0,
  ag_recepcionista INTEGER NOT NULL DEFAULT 0, ag_sdr INTEGER NOT NULL DEFAULT 0,
  ag_lembretes INTEGER NOT NULL DEFAULT 0, ag_pos INTEGER NOT NULL DEFAULT 0,
  criada_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY, subconta_id TEXT REFERENCES subcontas(id),
  nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL,
  funcao TEXT NOT NULL CHECK (funcao IN ('dono','admin','atendente','dentista')),
  ativo INTEGER NOT NULL DEFAULT 1, trocar_senha INTEGER NOT NULL DEFAULT 0, criado_em INTEGER NOT NULL,
  totp_secret TEXT, totp_ativo INTEGER NOT NULL DEFAULT 0, totp_ultimo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usuarios_subconta ON usuarios(subconta_id);
CREATE TABLE IF NOT EXISTS sessoes (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  vendo TEXT, expira INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tentativas (chave TEXT PRIMARY KEY, n INTEGER NOT NULL, ate INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, quando INTEGER NOT NULL, usuario_id TEXT, subconta_id TEXT, acao TEXT NOT NULL, detalhe TEXT
);
CREATE TABLE IF NOT EXISTS codigos_reserva (hash TEXT PRIMARY KEY, usuario_id TEXT NOT NULL);
