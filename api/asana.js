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

// Supabase project (public values; pinned here so only ASANA_PAT must be configured in Vercel).
// Environment variables override these if present, under any of the common names.
const E = process.env;
const SUPABASE_URL = E.SUPABASE_URL || E.NEXT_PUBLIC_SUPABASE_URL || E.VITE_SUPABASE_URL || "https://sxixenqcjueyfmwwtypr.supabase.co";
const SUPABASE_ANON_KEY = E.SUPABASE_ANON_KEY || E.NEXT_PUBLIC_SUPABASE_ANON_KEY || E.SUPABASE_PUBLISHABLE_KEY || E.VITE_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4aXhlbnFjanVleWZtd3d0eXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjY0ODEsImV4cCI6MjEwNTgwMjQ4MX0.uyf5qSNuAYbwm910Y6ozCJxYL99y2ssYhpa3X11wnoc";

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const { ASANA_PAT, ASANA_WORKSPACE_GID } = E;

  // GET = diagnostics (safe: reports presence only, never values)
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      function: "lyric-flow-asana-mirror",
      env: { ASANA_PAT: !!ASANA_PAT, ASANA_WORKSPACE_GID: !!ASANA_WORKSPACE_GID,
             SUPABASE_URL: !!(E.SUPABASE_URL || E.NEXT_PUBLIC_SUPABASE_URL), SUPABASE_ANON_KEY: !!(E.SUPABASE_ANON_KEY || E.NEXT_PUBLIC_SUPABASE_ANON_KEY) },
      supabaseProject: SUPABASE_URL.replace("https://", "").split(".")[0],
      note: "POST with a Flow login to use the mirror.",
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!ASANA_PAT) return res.status(500).json({ error: "ASANA_PAT is not set in Vercel environment variables (Settings → Environment Variables, then Redeploy)" });

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
      case "deals":   return res.status(200).json(await deals(asana, body));
      case "updateDeal": return res.status(200).json(await updateDeal(asana, body));
      case "cleanupPreview": return res.status(200).json(await cleanupPreview(asana, body));
      case "createDeal": return res.status(200).json(await createDeal(asana, body));
      case "cleanupDelete": return res.status(200).json(await cleanupDelete(asana, body));
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
  if (!project) project = await asana.post("/projects", { name: PROJECT_NAME, workspace: ws, notes: "Actions mirrored automatically from Lyric Flow. Edit in Flow; this copy updates on every save." });


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
const sectionCache = new Map();
async function placeInSection(asana, projectGid, taskGid, label){
  if (!label || !projectGid) return;
  try {
    let secs = sectionCache.get(projectGid);
    if (!secs) { secs = await asana.all(`/projects/${projectGid}/sections?opt_fields=name`); sectionCache.set(projectGid, secs); }
    const sec = secs.find(x => (x.name || "").trim().toLowerCase() === label.trim().toLowerCase());
    if (sec) await asana.post(`/sections/${sec.gid}/addTask`, { task: taskGid });
  } catch (_) {}
}
async function upsert(asana, { task: m, emails = {}, config, map = {} }){
  if (!config || !config.project) throw new Error("Asana isn't set up yet — open Account → Set up Asana");
  const out = { map: {}, deleted: [] };
  const groupGid = await ensureGroupOption(asana, config, m.group || "Deals");
  const assigneeFor = name => (name && emails[name]) ? emails[name] : null;
  const fallbackNote = config.fields ? "" : `Timeline: ${timelineLabel(m.horizon)} · Group: ${m.group || ""} · Lead: ${m.lead || "Unassigned"}`;

  const external = m.source === "asana" && !!m.asanaGid;   // deal card lives on ACTIVE DEALS
  let parent = map[m.gid];
  if (external) {
    parent = Object.assign({ children: [] }, parent || {}, { gid: m.asanaGid, external: true });
    // Deal cards live on ACTIVE DEALS only. If an earlier version homed this card into Lyric Flow, undo that.
    if (parent.homed) { try { await asana.post(`/tasks/${m.asanaGid}/removeProject`, { project: config.project }); } catch (_) {} delete parent.homed; }
  } else {
    const parentData = {
      name: m.name,
      notes: describe(m, fallbackNote),
      due_on: m.dueDate || null,
      assignee: assigneeFor(m.lead),
      completed: false,
      custom_fields: fieldsFor(config, m.horizon, groupGid, m.lead),
    };
    // Workstream parents are not rows on the Lyric Flow board: they live outside any project and
    // are reached from each action's "‹ Workstream" breadcrumb. (Custom fields need a project, so none are set here.)
    const { custom_fields, ...parentCore } = parentData;
    if (parent && parent.gid) {
      try {
        await asana.put(`/tasks/${parent.gid}`, parentCore);
        if (!parent.offBoard) { try { await asana.post(`/tasks/${parent.gid}/removeProject`, { project: config.project }); } catch (_) {} parent.offBoard = true; }
      }
      catch (e) { if (e.status === 404) parent = null; else throw e; }
    }
    if (!parent || !parent.gid) {
      const created = await asana.post("/tasks", { ...parentCore, workspace: config.workspace });
      parent = { gid: created.gid, children: [], offBoard: true };
    }
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
      notes: describe({ note: external ? `Deal: ${m.name}${m.permalink ? "\n" + m.permalink : ""}` : `Project: ${m.name}` }, subFallback),
      due_on: s.dueDate || null,
      assignee: assigneeFor(s.assignee),
      completed: !!s.done,
      custom_fields: fieldsFor(config, s.horizon, groupGid, s.assignee),
    };
    let entry = map[s.gid];
    if (entry && entry.gid) {
      try {
        await asana.put(`/tasks/${entry.gid}`, data);
        if (!entry.parented) { try { await asana.post(`/tasks/${entry.gid}/setParent`, { parent: parent.gid }); } catch (_) {} entry.parented = true; }
      }
      catch (e) { if (e.status === 404) entry = null; else throw e; }
    }
    if (!entry || !entry.gid) {
      const created = await asana.post("/tasks", { ...data, parent: parent.gid });
      try { await asana.post(`/tasks/${created.gid}/addProject`, { project: config.project }); } catch (_) {}
      entry = { gid: created.gid, logN: 0 };
    }
    await placeInSection(asana, config.project, entry.gid, timelineLabel(s.horizon));
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
  if (entry && entry.gid && !entry.external) { try { await asana.del(`/tasks/${entry.gid}`); } catch (_) {} }
  else if (entry && entry.external) {
    for (const c of (entry.children || [])) { const ce = map[c]; if (ce && ce.gid) { try { await asana.del(`/tasks/${ce.gid}`); } catch (_) {} } }
  }
  const deleted = [gid].concat((entry && entry.children) || []);
  return { ok: true, deleted };
}

