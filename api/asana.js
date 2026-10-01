// Lyric Flow → Asana mirror (Vercel serverless function)
// Deploys automatically from /api/asana.js in the repo. Holds the Asana token
// server-side; only accepts requests from users signed into Flow (Supabase JWT).
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   ASANA_PAT             Asana Personal Access Token (Asana → My settings → Apps → Developer apps)
//   ASANA_WORKSPACE_GID   optional — if your token can see several workspaces, pin one
//   SUPABASE_URL          same value as CONFIG.SUPABASE_URL in index.html
//   SUPABASE_ANON_KEY     same value as CONFIG.SUPABASE_ANON_KEY in index.html

const ASANA = "https://app.asana.com/api/1.0";
const PROJECT_NAME = "Lyric Flow";
const TIMELINES = [
  ["today", "Today"], ["week", "This week"], ["nextweek", "Next week"], ["month", "This month"],
  ["nextmonth", "Next month"], ["quarter", "This quarter"], ["nextquarter", "Next quarter"], ["vault", "Vault"],
];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { ASANA_PAT, ASANA_WORKSPACE_GID, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!ASANA_PAT) return res.status(500).json({ error: "ASANA_PAT is not set in Vercel environment variables" });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(500).json({ error: "SUPABASE_URL / SUPABASE_ANON_KEY not set" });

  // --- 1. caller must be a signed-in Flow user ---
  const auth = req.headers.authorization || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "Sign in to Flow first" });
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } });
  if (!who.ok) return res.status(401).json({ error: "Session expired — sign in again" });

  const body = typeof req.body === "string" ? safeJSON(req.body) : (req.body || {});
  const asana = makeClient(ASANA_PAT);

  try {
    switch (body.op) {
      case "setup":   return res.status(200).json(await setup(asana, ASANA_WORKSPACE_GID));
      case "upsert":  return res.status(200).json(await upsert(asana, body));
      case "delete":  return res.status(200).json(await remove(asana, body));
      case "status":  return res.status(200).json(await status(asana, body));
      default:        return res.status(400).json({ error: `Unknown op: ${body.op}` });
    }
  } catch (e) {
    return res.status(502).json({ error: e.message || String(e) });
  }
};

function safeJSON(s){ try { return JSON.parse(s); } catch { return {}; } }

