#!/usr/bin/env python3
"""
假人 (Golem) — axolotl sidecar.

The ONLY process that touches axolotl_rs. One graph file per golem instance
(维度 I: per-instance namespace). Exposes a tiny HTTP API consumed by the TS
plugin's AxolotlClient. No file/markdown memory or logs — axolotl is the single
source of truth (dec_memory_axolotl_only).

Persistence model:
  - Memory (nodes/edges)        -> per-instance `<id>.axeb` axolotl graph file.
  - Instance metadata (name/    -> stored INSIDE the instance's own .axeb graph
    persona/personaLen/...)       as a `__meta__` vertex (still axolotl, not a file).
  - Default-instance selector   -> stored in a `__config__.axeb` axolotl graph.
  - Session -> instance binding -> in-memory routing table (ephemeral; not the
                                    golem's accumulated memory, so D1 does not
                                    forbid it; dsh rebinds on new session anyway).

Run:
    python server.py --root ~/.fakeren/instances --port 8741

Requires axolotl_rs (provided by the lobster-memory venv:
    /Users/sai/.workbuddy/venvs/lobster-memory/bin/python)
"""

import argparse
import fcntl
import hashlib
import json
import logging
import os
import random
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import axolotl_rs  # type: ignore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("golem-sidecar")

ROOT = int.from_bytes(hashlib.sha256(b"fakeren_root").digest()[:8], "big")
DECAY_FACTOR = 0.9
DECAY_THRESHOLD = 0.15
GROWTH_PROB = 0.15
MANIFEST_ID = "__edges__"
META_VERTEX_ID = "__meta__"
CONFIG_INSTANCE = "__config__"
DEFAULT_VERTEX_ID = "__default__"


def sid(s: str) -> int:
    return int.from_bytes(hashlib.sha256(s.encode()).digest()[:8], "big")


def flat(d) -> dict:
    try:
        return dict(d)
    except Exception:
        return {}


