require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');

const { db, openTasks, taskById, taskEvents, firstSeenStatus } = require('./db');
const { sync } = require('./sync');
const snapshot = require('./snapshot');
const discord = require('./discord');
const auth = require('./auth');
const C = require('./config');

const app = express();
const PORT = +(process.env.PORT || 3000);
const TZ = process.env.TZ || 'America/Sao_Paulo';
const POLL = process.env.POLL_SCHEDULE || '*/15 * * * *';
const CRON_SNAPSHOT = process.env.CRON_SCHEDULE || '0 6 * * *';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use(auth.middleware);

// ---------- helpers ----------
function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function weekdayOf(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay();
}
function fmtDate(ms) {
  if (!ms) return '';
  return new Date(+ms).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
}
function isOverdue(t, ref) {
  return t.due_date && t.due_date < ref && !['executado', 'closed', 'complete'].includes(t.status);
}
function jstr(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }
// cor de texto legível sobre o fundo da tag (ClickUp às vezes manda fg == bg)
function tagStyle(tag) {
  const hex = (tag.bg || '').replace('#', '');
  if (hex.length < 6) return 'background:var(--panel2);color:var(--muted)';
  const n = parseInt(hex.slice(0, 6), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return `background:${tag.bg};color:${lum > 0.55 ? '#1a2430' : '#e8eef5'}`;
}
function decorate(t) {
  return {
    ...t,
    assigneeList: jstr(t.assignees),
    tagList: jstr(t.tags).map(tag => ({ ...tag, style: tagStyle(tag) })),
    dueFmt: fmtDate(t.due_date),
    contractLabel: C.contractLabel(t.contract),
  };
}
function byStatus(tasks) {
  const m = {};
  for (const s of C.PIPELINE) m[s] = [];
  m['outros'] = [];
  for (const t of tasks) (m[C.PIPELINE.includes(t.status) ? t.status : 'outros']).push(t);
  return m;
}
function hasDevBlock(t) {
  return /para o dev/i.test(t.description_excerpt || '');
}
function endOfDayMs(dateStr) { return new Date(dateStr + 'T23:59:59.999').getTime(); }

// ---------- auth ----------
app.get('/login', (req, res) => {
  if (req.authed) return res.redirect('/');
  res.render('login', { erro: req.query.erro });
});
app.post('/login', (req, res) => {
  const { email, senha } = req.body;
  if (auth.validLogin((email || '').trim(), senha)) { auth.issueCookie(res); return res.redirect('/'); }
  res.redirect('/login?erro=1');
});
app.get('/logout', (req, res) => { auth.clearCookie(res); res.redirect('/login'); });

app.use(auth.requireAuth);

// ---------- dashboard ----------
app.get('/', (req, res) => {
  const today = todayStr();
  const dow = weekdayOf(today);
  const todayEnd = endOfDayMs(today);
  const routine = C.weekdayRoutine(dow);
  const tasks = openTasks().map(decorate);

  const byContract = {};
  for (const t of tasks) {
    (byContract[t.contract] = byContract[t.contract] || []).push(t);
  }

  // ---- "Meu dia": filas de ação do líder ----
  const soltos = tasks.filter(t => t.status === 'solto' || jstr(t.tags).some(x => x.name === 'solto'));
  const pedidos = tasks.filter(t => t.status === 'pedido');
  const emRevisao = tasks.filter(t => t.status === 'revisão');
  const correcoes = tasks.filter(t => t.status === 'correção');
  const suporte = tasks.filter(t => jstr(t.tags).some(x => x.name === 'suporte'));
  const higiene = tasks.filter(t =>
    ['a fazer', 'fazendo'].includes(t.status) && (!t.peso || !t.revisor));
  const pacotesExecutados = db.prepare(`SELECT * FROM tasks WHERE is_pacote=1 AND status='executado' ORDER BY date_updated DESC LIMIT 10`).all()
    .map(decorate)
    .filter(p => !db.prepare(`SELECT 1 FROM cycle_close WHERE pacote_id=?`).get(p.id));
  const meuDia = [];
  if (routine.homolog.length) meuDia.push({
    icone: '🧪', titulo: `Fechar pacote — ${routine.homolog.join(', ')}`,
    desc: 'Só fica no checklist card com teste verde e PR aprovada; o resto perde a tag ou vai pra correção',
    link: '/pacote', cor: '#fbbf24' });
  if (routine.prod.length) meuDia.push({
    icone: '🚀', titulo: `Publicar produção — ${routine.prod.join(', ')}`,
    desc: 'Só sobe o que tem "de acordo com o pacote de DD/MM" registrado',
    link: '/deploy', cor: '#34d399' });
  if (pedidos.length) meuDia.push({
    icone: '✍️', titulo: `Completar ${pedidos.length} card(s) do pedido`,
    desc: 'Escrever bloco "Para o dev", ordem, peso, revisor, data de homologação e responsável',
    tasks: pedidos, cor: '#38bdf8' });
  if (soltos.length) meuDia.push({
    icone: '🔀', titulo: `Triar ${soltos.length} card(s) solto(s)`,
    desc: 'Chegaram fora da reunião — reescrever pro dev quando o Igor encaixar no pacote',
    tasks: soltos, cor: '#f97316' });
  if (emRevisao.length) meuDia.push({
    icone: '👀', titulo: `Conferir ${emRevisao.length} entrega(s) em revisão`,
    desc: 'Conferir se a entrega condiz com o pedido e se o revisor aprovou a PR — aí move pra homologação',
    tasks: emRevisao, cor: '#a78bfa', acao: 'homologação' });
  if (correcoes.length) meuDia.push({
    icone: '🔧', titulo: `Acompanhar ${correcoes.length} correção(ões)`,
    desc: 'Cards recusados pelo gestor ou com teste que voltou — redistribuir/acompanhar',
    tasks: correcoes, cor: '#f87171' });
  if (suporte.length) meuDia.push({
    icone: '🆘', titulo: `Priorizar ${suporte.length} card(s) de suporte`,
    desc: 'Fila da Ana e do Taiki — bug com passo a passo vira card',
    tasks: suporte, cor: '#eab308' });
  if (higiene.length) meuDia.push({
    icone: '🧹', titulo: `${higiene.length} card(s) em andamento sem peso ou revisor`,
    desc: 'Peso na tag/[título] e "Revisor:" na primeira linha da descrição',
    tasks: higiene, cor: '#64748b' });
  if (pacotesExecutados.length) meuDia.push({
    icone: '🧾', titulo: `${pacotesExecutados.length} fechamento(s) de ciclo pendente(s)`,
    desc: 'Bloco execução/efeito no card do pacote — o Igor lê',
    tasks: pacotesExecutados, link: '/pacote', cor: '#94a3b8' });

  const alertas = [];
  const hotfix = tasks.filter(t => jstr(t.tags).some(x => x.name === 'hotfix'));
  const atrasados = tasks.filter(t => isOverdue(t, Date.now()) && t.due_date < Date.now());
  if (hotfix.length) alertas.push({ cor: '#ef4444', titulo: `${hotfix.length} hotfix ativo`, desc: 'Órgão parado — mesma hora', tasks: hotfix });
  if (atrasados.length) alertas.push({ cor: '#eab308', titulo: `${atrasados.length} card(s) além da data de homologação`, desc: 'Vencimento passou e não foram executados — entrar na cobrança', tasks: atrasados.slice(0, 10) });

  // próxima homologação de cada contrato e cards marcados no-pacote
  const pacotes = [];
  for (const [key, c] of Object.entries(C.CONTRACTS)) {
    const cards = (byContract[key] || []).filter(t => jstr(t.tags).some(x => C.isPacoteTag(x.name)));
    const pacote = (byContract[key] || []).filter(t => t.is_pacote)
      .sort((a, b) => (a.due_date || 9e18) - (b.due_date || 9e18))
      .find(t => !t.due_date || t.due_date >= todayEnd - 3 * 864e5);
    pacotes.push({ key, ...c, cards, pacote });
  }

  res.render('dashboard', { page:'dashboard', title:'Dashboard', today, dow, routine, byContract, C, alertas, pacotes, meuDia, snapshotDates: snapshot.snapshotDates() });
});

// ---------- fila ----------
app.get('/fila', (req, res) => {
  const tasks = openTasks().map(decorate).filter(t => !t.is_pacote);
  const byContract = {};
  for (const key of Object.keys(C.CONTRACTS)) byContract[key] = [];
  byContract['outros'] = [];
  for (const t of tasks) (byContract[t.contract] || byContract['outros']).push(t);
  const data = {};
  for (const [k, list] of Object.entries(byContract)) {
    if (!list.length && !C.CONTRACTS[k]) continue;
    data[k] = byStatus(list);
  }
  res.render('fila', { page:'fila', title:'Fila', data, C });
});

// ---------- pacote ----------
function pacoteInfo(contractKey) {
  const tasks = openTasks().map(decorate).filter(t => t.contract === contractKey);
  const pacotes = tasks.filter(t => t.is_pacote).sort((a, b) => (a.due_date || 9e18) - (b.due_date || 9e18));
  const todayEnd = endOfDayMs(todayStr());
  const pacote = pacotes.find(p => !p.due_date || p.due_date >= todayEnd - 3 * 864e5) || pacotes[pacotes.length - 1] || null;
  const cards = tasks.filter(t => !t.is_pacote && jstr(t.tags).some(x => C.isPacoteTag(x.name)));
  return { pacote, cards };
}

function readiness(t) {
  const checks = [
    { ok: !!t.peso, label: 'peso no título' },
    { ok: !!t.revisor, label: 'revisor na descrição' },
    { ok: t.assigneeList.length > 0, label: 'responsável' },
    { ok: ['revisão', 'homologação'].includes(t.status), label: 'em revisão ou homologação' },
    { ok: hasDevBlock(t), label: 'bloco "Para o dev"' },
  ];
  return { checks, pronto: checks.every(c => c.ok) };
}

app.get('/pacote', (req, res) => {
  const out = [];
  for (const [key, c] of Object.entries(C.CONTRACTS)) {
    const { pacote, cards } = pacoteInfo(key);
    const detalhes = cards.map(t => ({ ...t, ...readiness(t) }));
    const fechamento = pacote ? (() => {
      const row = db.prepare(`SELECT data, updated_at FROM cycle_close WHERE pacote_id=?`).get(pacote.id);
      return row ? JSON.parse(row.data) : null;
    })() : null;
    out.push({ key, ...c, pacote, cards: detalhes, fechamento, soma_pontos: detalhes.reduce((s, t) => s + (t.peso || 0), 0) });
  }
  res.render('pacote', { page:'pacote', title:'Pacotes', pacotes: out, C });
});

app.post('/pacote/fechamento', (req, res) => {
  const { pacote_id } = req.body;
  const data = { ...req.body };
  delete data.pacote_id;
  db.prepare(`INSERT INTO cycle_close (pacote_id, data, updated_at) VALUES (?,?,?)
    ON CONFLICT(pacote_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`)
    .run(pacote_id, JSON.stringify(data), new Date().toISOString());
  res.redirect('/pacote#p' + pacote_id);
});

// ---------- time ----------
app.get('/time', (req, res) => {
  const today = todayStr();
  // semana atual: segunda a domingo
  const base = new Date(today + 'T12:00:00');
  const dow = base.getDay();
  const monday = new Date(base); monday.setDate(base.getDate() - ((dow + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const w0 = new Date(monday.toISOString().slice(0, 10) + 'T00:00:00').getTime();
  const w1 = endOfDayMs(sunday.toISOString().slice(0, 10));

  const tasks = openTasks().map(decorate).filter(t => !t.is_pacote);
  const pessoas = {};
  function bucket(nome) {
    return pessoas[nome] = pessoas[nome] || { nome, cfg: C.TEAM[nome] || null, semana: [], semData: [], todas: [] };
  }
  for (const t of tasks) {
    for (const a of t.assigneeList) {
      const b = bucket(a);
      b.todas.push(t);
      if (t.due_date && t.due_date >= w0 && t.due_date <= w1) b.semana.push(t);
      else if (!t.due_date) b.semData.push(t);
    }
  }
  const rows = Object.values(pessoas).map(p => {
    const pontos = p.semana.reduce((s, t) => s + (t.peso || 0), 0);
    const maxPeso = p.semana.reduce((m, t) => Math.max(m, t.peso || 0), 0);
    const peso5 = p.semana.filter(t => t.peso === 5).length;
    const semPeso = p.semana.filter(t => !t.peso).length;
    const viol = [];
    if (p.cfg) {
      if (p.cfg.cards != null && p.semana.length > p.cfg.cards) viol.push(`${p.semana.length} cards > teto ${p.cfg.cards}`);
      if (p.cfg.pontos != null && pontos > p.cfg.pontos) viol.push(`${pontos} pontos > teto ${p.cfg.pontos}`);
      if (p.cfg.maxPeso != null && maxPeso > p.cfg.maxPeso) viol.push(`peso ${maxPeso} > máx ${p.cfg.maxPeso}`);
      if (p.cfg.papel === 'aprendiz' && maxPeso > 2) viol.push('aprendiz não recebe peso 3 ou 5');
      if (peso5 > 1) viol.push(`${peso5} cards peso 5 (máx 1)`);
    }
    return { ...p, pontos, maxPeso, peso5, semPeso, viol };
  }).sort((a, b) => (a.cfg ? a.cfg.papel : 'z').localeCompare(b.cfg ? b.cfg.papel : 'z') || a.nome.localeCompare(b.nome));
  res.render('time', { page:'time', title:'Time', rows, semanaIni: fmtDate(w0), semanaFim: fmtDate(w1) });
});

// ---------- cobrança ----------
app.get('/cobranca', (req, res) => {
  const date = req.query.date || todayStr();
  const tasks = snapshot.getSnapshot(date).map(decorate);
  const notes = snapshot.getNotes(date);
  const groups = {};
  for (const t of tasks) {
    for (const a of (t.assigneeList.length ? t.assigneeList : ['(sem responsável)'])) {
      (groups[a] = groups[a] || []).push(t);
    }
  }
  const pessoas = Object.keys(groups).sort().map(nome => ({
    nome,
    tasks: groups[nome].sort((a, b) => (a.due_date || 0) - (b.due_date || 0)),
    discord: discord.linked(nome),
    msgs: discord.messages(nome).slice(0, 10),
  }));
  res.render('cobranca', { page:'cobranca', title:'Cobrança',
    date, pessoas, notes, today: todayStr(),
    dates: snapshot.snapshotDates().map(s => s.snapshot_date),
    orphans: snapshot.orphanNotes(date),
    isToday: date === todayStr(),
  });
});

app.post('/cobranca/note', (req, res) => {
  const { date, task_id, note } = req.body;
  if (date && task_id) snapshot.saveNote(date, task_id, note || '');
  res.redirect(`/cobranca?date=${encodeURIComponent(date)}`);
});

app.post('/cobranca/snapshot', async (req, res) => {
  try { const r = snapshot.collect(req.body.date || todayStr()); res.json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/discord/link', (req, res) => {
  const { person, discord_id } = req.body;
  if (person && discord_id) discord.setLink(person, discord_id.trim());
  res.redirect(req.get('referer') || '/cobranca');
});

app.post('/discord/send', async (req, res) => {
  const { person, date } = req.body;
  const link = discord.linked(person);
  if (!link) return res.status(400).json({ error: 'sem Discord vinculado' });
  const tasks = snapshot.getSnapshot(date || todayStr())
    .map(decorate)
    .filter(t => t.assigneeList.includes(person));
  if (!tasks.length) return res.status(400).json({ error: 'sem tasks nesse dia' });
  const lines = tasks.map(t => {
    const venc = t.dueFmt;
    const st = t.due_date && t.due_date < Date.now() ? '⚠️ vencida' : 'vence';
    return `- [${t.clean_title || t.name}](${t.url}) — ${st} ${venc} · ${t.status} (${t.contractLabel})`;
  });
  const msg = `Oi! Passando pra alinhar as tasks do dia ${fmtDate(new Date(date || todayStr() + 'T12:00:00').getTime())} que estão com você:\n\n${lines.join('\n')}\n\nConsegue me dar um retorno do andamento? 🙏`;
  try { await discord.sendDM(link.discord_id, msg, person); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- deploy ----------
app.get('/deploy', async (req, res) => {
  const today = todayStr();
  const dow = weekdayOf(today);
  const routine = C.weekdayRoutine(dow);
  const tasks = openTasks().map(decorate);
  const janelas = [];
  for (const key of Object.keys(C.CONTRACTS)) {
    const c = C.CONTRACTS[key];
    const { pacote, cards } = pacoteInfo(key);
    if (c.homolog === dow) janelas.push({ tipo: 'homologação', ...c, pacote, cards, contrato: key });
    if (c.prod === dow) janelas.push({ tipo: 'produção', ...c, pacote, cards, contrato: key });
  }
  res.render('deploy', { page:'deploy', title:'Janelas', today, dow, routine, janelas, tasks, C });
});

app.post('/deploy/move', async (req, res) => {
  const { task_id, status } = req.body;
  try {
    await require('./clickup').setStatus(task_id, status);
    // reflete local sem esperar o poller
    db.prepare(`UPDATE tasks SET status=?, synced_at=? WHERE id=?`).run(status.toLowerCase(), new Date().toISOString(), task_id);
    db.prepare(`INSERT INTO status_events (task_id, from_status, to_status, at) VALUES (?,?,?,?)`)
      .run(task_id, req.body.from_status || null, status.toLowerCase(), new Date().toISOString());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- produtividade ----------
app.get('/produtividade', (req, res) => {
  const tasks = db.prepare(`SELECT * FROM tasks ORDER BY due_date`).all().map(decorate);
  const ev = db.prepare(`SELECT * FROM status_events ORDER BY at`).all();
  const byTask = {};
  for (const e of ev) (byTask[e.task_id] = byTask[e.task_id] || []).push(e);

  const rows = [];
  for (const t of tasks) {
    const events = byTask[t.id] || [];
    const rev = events.find(e => e.to_status === 'revisão');
    const exec = events.find(e => e.to_status === 'executado');
    const afazer = events.find(e => e.to_status === 'a fazer');
    const deltaDias = rev && t.due_date
      ? Math.round((new Date(rev.at).getTime() - t.due_date) / 864e5) : null;
    for (const a of t.assigneeList) {
      rows.push({
        task: t, assignee: a,
        a_fazer: afazer ? afazer.at : null,
        revisao: rev ? rev.at : null,
        executado: exec ? exec.at : null,
        deltaDias,
      });
    }
  }

  const perPerson = {};
  for (const r of rows) {
    const p = perPerson[r.assignee] = perPerson[r.assignee] || { nome: r.assignee, total: 0, medidos: 0, noPrazo: 0, atrasoSum: 0, porPeso: {} };
    p.total++;
    if (r.deltaDias !== null) {
      p.medidos++;
      if (r.deltaDias <= 0) p.noPrazo++;
      p.atrasoSum += r.deltaDias;
      const pk = r.task.peso != null ? `peso ${r.task.peso}` : 'sem peso';
      const pp = p.porPeso[pk] = p.porPeso[pk] || { n: 0, noPrazo: 0 };
      pp.n++; if (r.deltaDias <= 0) pp.noPrazo++;
    }
  }
  const firstEvent = ev.length ? ev[0].at : null;
  res.render('produtividade', { page:'produtividade', title:'Produtividade',
    rows: rows.filter(r => r.task.status !== 'executado' || r.executado),
    perPerson: Object.values(perPerson).sort((a, b) => b.medidos - a.medidos),
    firstEvent,
  });
});

// ---------- ações ----------
app.post('/sync', async (req, res) => {
  sync();
  res.json({ ok: true, msg: 'sync disparado' });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- boot ----------
app.listen(PORT, () => {
  console.log(`Servidor em http://localhost:${PORT}`);
  discord.start();
  cron.schedule(POLL, sync, { timezone: TZ });
  cron.schedule(CRON_SNAPSHOT, async () => {
    await sync();
    snapshot.collect();
    console.log('[cron] snapshot diário coletado');
  }, { timezone: TZ });
  console.log(`[cron] poll "${POLL}" · snapshot diário "${CRON_SNAPSHOT}" (${TZ})`);
  sync(); // sync inicial no boot
});
