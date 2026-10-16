const TOKEN = process.env.CLICKUP_API_TOKEN;
const BASE = 'https://api.clickup.com/api/v2';

if (!TOKEN) console.warn('[clickup] CLICKUP_API_TOKEN não configurado');

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp ${res.status} ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function getList(listId) {
  return api(`/list/${listId}`);
}

// tasks abertas + fechadas atualizadas recentemente
async function getTasks(listId, { includeClosed = false, dateUpdatedGt = null, subtasks = true } = {}) {
  const tasks = [];
  let page = 0;
  for (;;) {
    const qs = new URLSearchParams({ page: String(page), subtasks: String(subtasks) });
    if (includeClosed) qs.set('include_closed', 'true');
    if (dateUpdatedGt) qs.set('date_updated_gt', String(dateUpdatedGt));
    const data = await api(`/list/${listId}/task?${qs}`);
    const batch = data.tasks || [];
    tasks.push(...batch);
    if (batch.length < 100 || data.last_page) break;
    page++;
    if (page > 40) break;
  }
  return tasks;
}

async function setStatus(taskId, status) {
  return api(`/task/${taskId}`, { method: 'PUT', body: JSON.stringify({ status }) });
}

module.exports = { api, getList, getTasks, setStatus };
