require('dotenv').config();
const { db, upsertTask } = require('./db');
const clickup = require('./clickup');
const { contractOf, contractOfTags, parseTitle, pesoDe, parseRevisor, isPacote } = require('./config');

const LIST_IDS = (process.env.CLICKUP_LIST_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

// cache de metadados da lista (nome, space) por list_id
const listMetaCache = {};
async function listMeta(listId) {
  if (!listMetaCache[listId]) {
    try {
      const l = await clickup.getList(listId);
      listMetaCache[listId] = { name: l.name, space: (l.space && l.space.name) || '' };
    } catch { listMetaCache[listId] = { name: listId, space: '' }; }
  }
  return listMetaCache[listId];
}

function normalize(t, meta) {
  const { ordem, peso: titlePeso, clean } = parseTitle(t.name);
  const tagObjs = (t.tags || []).map(tag => ({ name: tag.name, fg: tag.tag_fg, bg: tag.tag_bg }));
  const peso = pesoDe(tagObjs, titlePeso);
  const contract = contractOfTags(tagObjs) || contractOf(meta.space);
  return {
    id: t.id,
    list_id: t.list && t.list.id,
    contract,
    list_name: meta.name,
    name: t.name,
    ordem, peso, clean_title: clean,
    status: (t.status && t.status.status || '').toLowerCase(),
    is_pacote: isPacote(t.name) ? 1 : 0,
    is_subtask: t.parent ? 1 : 0,
    parent: t.parent || null,
    assignees: JSON.stringify((t.assignees || []).map(a => a.username)),
    tags: JSON.stringify(tagObjs),
    due_date: t.due_date ? +t.due_date : null,
    url: t.url,
    revisor: parseRevisor(t.description),
    description_excerpt: (t.description || '').slice(0, 3000),
    priority: t.priority ? (t.priority.priority || t.priority) : null,
    start_date: t.start_date ? +t.start_date : null,
    date_updated: t.date_updated ? +t.date_updated : null,
    synced_at: new Date().toISOString(),
  };
}

let running = false;
async function sync() {
  if (running) { console.log('[sync] já em execução, pulando'); return; }
  running = true;
  const t0 = Date.now();
  let total = 0;
  try {
    const recentMs = Date.now() - 3 * 24 * 60 * 60 * 1000; // fechadas atualizadas nos últimos 3 dias
    for (const listId of LIST_IDS) {
      const meta = await listMeta(listId);
      const open = await clickup.getTasks(listId, { subtasks: true });
      const recent = await clickup.getTasks(listId, { includeClosed: true, dateUpdatedGt: recentMs, subtasks: true });
      const seen = new Map();
      for (const t of [...open, ...recent]) seen.set(t.id, t);
      for (const t of seen.values()) upsertTask(normalize(t, meta));
      total += seen.size;
      console.log(`[sync] ${meta.space} › ${meta.name}: ${seen.size} tasks`);
    }
    console.log(`[sync] concluído: ${total} tasks em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error('[sync] erro:', e.message);
  } finally { running = false; }
}

if (require.main === module) {
  sync().then(() => process.exit(0));
}

module.exports = { sync };