function makeClient(pat){
  const call = async (method, path, data) => {
    const r = await fetch(ASANA + path, {
      method,
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", Accept: "application/json" },
      body: data === undefined ? undefined : JSON.stringify({ data }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.errors && j.errors[0] && j.errors[0].message) || `Asana ${r.status}`;
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return j.data;
  };
  return {
    get: (p) => call("GET", p),
    post: (p, d) => call("POST", p, d),
    put: (p, d) => call("PUT", p, d),
    del: (p) => call("DELETE", p),
    async all(path){ // paginate GET
      let out = [], next = path + (path.includes("?") ? "&" : "?") + "limit=100";
      while (next) {
        const r = await fetch(ASANA + next, { headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" } });
        const j = await r.json();
        if (!r.ok) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || `Asana ${r.status}`);
        out = out.concat(j.data || []);
        next = j.next_page && j.next_page.uri ? j.next_page.uri.replace(ASANA, "") : null;
      }
      return out;
    },
  };
}

// --- 2. one-time scaffolding: project + custom fields (idempotent) ---
async function setup(asana, pinnedWs){
  let ws = pinnedWs;
  if (!ws) {
    const wss = await asana.get("/workspaces");
    if (!wss.length) throw new Error("This token sees no Asana workspaces");
    ws = wss[0].gid;
  }
  // project
  const projects = await asana.all(`/workspaces/${ws}/projects?opt_fields=name,archived`);
  let project = projects.find(p => p.name === PROJECT_NAME && !p.archived);
  if (!project) project = await asana.post("/projects", { name: PROJECT_NAME, workspace: ws, notes: "Mirrored automatically from Lyric Flow. Edit in Flow; this copy updates on every save." });

  // custom fields (Premium+). If unavailable, fall back to encoding in task notes.
  const config = { workspace: ws, project: project.gid, projectUrl: `https://app.asana.com/0/${project.gid}/list`, fields: null };
  try {
    const existing = await asana.all(`/workspaces/${ws}/custom_fields?opt_fields=name,resource_subtype,enum_options.name,enum_options.gid`);
    const byName = n => existing.find(f => f.name === n);

    let timeline = byName("Flow Timeline");
    if (!timeline) timeline = await asana.post("/custom_fields", { workspace: ws, name: "Flow Timeline", resource_subtype: "enum", enum_options: TIMELINES.map(([, label]) => ({ name: label })) });
    let group = byName("Flow Group");
    if (!group) group = await asana.post("/custom_fields", { workspace: ws, name: "Flow Group", resource_subtype: "enum", enum_options: [{ name: "Deals" }, { name: "Operations & Firm Build" }] });
    let owner = byName("Flow Owner");
    if (!owner) owner = await asana.post("/custom_fields", { workspace: ws, name: "Flow Owner", resource_subtype: "text" });

    for (const f of [timeline, group, owner]) {
      try { await asana.post(`/projects/${project.gid}/addCustomFieldSetting`, { custom_field: f.gid, is_important: true }); }
      catch (e) { if (!/already/i.test(e.message)) throw e; }
    }
    // refresh enum option gids
    const full = await asana.get(`/custom_fields/${timeline.gid}?opt_fields=enum_options.name,enum_options.gid`);
    const gfull = await asana.get(`/custom_fields/${group.gid}?opt_fields=enum_options.name,enum_options.gid`);
    config.fields = {
      timeline: { gid: timeline.gid, options: Object.fromEntries(TIMELINES.map(([key, label]) => [key, (full.enum_options.find(o => o.name === label) || {}).gid])) },
      group:    { gid: group.gid, options: Object.fromEntries((gfull.enum_options || []).map(o => [o.name, o.gid])) },
      owner:    { gid: owner.gid },
    };
  } catch (e) {
    if (e.status === 402 || e.status === 403 || /premium|not allowed|permission/i.test(e.message)) {
      config.fields = null; config.fieldsNote = "Custom fields unavailable on this Asana plan — timeline and group are written into task descriptions instead.";
    } else throw e;
  }
  return { ok: true, config };
}

// --- 3. mirror one Flow project (parent task + subtasks) ---
function timelineLabel(key){ const t = TIMELINES.find(([k]) => k === key); return t ? t[1] : key; }
function describe(task, extra){
  const lines = [];
  if (task.note) lines.push(task.note);
  if (extra) lines.push(extra);
  lines.push("", "— Mirrored from Lyric Flow. Edit there; this copy updates on every save.");
  return lines.join("\n");
}
async function ensureGroupOption(asana, config, groupName){
  if (!config.fields) return null;
  const opts = config.fields.group.options;
  if (opts[groupName]) return opts[groupName];
  const created = await asana.post(`/custom_fields/${config.fields.group.gid}/enum_options`, { name: groupName });
  opts[groupName] = created.gid;
  return created.gid;
}
function fieldsFor(config, horizon, groupGid, ownerName){
  if (!config.fields) return undefined;
  const cf = {};
  if (config.fields.timeline && config.fields.timeline.options[horizon]) cf[config.fields.timeline.gid] = config.fields.timeline.options[horizon];
  if (groupGid) cf[config.fields.group.gid] = groupGid;
  if (config.fields.owner) cf[config.fields.owner.gid] = ownerName || "Unassigned";
  return cf;
}
async function upsert(asana, { task: m, emails = {}, config, map = {} }){
  if (!config || !config.project) throw new Error("Asana isn't set up yet — open Account → Set up Asana");
  const out = { map: {}, deleted: [] };
  const groupGid = await ensureGroupOption(asana, config, m.group || "Deals");
  const assigneeFor = name => (name && emails[name]) ? emails[name] : null;
  const fallbackNote = config.fields ? "" : `Timeline: ${timelineLabel(m.horizon)} · Group: ${m.group || ""} · Lead: ${m.lead || "Unassigned"}`;

  // parent
  const parentData = {
    name: m.name,
    notes: describe(m, fallbackNote),
    due_on: m.dueDate || null,
    assignee: assigneeFor(m.lead),
    completed: false,
    custom_fields: fieldsFor(config, m.horizon, groupGid, m.lead),
  };
  let parent = map[m.gid];
  if (parent && parent.gid) {
    try { await asana.put(`/tasks/${parent.gid}`, parentData); }
    catch (e) { if (e.status === 404) parent = null; else throw e; }
  }
  if (!parent || !parent.gid) {
    const created = await asana.post("/tasks", { ...parentData, projects: [config.project] });
    parent = { gid: created.gid, children: [] };
  }
  parent.children = parent.children || [];

  // subtasks
  const seen = [];
  for (const s of (m.subtasks || [])) {
    seen.push(s.gid);
    const log = Array.isArray(s.log) ? s.log : [];
    const subFallback = config.fields ? "" : `Timeline: ${timelineLabel(s.horizon)} · Owner: ${s.assignee || "Unassigned"}`;
    const data = {
      name: s.name,
      notes: describe({ note: `Project: ${m.name}` }, subFallback),
      due_on: s.dueDate || null,
      assignee: assigneeFor(s.assignee),
      completed: !!s.done,
      custom_fields: fieldsFor(config, s.horizon, groupGid, s.assignee),
    };
    let entry = map[s.gid];
    if (entry && entry.gid) {
      try { await asana.put(`/tasks/${entry.gid}`, data); }
      catch (e) { if (e.status === 404) entry = null; else throw e; }
    }
    if (!entry || !entry.gid) {
      const created = await asana.post("/tasks", { ...data, parent: parent.gid });
      try { await asana.post(`/tasks/${created.gid}/addProject`, { project: config.project }); } catch (_) {}
      entry = { gid: created.gid, logN: 0 };
    }
    // next steps → comments (only new ones)
    const already = entry.logN || 0;
    for (const e of log.slice(already)) {
      const when = e.t ? new Date(e.t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      await asana.post(`/tasks/${entry.gid}/stories`, { text: `Next step${e.by ? ` (${e.by}` : ""}${e.by && when ? `, ${when})` : e.by ? ")" : ""}: ${e.text}` });
    }
    entry.logN = log.length;
    out.map[s.gid] = entry;
  }
  // subtasks removed in Flow → delete in Asana
  for (const childGid of parent.children) {
    if (!seen.includes(childGid) && map[childGid] && map[childGid].gid) {
      try { await asana.del(`/tasks/${map[childGid].gid}`); } catch (_) {}
      out.deleted.push(childGid);
    }
  }
  parent.children = seen;
  out.map[m.gid] = parent;
  return out;
}

async function remove(asana, { gid, map = {} }){
  const entry = map[gid];
  if (entry && entry.gid) { try { await asana.del(`/tasks/${entry.gid}`); } catch (_) {} }
  const deleted = [gid].concat((entry && entry.children) || []);
  return { ok: true, deleted };
}

async function status(asana, { config }){
  if (!config || !config.project) return { connected: false };
  try {
    const p = await asana.get(`/projects/${config.project}?opt_fields=name,permalink_url`);
    return { connected: true, project: p.name, url: p.permalink_url };
  } catch (e) { return { connected: false, error: e.message }; }
}
