const { db } = require('./db');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
let client = null;
let ready = false;

async function start() {
  if (!TOKEN) { console.log('[discord] DISCORD_BOT_TOKEN não configurado — DM desativado'); return; }
  const { Client, GatewayIntentBits, Partials } = require('discord.js');
  client = new Client({
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  client.on('ready', () => { ready = true; console.log(`[discord] conectado como ${client.user.tag}`); });
  client.on('messageCreate', msg => {
    if (msg.author.bot || msg.guild) return; // só DM
    const row = db.prepare(`SELECT person_name FROM discord_users WHERE discord_id=?`).get(msg.author.id);
    db.prepare(`INSERT INTO discord_messages (person_name, discord_id, direction, content, sent_at) VALUES (?,?,?,?,?)`)
      .run(row ? row.person_name : null, msg.author.id, 'in', msg.content || '(sem texto)', new Date().toISOString());
  });
  try { await client.login(TOKEN); } catch (e) { console.error('[discord] login falhou:', e.message); }
}

async function sendDM(discordId, content, personName) {
  if (!client || !ready) throw new Error('bot Discord não conectado');
  const user = await client.users.fetch(discordId);
  const dm = await user.createDM();
  const chunks = content.match(/[\s\S]{1,1900}/g) || [];
  for (const c of chunks) await dm.send(c);
  db.prepare(`INSERT INTO discord_messages (person_name, discord_id, direction, content, sent_at) VALUES (?,?,?,?,?)`)
    .run(personName, discordId, 'out', content, new Date().toISOString());
}

function linked(personName) {
  return db.prepare(`SELECT * FROM discord_users WHERE person_name=?`).get(personName);
}
function setLink(personName, discordId) {
  db.prepare(`INSERT INTO discord_users (person_name, discord_id) VALUES (?,?)
    ON CONFLICT(person_name) DO UPDATE SET discord_id=excluded.discord_id`).run(personName, discordId);
}
function messages(personName) {
  return db.prepare(`SELECT * FROM discord_messages WHERE person_name=? ORDER BY sent_at DESC LIMIT 100`).all(personName);
}

module.exports = { start, sendDM, linked, setLink, messages };