class InstanceGraph:
    def __init__(self, path: str):
        self._path = path
        self._lock_fd = open(path + ".lock", "w")
        fcntl.flock(self._lock_fd, fcntl.LOCK_EX)
        self._g = axolotl_rs.AxolotlGraph.open(path)
        self._ensure_root()
        self._edges = self._load_edges()

    def _ensure_root(self):
        if self._g.get_vertex(ROOT) is None:
            self._g.add_vertex(ROOT, {"id": "fakeren_root", "label": "root", "type": "root", "status": "live"})

    def _load_edges(self):
        raw = self._g.get_vertex(sid(MANIFEST_ID))
        if raw is None:
            return []
        return json.loads(flat(raw).get("data", "[]"))

    def _save_edges(self):
        self._g.add_vertex(
            sid(MANIFEST_ID),
            {"id": MANIFEST_ID, "label": "edges", "type": "manifest", "status": "live",
             "data": json.dumps(self._edges, ensure_ascii=False)},
        )

    # ── write ────────────────────────────────────────────
    def add_node(self, n: dict):
        nid = sid(n["id"])
        rec = {
            "id": n["id"], "type": n["type"], "label": n["label"],
            "instanceId": n["instanceId"], "valence": float(n.get("valence", 0.0)),
            "valenceSelf": bool(n.get("valenceSelf", True)), "weight": float(n.get("weight", 1.0)),
            "decayed": bool(n.get("decayed", False)), "timestamp": int(n.get("timestamp", 0) or 0),
            "provenanceId": str(n.get("provenanceId", "") or ""),
            "props_json": json.dumps(n.get("props", {}), ensure_ascii=False), "status": "live",
        }
        self._g.add_vertex(nid, rec)
        if self._g.get_edge(ROOT, nid) is None:
            self._g.add_edge(ROOT, nid, 0.01, {"kind": "has_member", "status": "live"})
        # Persist immediately (durability fix): previously writes were only
        # flushed by set_meta/consolidate/close, so a sidecar kill lost the
        # most recent in-memory nodes — making "memory-first" unreliable.
        self._g.save()

    def add_edge(self, e: dict):
        fn, tn = sid(e["from"]), sid(e["to"])
        for nid, s in ((fn, e["from"]), (tn, e["to"])):
            if self._g.get_vertex(nid) is None:
                self._g.add_vertex(nid, {"id": s, "label": s, "type": "Entity", "status": "live"})
        w = float(e.get("weight", 1.0))
        self._g.add_edge(fn, tn, w, {"kind": e["kind"], "weight": w, "status": "live"})
        self._edges.append({
            "from": e["from"], "to": e["to"], "kind": e["kind"], "instanceId": e["instanceId"],
            "weight": w, "props_json": json.dumps(e.get("props", {}), ensure_ascii=False),
        })
        self._save_edges()
        self._g.save()

    # ── instance metadata (lives in the same axolotl graph, not a file) ──
    def get_meta(self) -> dict | None:
        raw = self._g.get_vertex(sid(META_VERTEX_ID))
        if raw is None:
            return None
        mj = flat(raw).get("meta_json")
        if not mj:
            return None
        try:
            return json.loads(mj)
        except Exception:
            return None

    def set_meta(self, meta: dict):
        self._g.add_vertex(
            sid(META_VERTEX_ID),
            {"id": META_VERTEX_ID, "label": "meta", "type": "__meta__", "status": "live",
             "meta_json": json.dumps(meta, ensure_ascii=False)},
        )
        self._g.save()

    # ── read ─────────────────────────────────────────────
    def _all_nodes(self):
        out = []
        for vid in self._g.walk(ROOT, 4):
            raw = self._g.get_vertex(vid)
            if raw is None:
                continue
            p = flat(raw)
            if p.get("type") in ("root", "manifest", "__meta__"):
                continue
            out.append(p)
        return out

    def _match(self, n, spec):
        if spec.get("type") and n.get("type") != spec["type"]:
            return False
        if spec.get("instanceId") and n.get("instanceId") != spec["instanceId"]:
            return False
        if spec.get("minAbsValence") is not None and abs(float(n.get("valence", 0.0))) < spec["minAbsValence"]:
            return False
        kws = spec.get("keywords") or []
        if kws:
            hay = (n.get("label", "") + " " + n.get("props_json", "")).lower()
            if not any(k.lower() in hay for k in kws):
                return False
        if spec.get("props"):
            pj = json.loads(n.get("props_json", "{}"))
            for k, v in spec["props"].items():
                if pj.get(k) != v:
                    return False
        return True

    def query(self, spec):
        return [self._reconstruct(n) for n in self._all_nodes() if self._match(n, spec)][: spec.get("limit", 50)]

    def recall(self, spec):
        return self.query(spec)

    def _reconstruct(self, n):
        return {
            "id": n["id"], "type": n["type"], "label": n["label"], "instanceId": n["instanceId"],
            "props": json.loads(n.get("props_json", "{}")), "valence": float(n.get("valence", 0.0)),
            "valenceSelf": True, "weight": float(n.get("weight", 1.0)), "decayed": bool(n.get("decayed", False)),
            "timestamp": int(n.get("timestamp", 0) or 0), "provenanceId": n.get("provenanceId", ""),
        }

    def cross_domain(self, instance_id, limit=200):
        return [
            {"from": e["from"], "to": e["to"], "kind": e["kind"], "instanceId": e["instanceId"],
             "weight": e.get("weight", 1.0), "props": json.loads(e.get("props_json", "{}"))}
            for e in self._edges if e["kind"] == "crossdomain_weak" and e["instanceId"] == instance_id
        ][:limit]

    def neighbors(self, node_id: str, instance_id: str):
        """1-hop neighbors of a node (for 2-hop recall expansion)."""
        out = []
        seen = set()
        for e in self._edges:
            if e.get("instanceId") != instance_id:
                continue
            other = None
            if e.get("from") == node_id:
                other = e.get("to")
            elif e.get("to") == node_id:
                other = e.get("from")
            if other is None or other in seen:
                continue
            seen.add(other)
            raw = self._g.get_vertex(sid(other))
            if raw is None:
                continue
            p = flat(raw)
            if p.get("type") in ("root", "manifest", "__meta__"):
                continue
            out.append(self._reconstruct(p))
        return out

    # ── maintenance: Plan B decay + conservative recursive growth ──
    def consolidate(self, instance_id, budget):
        nodes = [n for n in self._all_nodes() if n.get("instanceId") == instance_id]
        reviewed = kept = decayed = 0
        merged = []
        grown = []
        for n in nodes:
            reviewed += 1
            if not n.get("decayed"):
                w = float(n.get("weight", 1.0)) * DECAY_FACTOR
                n["weight"] = w
                if w < DECAY_THRESHOLD:
                    n["decayed"] = True
                    decayed += 1
                self._g.add_vertex(sid(n["id"]), n)
            kept += 1

        # conservative recursive growth (dec_recursive_growth_conservative)
        try:
            pr = self._g.pagerank(30, 0.85)
            top = sorted(pr.items(), key=lambda kv: kv[1], reverse=True)[:3]
            if top and random.random() < GROWTH_PROB:
                ids = []
                for nid, _ in top:
                    v = self._g.get_vertex(nid)
                    if v is not None:
                        ids.append(flat(v).get("id"))
                if len(ids) >= 2:
                    meta_id = f"meta_{int(time.time() * 1000)}"
                    self.add_node({"id": meta_id, "type": "MetaNode", "label": "元簇", "instanceId": instance_id,
                                   "props": {"members": ids}, "valence": 0.0, "valenceSelf": True,
                                   "weight": 1.0, "decayed": False, "timestamp": int(time.time() * 1000)})
                    for m in ids:
                        self.add_edge({"from": meta_id, "to": m, "kind": "crossdomain_weak",
                                       "instanceId": instance_id, "weight": 0.5})
                    grown.append(meta_id)
        except Exception as e:  # pragma: no cover
            logger.warning("recursive growth skipped: %s", e)

        self._g.save()
        return {"instanceId": instance_id, "reviewed": reviewed, "decayed": decayed,
                "merged": merged, "grownMeta": grown, "kept": kept}

    def stats(self, instance_id):
        nodes = [n for n in self._all_nodes() if n.get("instanceId") == instance_id]
        return {"instanceId": instance_id, "nodes": len(nodes),
                "edges": len([e for e in self._edges if e["instanceId"] == instance_id]),
                "decayed": len([n for n in nodes if n.get("decayed")])}

    def save(self):
        self._g.save()

    def close(self):
        try:
            self._g.save()
            self._g.close()
        finally:
            fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
            self._lock_fd.close()


