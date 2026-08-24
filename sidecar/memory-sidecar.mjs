// memory-sidecar.mjs — minimal in-memory axolotl-compatible sidecar for fakeren.
//
// Purpose: let fakeren's core feature (假人潜意识渗漏) actually run locally
// without the real axolotl_rs graph backend. It implements the exact HTTP
// contract that src/memory/axolotl-client.ts expects, and seeds a "default"
// fake-person with some memory so the recall + drift channels produce real
// leakage text.
//
// Endpoints (see axolotl-client.ts for the caller side):
//   POST /instance/create        { id }
//   POST /{id}/node              GraphNode
//   POST /{id}/edge              GraphEdge
//   POST /{id}/query             QuerySpec            -> GraphNode[]
//   POST /{id}/recall            QuerySpec            -> GraphNode[]   (goal-directed)
//   POST /{id}/crossdomain       { limit }            -> GraphEdge[]   (drift seed pool)
//   POST /{id}/consolidate       { budget }           -> ConsolidationReport
//   GET  /{id}/stats             -                    -> GraphStats
//   GET  /instances              -                    -> InstanceId[]
//   GET  /instances/meta         -                    -> InstanceMeta[]
//   GET  /{id}/meta              -                    -> InstanceMeta | 404
//   PUT  /{id}/meta              InstanceMeta         -> {}
//   POST /session/bind           { sessionId, instanceId } -> {}
//   POST /session/resolve        { sessionId }        -> { instanceId }
//
// Run: node sidecar/memory-sidecar.mjs   (listens on 127.0.0.1:8741)

import http from "node:http";

const PORT = Number(process.env.FAKEREN_SIDECAR_PORT ?? 8741);
const HOST = process.env.FAKEREN_SIDECAR_HOST ?? "127.0.0.1";

/** instanceId -> { nodes: GraphNode[], edges: GraphEdge[] } */
const db = new Map();
/** instanceId -> InstanceMeta (name/createdAt/turns) */
const metas = new Map();
/** sessionId -> instanceId (维度 I: a session binds exactly one instance) */
const sessions = new Map();

function getInst(id) {
  let inst = db.get(id);
  if (!inst) {
    inst = { nodes: [], edges: [] };
    db.set(id, inst);
    if (!metas.has(id)) {
      metas.set(id, { id, name: id, createdAt: Date.now(), turns: 0 });
    }
  }
  return inst;
}

// ── Seed: a default fake-person with some memory ──
const DEFAULT_ID = "default";
const seed = getInst(DEFAULT_ID);
seed.nodes.push(
  {
    id: "n_cat",
    type: "Entity",
    label: "养了一只橘猫叫豆豆",
    instanceId: DEFAULT_ID,
    props: { topic: "pet" },
    valence: 0.6,
    valenceSelf: true,
    weight: 1.0,
    decayed: false,
    timestamp: Date.now(),
    provenanceId: "seed",
  },
  {
    id: "n_rain",
    type: "Event",
    label: "喜欢在雨天独处听歌",
    instanceId: DEFAULT_ID,
    props: { topic: "mood" },
    valence: -0.2,
    valenceSelf: true,
    weight: 1.0,
    decayed: false,
    timestamp: Date.now(),
    provenanceId: "seed",
  },
  {
    id: "n_guitar",
    type: "Event",
    label: "最近在学吉他总是按不准和弦",
    instanceId: DEFAULT_ID,
    props: { topic: "hobby" },
    valence: 0.1,
    valenceSelf: true,
    weight: 1.0,
    decayed: false,
    timestamp: Date.now(),
    provenanceId: "seed",
  },
  {
    id: "n_wary",
    type: "MetaNode",
    label: "对陌生环境有警惕心",
    instanceId: DEFAULT_ID,
    props: {},
    valence: -0.3,
    valenceSelf: true,
    weight: 1.0,
    decayed: false,
    timestamp: Date.now(),
    provenanceId: "seed",
  },
);
// NOTE: for demo readability the drift seed edges use human-readable phrases in
// from/to (instead of node ids). fakeren's DriftChannel emits `[跨域联想] ${e.from} ↔ ${e.to}`
// verbatim, so this keeps the leaked block legible in the local test sidecar.
seed.edges.push(
  {
    from: "喜欢在雨天独处听歌",
    to: "对陌生环境有警惕心",
    kind: "crossdomain_weak",
    instanceId: DEFAULT_ID,
    props: { decayed: false },
    weight: 0.8,
  },
  {
    from: "养了一只橘猫叫豆豆",
    to: "最近在学吉他总是按不准和弦",
    kind: "relates",
    instanceId: DEFAULT_ID,
    props: {},
    weight: 0.5,
  },
);

