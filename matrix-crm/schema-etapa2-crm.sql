-- MATRIX CRM · banco de dados (etapa 2: dados do CRM)
-- Modelo copiado do Twenty CRM (github.com/twentyhq/twenty, packages/twenty-server/src/modules/*/standard-objects)
-- e adaptado para clínica + subcontas. Só ACRESCENTA tabelas: não altera nada da etapa 1 (schema.sql).
-- Aplicar quando quiser (NÃO foi aplicado):  npx wrangler d1 execute <banco> --remote --file=schema-etapa2-crm.sql
--
-- Twenty            -> Matrix
-- person            -> pacientes        (name/emails/phones/jobTitle/company/position)
-- company           -> empresas         (convênio, empresa parceira ou empresa do paciente)
-- opportunity       -> oportunidades    (tratamento/orçamento no funil: amount, closeDate, stage, probability)
-- task + taskTarget -> tarefas + tarefa_alvos
-- note + noteTarget -> notas + nota_alvos
-- timelineActivity  -> linha_do_tempo
-- attachment        -> anexos
-- metadados de campos personalizados (objectMetadata/fieldMetadata) -> campos_personalizados + valores em JSON (extras)
-- etapas do funil (select "stage": NEW, SCREENING, MEETING, PROPOSAL, CUSTOMER) -> funil_etapas, editável por subconta
-- Datas: INTEGER em milissegundos (Date.now()), igual à etapa 1. Dinheiro: INTEGER em centavos (Twenty usa amountMicros).
-- Toda tabela tem subconta_id: cada clínica só vê os próprios dados.

CREATE TABLE IF NOT EXISTS empresas (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  nome TEXT NOT NULL, dominio TEXT, linkedin TEXT, endereco TEXT,
  tipo TEXT NOT NULL DEFAULT 'empresa' CHECK (tipo IN ('empresa','convenio','parceiro')),
  responsavel_id TEXT REFERENCES usuarios(id),           -- Twenty: accountOwner
  extras TEXT NOT NULL DEFAULT '{}', posicao REAL NOT NULL DEFAULT 0,
  criado_por TEXT, criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL, apagado_em INTEGER
);
CREATE INDEX IF NOT EXISTS idx_empresas_subconta ON empresas(subconta_id, apagado_em);

CREATE TABLE IF NOT EXISTS pacientes (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  nome TEXT NOT NULL, sobrenome TEXT,                    -- Twenty: name { firstName, lastName }
  email TEXT, emails_extras TEXT NOT NULL DEFAULT '[]',  -- Twenty: emails { primaryEmail, additionalEmails }
  celular TEXT, telefones_extras TEXT NOT NULL DEFAULT '[]', -- Twenty: phones; celular = chave do WhatsApp (Morfeus)
  cpf TEXT, nascimento TEXT, profissao TEXT,             -- Twenty: jobTitle
  empresa_id TEXT REFERENCES empresas(id),               -- Twenty: company
  dentista_id TEXT REFERENCES usuarios(id),
  origem TEXT,                                           -- whatsapp, site, indicação...
  saude TEXT NOT NULL DEFAULT '{}',                      -- diabetes, fumante, gestante (tela paciente.html)
  observacoes TEXT, ultima_consulta INTEGER, proximo_retorno INTEGER,
  extras TEXT NOT NULL DEFAULT '{}', posicao REAL NOT NULL DEFAULT 0,
  criado_por TEXT, criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL, apagado_em INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pacientes_subconta ON pacientes(subconta_id, apagado_em);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pacientes_celular ON pacientes(subconta_id, celular) WHERE celular IS NOT NULL AND apagado_em IS NULL;

CREATE TABLE IF NOT EXISTS funil_etapas (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  nome TEXT NOT NULL, cor TEXT, posicao REAL NOT NULL DEFAULT 0,
  tipo TEXT NOT NULL DEFAULT 'aberta' CHECK (tipo IN ('aberta','ganha','perdida'))
);
CREATE INDEX IF NOT EXISTS idx_funil_etapas_subconta ON funil_etapas(subconta_id, posicao);

CREATE TABLE IF NOT EXISTS oportunidades (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  titulo TEXT NOT NULL,                                  -- Twenty: name
  valor_centavos INTEGER, moeda TEXT NOT NULL DEFAULT 'BRL', -- Twenty: amount { amountMicros, currencyCode }
  previsao_fechamento INTEGER,                           -- Twenty: closeDate
  etapa_id TEXT REFERENCES funil_etapas(id),             -- Twenty: stage
  probabilidade INTEGER,                                 -- Twenty: probability
  procedimento TEXT,
  paciente_id TEXT REFERENCES pacientes(id),             -- Twenty: pointOfContact
  empresa_id TEXT REFERENCES empresas(id),               -- Twenty: company
  responsavel_id TEXT REFERENCES usuarios(id),           -- Twenty: owner
  extras TEXT NOT NULL DEFAULT '{}', posicao REAL NOT NULL DEFAULT 0,
  criado_por TEXT, criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL, apagado_em INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oportunidades_funil ON oportunidades(subconta_id, etapa_id, posicao);
CREATE INDEX IF NOT EXISTS idx_oportunidades_paciente ON oportunidades(paciente_id);

CREATE TABLE IF NOT EXISTS tarefas (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  titulo TEXT NOT NULL, corpo TEXT, vence_em INTEGER,    -- Twenty: title, bodyV2, dueAt
  status TEXT NOT NULL DEFAULT 'a_fazer' CHECK (status IN ('a_fazer','fazendo','feita')), -- TODO/IN_PROGRESS/DONE
  responsavel_id TEXT REFERENCES usuarios(id),           -- Twenty: assignee
  posicao REAL NOT NULL DEFAULT 0,
  criado_por TEXT, criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL, apagado_em INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tarefas_subconta ON tarefas(subconta_id, status, vence_em);

-- Alvos: uma tarefa/nota pode ficar ligada a vários pacientes, empresas ou oportunidades (Twenty: taskTarget/noteTarget)
CREATE TABLE IF NOT EXISTS tarefa_alvos (
  id TEXT PRIMARY KEY, tarefa_id TEXT NOT NULL REFERENCES tarefas(id),
  paciente_id TEXT REFERENCES pacientes(id), empresa_id TEXT REFERENCES empresas(id), oportunidade_id TEXT REFERENCES oportunidades(id)
);
CREATE INDEX IF NOT EXISTS idx_tarefa_alvos_tarefa ON tarefa_alvos(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_tarefa_alvos_paciente ON tarefa_alvos(paciente_id);

CREATE TABLE IF NOT EXISTS notas (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  titulo TEXT, corpo TEXT, posicao REAL NOT NULL DEFAULT 0,
  criado_por TEXT, criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL, apagado_em INTEGER
);
CREATE TABLE IF NOT EXISTS nota_alvos (
  id TEXT PRIMARY KEY, nota_id TEXT NOT NULL REFERENCES notas(id),
  paciente_id TEXT REFERENCES pacientes(id), empresa_id TEXT REFERENCES empresas(id), oportunidade_id TEXT REFERENCES oportunidades(id)
);
CREATE INDEX IF NOT EXISTS idx_nota_alvos_nota ON nota_alvos(nota_id);
CREATE INDEX IF NOT EXISTS idx_nota_alvos_paciente ON nota_alvos(paciente_id);

CREATE TABLE IF NOT EXISTS anexos (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  nome TEXT NOT NULL, arquivo_url TEXT NOT NULL, tipo TEXT, -- guardar o arquivo no R2
  paciente_id TEXT REFERENCES pacientes(id), empresa_id TEXT REFERENCES empresas(id),
  oportunidade_id TEXT REFERENCES oportunidades(id), tarefa_id TEXT REFERENCES tarefas(id), nota_id TEXT REFERENCES notas(id),
  criado_por TEXT, criado_em INTEGER NOT NULL, apagado_em INTEGER
);

-- Linha do tempo (Twenty: timelineActivity): tudo que acontece com um registro, inclusive conversas do WhatsApp
CREATE TABLE IF NOT EXISTS linha_do_tempo (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  acontece_em INTEGER NOT NULL,
  evento TEXT NOT NULL,                                  -- ex.: paciente.criado, oportunidade.etapa, whatsapp.mensagem
  propriedades TEXT NOT NULL DEFAULT '{}',               -- antes/depois, texto da mensagem etc.
  usuario_id TEXT REFERENCES usuarios(id),               -- null = agente (Morfeus, lembretes...)
  paciente_id TEXT REFERENCES pacientes(id), empresa_id TEXT REFERENCES empresas(id),
  oportunidade_id TEXT REFERENCES oportunidades(id), tarefa_id TEXT REFERENCES tarefas(id), nota_id TEXT REFERENCES notas(id)
);
CREATE INDEX IF NOT EXISTS idx_linha_paciente ON linha_do_tempo(paciente_id, acontece_em);
CREATE INDEX IF NOT EXISTS idx_linha_oportunidade ON linha_do_tempo(oportunidade_id, acontece_em);

-- Chaves de integração (ex.: Morfeus no WhatsApp). Só o hash da chave fica no banco; cada chave vale para UMA subconta.
CREATE TABLE IF NOT EXISTS integracoes (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  nome TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, ativa INTEGER NOT NULL DEFAULT 1,
  criada_em INTEGER NOT NULL, ultimo_uso INTEGER
);

-- Campos personalizados (Twenty: fieldMetadata). O valor fica em <tabela>.extras como JSON { "chave": valor }
CREATE TABLE IF NOT EXISTS campos_personalizados (
  id TEXT PRIMARY KEY, subconta_id TEXT NOT NULL REFERENCES subcontas(id),
  objeto TEXT NOT NULL CHECK (objeto IN ('pacientes','empresas','oportunidades')),
  chave TEXT NOT NULL, rotulo TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('texto','numero','data','booleano','selecao','multi_selecao','moeda','telefone','email','link')),
  opcoes TEXT NOT NULL DEFAULT '[]', obrigatorio INTEGER NOT NULL DEFAULT 0, posicao REAL NOT NULL DEFAULT 0,
  UNIQUE (subconta_id, objeto, chave)
);