class Sidecar:
    def __init__(self, root: str):
        self._root = root
        os.makedirs(root, exist_ok=True)
        self._cache: dict[str, InstanceGraph] = {}
        self._lock = threading.Lock()
        self._sessions: dict[str, str] = {}  # sessionId -> instanceId (ephemeral routing)

    def graph(self, instance_id: str) -> InstanceGraph:
        with self._lock:
            if instance_id not in self._cache:
                path = os.path.join(self._root, f"{instance_id}.axeb")
                self._cache[instance_id] = InstanceGraph(path)
            return self._cache[instance_id]

    def ensure(self, instance_id: str):
        # open (creates the .axeb on disk lazily) then force a flush so the
        # instance shows up in instances() / on disk immediately — axolotl only
        # materialises the file on save().
        g = self.graph(instance_id)
        g.save()

    def instances(self):
        out = set()
        for f in os.listdir(self._root):
            if f.endswith(".axeb"):
                out.add(f[: -len(".axeb")])
        with self._lock:
            out.update(self._cache.keys())
        return sorted(out)

    # ── instance metadata ──
    def get_meta(self, instance_id: str) -> dict | None:
        if not os.path.exists(os.path.join(self._root, f"{instance_id}.axeb")):
            return None
        return self.graph(instance_id).get_meta()

    def set_meta(self, instance_id: str, meta: dict):
        g = self.graph(instance_id)
        meta = dict(meta)
        meta["id"] = instance_id
        g.set_meta(meta)

    def list_meta(self):
        out = []
        for iid in self.instances():
            m = self.get_meta(iid)
            if m is not None:
                out.append(m)
        return out

    # ── default-instance selector (stored in a dedicated axolotl graph) ──
    def get_default(self) -> str | None:
        g = self.graph(CONFIG_INSTANCE)
        raw = g._g.get_vertex(sid(DEFAULT_VERTEX_ID))
        if raw is None:
            return None
        return flat(raw).get("instanceId")

    def set_default(self, instance_id: str):
        g = self.graph(CONFIG_INSTANCE)
        g._g.add_vertex(sid(DEFAULT_VERTEX_ID),
                        {"id": DEFAULT_VERTEX_ID, "label": "default", "type": "__config__",
                         "status": "live", "instanceId": instance_id})
        g.save()

    # ── session binding (ephemeral routing) ──
    def bind(self, session_id: str, instance_id: str):
        with self._lock:
            self._sessions[session_id] = instance_id

    def resolve(self, session_id: str) -> str | None:
        with self._lock:
            return self._sessions.get(session_id)

    # ── delete an instance entirely (meta + memory graph + bindings) ──
    def delete_instance(self, instance_id: str) -> bool:
        with self._lock:
            g = self._cache.pop(instance_id, None)
        if g is not None:
            try:
                g.close()
            except Exception:
                pass
        removed = False
        for suffix in (".axeb", ".axeb.lock"):
            p = os.path.join(self._root, instance_id + suffix)
            if os.path.exists(p):
                os.remove(p)
                removed = True
        # drop any session bindings to the deleted instance
        with self._lock:
            for sid_key in [k for k, v in self._sessions.items() if v == instance_id]:
                del self._sessions[sid_key]
        # also clear default if it pointed here (but never touch the config
        # instance itself via get_default, which would lazily recreate it)
        if instance_id != CONFIG_INSTANCE and self.get_default() == instance_id:
            dp = os.path.join(self._root, CONFIG_INSTANCE + ".axeb")
            if os.path.exists(dp):
                os.remove(dp)
        return removed

    def close_all(self):
        with self._lock:
            for g in self._cache.values():
                g.close()
            self._cache.clear()