// --- read the ACTIVE DEALS board (read-only mirror into Flow) ---
const DEALS_BOARD = "ACTIVE DEALS";
async function deals(asana, { config }){
  if (!config || !config.workspace) throw new Error("Asana isn't set up yet — run Set up Asana first");
  let dealsProject = config.dealsProject;
  if (!dealsProject) {
    const projects = await asana.all(`/workspaces/${config.workspace}/projects?opt_fields=name,archived`);
    const p = projects.find(x => (x.name || "").trim().toUpperCase() === DEALS_BOARD && !x.archived);
    if (!p) throw new Error(`No project named "${DEALS_BOARD}" found in this Asana workspace`);
    dealsProject = p.gid;
  }
  const fields = "name,assignee.name,assignee.email,due_on,completed,permalink_url,modified_at,memberships.project.gid,memberships.section.name,custom_fields.name,custom_fields.display_value";
  const [tasks, sections] = await Promise.all([
    asana.all(`/projects/${dealsProject}/tasks?opt_fields=${fields}`),
    asana.all(`/projects/${dealsProject}/sections?opt_fields=name`).catch(() => []),
  ]);
  const list = tasks.filter(t => !t.completed && !(t.name || "").endsWith(":")).map(t => {
    const mem = (t.memberships || []).find(m => m.project && m.project.gid === dealsProject);
    return {
      asanaGid: t.gid,
      name: t.name || "",
      assigneeName: (t.assignee && t.assignee.name) || "",
      assigneeEmail: (t.assignee && t.assignee.email) || "",
      dueDate: t.due_on || null,
      permalink: t.permalink_url || "",
      stage: (mem && mem.section && mem.section.name) || "",
      fields: (t.custom_fields || []).filter(f => f.display_value).map(f => ({ name: f.name, value: f.display_value })),
      modified: t.modified_at,
    };
  });
  return { ok: true, dealsProject, deals: list, sections: (sections || []).map(x => x.name).filter(n => n && n !== "Untitled section") };
}

