// Configuração do fluxo de trabalho (geral.md — execução dos contratos)

// Contratos: chave = nome do space no ClickUp (normalizado lowercase)
const CONTRACTS = {
  'procon uberlandia':     { label: 'Uberlândia',      homolog: 5, prod: 3, valida: [1, 2], retro: 4 },
  'procon almg':           { label: 'ALMG',            homolog: 1, prod: 4, valida: [2, 3], retro: 5 },
  'procon campina grande': { label: 'Campina Grande',  homolog: 4, prod: 2, valida: [5, 1], retro: 3 },
};

// Pipeline oficial (geral.md). Status legados caem em "outros".
const PIPELINE = ['pedido', 'solto', 'a fazer', 'fazendo', 'revisão', 'correção', 'homologação', 'executado'];
const OPEN_STATUSES = PIPELINE.filter(s => s !== 'executado');
const STATUS_META = {
  'pedido':      { grupo: 'não iniciado', cor: '#94a3b8' },
  'solto':       { grupo: 'não iniciado', cor: '#f97316' },
  'a fazer':     { grupo: 'em andamento', cor: '#38bdf8' },
  'fazendo':     { grupo: 'em andamento', cor: '#60a5fa' },
  'revisão':     { grupo: 'em andamento', cor: '#a78bfa' },
  'correção':    { grupo: 'em andamento', cor: '#f87171' },
  'homologação': { grupo: 'em andamento', cor: '#fbbf24' },
  'executado':   { grupo: 'fechado',      cor: '#34d399' },
};

// Tetos de carga semanal por pessoa (geral.md — "Balanceamento de carga")
// chave = username exato do ClickUp
const TEAM = {
  'Ana Maísa do Nascimento Santos': { papel: 'aprendiz', cards: 3, pontos: 4, maxPeso: 2, frente: 'gestão' },
  'Taiki Nakazawa':                 { papel: 'aprendiz', cards: 3, pontos: 4, maxPeso: 2, frente: 'gestão' },
  'Igor José Marinho Vieira':       { papel: 'dev', cards: 4, pontos: 8, maxPeso: 5, frente: 'gestão' },
  'Gustavo Dias Rosa':              { papel: 'dev', cards: 4, pontos: 8, maxPeso: 5, frente: 'gestão' },
  'Samuel Dionisio Costa':          { papel: 'dev', cards: 4, pontos: 8, maxPeso: 5, frente: 'gestão' },
  'William Richard Romão da Silva': { papel: 'dev', cards: 4, pontos: 8, maxPeso: 5, frente: 'fiscalização' },
  'Davizera':                       { papel: 'dev', cards: 4, pontos: 8, maxPeso: 5, frente: 'portal' },
  'Tobias Arantes Pref':            { papel: 'líder fiscalização', cards: 4, pontos: 8, maxPeso: 5, frente: 'fiscalização' },
  'Augusto Calixto':                { papel: 'líder portal', cards: 3, pontos: 8, maxPeso: 5, frente: 'portal' },
  'Bruno Castelo':                  { papel: 'líder gestão', cards: 2, pontos: 5, maxPeso: 5, frente: 'gestão' },
  'Igor Gregorio':                  { papel: 'diretor de operações', cards: 1, pontos: 5, maxPeso: 5, frente: 'todas' },
  'Igor Gouveia':                   { papel: 'diretor novos negócios', cards: null, pontos: null, maxPeso: null, frente: 'plataforma' },
};

const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

// O que acontece em cada dia da semana (0=dom)
function weekdayRoutine(day) {
  const out = { homolog: [], prod: [], valida: [], retro: [] };
  for (const c of Object.values(CONTRACTS)) {
    if (c.homolog === day) out.homolog.push(c.label);
    if (c.prod === day) out.prod.push(c.label);
    if (c.valida.includes(day)) out.valida.push(c.label);
    if (c.retro === day) out.retro.push(c.label);
  }
  return out;
}

// contract key por space name
function contractOf(spaceName) {
  const key = (spaceName || '').toLowerCase().trim();
  return CONTRACTS[key] ? key : key; // devolve a chave mesmo se desconhecido, pra não perder a task
}
function contractLabel(key) { return CONTRACTS[key] ? CONTRACTS[key].label : (key || '—'); }

// extrai "01 · [2] · título" → { ordem, peso, clean }
// na prática o peso também vem em tag ("1 muito fácil"…"4 difícil") — ver pesoDe()
function parseTitle(name) {
  const m = (name || '').match(/^\s*(\d{1,2})\s*[·\-.]\s*\[\s*(\d+)\s*\]\s*[·\-.]?\s*(.*)$/);
  if (m) return { ordem: +m[1], peso: +m[2], clean: m[3].trim() || name };
  const m2 = (name || '').match(/^\s*\[\s*(\d+)\s*\]\s*[·\-.]?\s*(.*)$/);
  if (m2) return { ordem: null, peso: +m2[1], clean: m2[2].trim() || name };
  return { ordem: null, peso: null, clean: name };
}

// peso: do título "[n]" ou da tag "N <nome>" (ex.: "3 médio")
function pesoDe(tagNames, titlePeso) {
  if (titlePeso != null) return titlePeso;
  for (const t of tagNames) {
    const m = (t.name || '').match(/^\s*(\d)\s/);
    if (m) return +m[1];
  }
  return null;
}

function parseRevisor(description) {
  const m = (description || '').match(/^revisor\s*:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

function isPacote(name) { return /^\s*pacote\b/i.test(name || ''); }

function isPacoteTag(tagName) { return tagName === 'pacote' || tagName === 'no-pacote'; }

function parsePacoteProducao(description) {
  const m = (description || '').match(/produ[çc][ãa]o\s*:\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
  return m ? m[1] : null;
}

module.exports = {
  CONTRACTS, PIPELINE, OPEN_STATUSES, STATUS_META, TEAM, WEEKDAYS,
  weekdayRoutine, contractOf, contractLabel, parseTitle, pesoDe, parseRevisor, isPacote, isPacoteTag, parsePacoteProducao,
};