class Handler(BaseHTTPRequestHandler):
    sidecar: Sidecar

    def _body(self):
        length = int(self.headers.get("content-length", 0) or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length) or b"{}")

    def _send(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass

    # ── GET ──
    def do_GET(self):
        p = urlparse(self.path)
        parts = [x for x in p.path.split("/") if x]
        if p.path.rstrip("/") == "/instances":
            return self._send(self.sidecar.instances())
        if p.path.rstrip("/") == "/instances/meta":
            return self._send(self.sidecar.list_meta())
        if len(parts) == 2 and parts[1] == "meta":
            m = self.sidecar.get_meta(parts[0])
            if m is None:
                return self._send({"error": "not found"}, 404)
            return self._send(m)
        if len(parts) == 2 and parts[1] == "stats":
            return self._send(self.sidecar.graph(parts[0]).stats(parts[0]))
        if p.path.rstrip("/") == "/config/default":
            return self._send({"instanceId": self.sidecar.get_default()})
        return self._send({"error": "not found"}, 404)

    # ── POST ──
    def do_POST(self):
        p = urlparse(self.path)
        parts = [x for x in p.path.split("/") if x]
        body = self._body()
        try:
            if p.path.rstrip("/") == "/instance/create":
                self.sidecar.ensure(body["id"])
                return self._send({"ok": True, "id": body["id"]})
            if p.path.rstrip("/") == "/session/bind":
                self.sidecar.bind(body["sessionId"], body["instanceId"])
                return self._send({"ok": True})
            if p.path.rstrip("/") == "/session/resolve":
                return self._send({"instanceId": self.sidecar.resolve(body.get("sessionId"))})
            if len(parts) == 2:
                inst, op = parts[0], parts[1]
                g = self.sidecar.graph(inst)
                if op == "node":
                    g.add_node(body); return self._send({"ok": True})
                if op == "edge":
                    g.add_edge(body); return self._send({"ok": True})
                if op == "query":
                    return self._send(g.query(body))
                if op == "recall":
                    return self._send(g.recall(body))
                if op == "crossdomain":
                    return self._send(g.cross_domain(inst, body.get("limit", 200)))
                if op == "neighbors":
                    return self._send(g.neighbors(body.get("nodeId"), inst))
                if op == "consolidate":
                    return self._send(g.consolidate(inst, body.get("budget", 50)))
                if op == "meta":
                    self.sidecar.set_meta(inst, body); return self._send({"ok": True})
            return self._send({"error": "not found"}, 404)
        except Exception as e:  # pragma: no cover
            logger.exception("request failed")
            return self._send({"error": str(e)}, 500)

    # ── PUT ──
    def do_PUT(self):
        p = urlparse(self.path)
        parts = [x for x in p.path.split("/") if x]
        body = self._body()
        try:
            if p.path.rstrip("/") == "/config/default":
                self.sidecar.set_default(body["instanceId"])
                return self._send({"ok": True})
            if len(parts) == 2 and parts[1] == "meta":
                self.sidecar.set_meta(parts[0], body)
                return self._send({"ok": True})
            return self._send({"error": "not found"}, 404)
        except Exception as e:  # pragma: no cover
            logger.exception("request failed")
            return self._send({"error": str(e)}, 500)

    # ── DELETE ──
    def do_DELETE(self):
        p = urlparse(self.path)
        parts = [x for x in p.path.split("/") if x]
        try:
            if len(parts) == 1:
                removed = self.sidecar.delete_instance(parts[0])
                if removed:
                    return self._send({"ok": True})
                return self._send({"ok": True, "removed": False})
            return self._send({"error": "not found"}, 404)
        except Exception as e:  # pragma: no cover
            logger.exception("request failed")
            return self._send({"error": str(e)}, 500)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.expanduser("~/.fakeren/instances"))
    ap.add_argument("--port", type=int, default=8741)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    sc = Sidecar(args.root)
    Handler.sidecar = sc
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    logger.info("golem sidecar on http://%s:%d  root=%s (axolotl_rs backend)", args.host, args.port, args.root)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        sc.close_all()


if __name__ == "__main__":
    main()