// --- create a new deal card ON the ACTIVE DEALS board (so the board stays the source of truth) ---
async function createDeal(asana, { config, name, stage, leadEmail, dueDate, notes }){
  if (!config || !config.dealsProject) throw new Error("Pull deals once first so Flow knows the ACTIVE DEALS board");
  if (!name || !String(name).trim()) throw new Error("The deal needs a name");
  const data = { name: String(name).trim(), projects: [config.dealsProject] };
  if (leadEmail) data.assignee = leadEmail;
  if (dueDate) data.due_on = dueDate;
  if (notes) data.notes = String(notes);
  const created = await asana.post("/tasks?opt_fields=name,permalink_url", data);
  let placed = null;
  if (stage) {
    const sections = await asana.all(`/projects/${config.dealsProject}/sections?opt_fields=name`);
    const sec = sections.find(x => (x.name || "").trim().toLowerCase() === String(stage).trim().toLowerCase());
    if (sec) { try { await asana.post(`/sections/${sec.gid}/addTask`, { task: created.gid }); placed = sec.name; } catch (_) {} }
  }
  return { ok: true, deal: { gid: created.gid, name: created.name, url: created.permalink_url, stage: placed } };
}

// --- write a deal's core fields back to its ACTIVE DEALS card ---
async function updateDeal(asana, { asanaGid, name, dueDate, leadEmail, clearAssignee }){
  if (!asanaGid) throw new Error("Missing deal id");
  const data = {};
  if (typeof name === "string" && name.trim()) data.name = name.trim();
  if (dueDate !== undefined) data.due_on = dueDate || null;
  if (leadEmail) data.assignee = leadEmail;
  else if (clearAssignee) data.assignee = null;
  const t = await asana.put(`/tasks/${asanaGid}?opt_fields=name,due_on,assignee.name,assignee.email,modified_at`, data);
  return { ok: true, deal: { asanaGid, name: t.name, dueDate: t.due_on || null, assigneeName: (t.assignee && t.assignee.name) || "", assigneeEmail: (t.assignee && t.assignee.email) || "" } };
}

// --- Lyric Flow board hygiene: find/delete Flow-created deal entries (top-level tasks tagged Deals) ---
async function cleanupPreview(asana, { config, dealNames = [], dealCardGids = [] }){
  if (!config || !config.project) throw new Error("Asana isn't set up yet");
  const tasks = await asana.all(`/projects/${config.project}/tasks?opt_fields=name,parent,permalink_url,custom_fields.name,custom_fields.display_value,num_subtasks,memberships.project.gid,notes`);
  const norm = n => String(n || "").toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const names = new Set(dealNames.map(norm).filter(Boolean));
  const cards = new Set(dealCardGids.map(String));
  const onBoard = t => cards.has(String(t.gid)) || (config.dealsProject && (t.memberships || []).some(ms => ms.project && ms.project.gid === config.dealsProject));
  const orphans = tasks.filter(t => {
    if (t.parent) return false;                                     // any subtask (incl. under ACTIVE DEALS cards) is never a duplicate
    if (onBoard(t)) return false;                                   // the real ACTIVE DEALS card, multi-homed here — keep
    return names.has(norm(t.name));                                 // only tasks NAMED like a deal count as duplicate deal entries
  }).map(t => {
    const grp = (t.custom_fields || []).find(f => /^flow group$/i.test(f.name || ""));
    return { gid: t.gid, name: t.name, url: t.permalink_url, subtasks: t.num_subtasks || 0,
             mirrored: /mirrored from lyric flow/i.test(t.notes || ""), group: (grp && grp.display_value) || "" };
  });
  return { ok: true, orphans };
}
async function cleanupDelete(asana, { config, gids = [], reparent = {} }){
  const deleted = [], failed = [], moved = [];
  for (const g of gids.slice(0, 200)) {
    try {
      // safety: never delete a task that lives on ACTIVE DEALS
      if (config && config.dealsProject) {
        const t = await asana.get(`/tasks/${g}?opt_fields=memberships.project.gid`);
        if ((t.memberships || []).some(ms => ms.project && ms.project.gid === config.dealsProject)) { failed.push({ gid: g, error: "is an ACTIVE DEALS card — skipped" }); continue; }
      }
      // move the duplicate's subtasks under the real card first (keeps comments/history)
      const card = reparent[g];
      if (card) {
        const subs = await asana.all(`/tasks/${g}/subtasks?opt_fields=gid`);
        for (const st of subs) {
          try { await asana.put(`/tasks/${st.gid}`, { parent: card }); try { await asana.post(`/tasks/${st.gid}/addProject`, { project: config.project }); } catch (_) {} moved.push(st.gid); } catch (_) {}
        }
      }
      await asana.del(`/tasks/${g}`); deleted.push(g);
    } catch (e) { failed.push({ gid: g, error: e.message }); }
  }
  return { ok: true, deleted, failed, moved };
}

async function status(asana, { config }){
  if (!config || !config.project) return { connected: false };
  try {
    const p = await asana.get(`/projects/${config.project}?opt_fields=name,permalink_url`);
    return { connected: true, project: p.name, url: p.permalink_url };
  } catch (e) { return { connected: false, error: e.message }; }
}