function matchNodes(nodes, keywords, minAbsValence, limit) {
  const kw = (keywords ?? []).map((k) => String(k).toLowerCase());
  let out = nodes.filter((n) => {
    if (minAbsValence != null && Math.abs(n.valence ?? 0) < minAbsValence) return false;
    if (kw.length === 0) return true;
    const hay = (n.label + " " + JSON.stringify(n.props ?? {})).toLowerCase();
    return kw.some((k) => hay.includes(k));
  });
  // Prefer higher |valence| first for leak quality.
  out = out.sort((a, b) => Math.abs(b.valence ?? 0) - Math.abs(a.valence ?? 0));
  return out.slice(0, limit ?? 20);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  let body = {};
  if (req.method === "POST") {
    try {
      body = await readJson(req);
    } catch {
      /* ignore malformed body */
    }
  }
  console.error(`[sidecar] ${req.method} ${path}`);

  let status = 200;
  let payload = {};

  try {
    if (req.method === "POST" && path === "/instance/create") {
      getInst(body.id);
      payload = {};
    } else if (req.method === "GET" && path === "/instances") {
      payload = [...db.keys()];
    } else if (req.method === "GET" && path === "/instances/meta") {
      payload = [...metas.values()];
    } else if ((req.method === "PUT" || req.method === "POST") && /^\/[^/]+\/meta$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[1]);
      metas.set(id, body);
      payload = {};
    } else if (req.method === "GET" && /^\/[^/]+\/meta$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[1]);
      if (metas.has(id)) {
        payload = metas.get(id);
      } else {
        status = 404;
        payload = { error: "instance not found" };
      }
    } else if (req.method === "POST" && path === "/session/bind") {
      sessions.set(body.sessionId, body.instanceId);
      payload = {};
    } else if (req.method === "POST" && path === "/session/resolve") {
      payload = { instanceId: sessions.get(body.sessionId) ?? null };
    } else {
      const m = path.match(/^\/([^/]+)\/(node|edge|query|recall|crossdomain|consolidate|stats)$/);
      if (!m) {
        status = 404;
        payload = { error: "not found" };
      } else {
        const id = decodeURIComponent(m[1]);
        const op = m[2];
        const inst = getInst(id);
        if (op === "node") {
          inst.nodes.push(body);
          payload = {};
        } else if (op === "edge") {
          inst.edges.push(body);
          payload = {};
        } else if (op === "query") {
          payload = matchNodes(inst.nodes, body.keywords, body.minAbsValence, body.limit);
        } else if (op === "recall") {
          payload = matchNodes(inst.nodes, body.keywords, body.minAbsValence, body.limit);
        } else if (op === "crossdomain") {
          const lim = body.limit ?? 200;
          payload = inst.edges
            .filter((e) => e.kind === "crossdomain_weak" && !(e.props && e.props.decayed))
            .slice(0, lim);
        } else if (op === "consolidate") {
          payload = {
            instanceId: id,
            reviewed: inst.nodes.length,
            decayed: 0,
            merged: [],
            grownMeta: [],
            kept: inst.nodes.length,
          };
        } else if (op === "stats") {
          payload = {
            instanceId: id,
            nodes: inst.nodes.length,
            edges: inst.edges.length,
            decayed: inst.nodes.filter((n) => n.decayed).length,
          };
        }
      }
    }
  } catch (e) {
    status = 500;
    payload = { error: String(e) };
  }

  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
});

server.listen(PORT, HOST, () => {
  console.error(
    `[sidecar] listening on http://${HOST}:${PORT} (seeded instance "${DEFAULT_ID}" with ${seed.nodes.length} nodes / ${seed.edges.length} edges)`,
  );
});
