import * as fs from "node:fs";

const LEDGER = "/Users/sai/WorkBuddy/dev/dsh-src/.fakeren-knowledge/ysj.json";
const OUT = "/Users/sai/WorkBuddy/dev/golem/scripts/knowledge-records.html";

type Fact = {
  kind: string;
  status: string;
  source: string;
  title?: string;
  sourceUrl?: string;
  statusNote?: string;
  learnedAt?: string;
};

const s = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as {
  instanceId: string;
  trajectory: Fact[];
  purposefulDoneDate: string;
};

const purposeful = s.trajectory.filter((f) => f.kind === "purposeful");
const random = s.trajectory.filter((f) => f.kind === "random");

const srcColor: Record<string, string> = {
  News: "#2563eb",
  "Hacker News": "#ea580c",
  Wikipedia: "#16a34a",
};
const statusColor: Record<string, string> = {
  learned: "#16a34a",
  empty: "#9ca3af",
  junk: "#d97706",
  error: "#dc2626",
};

function row(f: Fact): string {
  const sc = srcColor[f.source] || "#64748b";
  const stc = statusColor[f.status] || "#64748b";
  const title = f.title ? escapeHtml(f.title) : "(无标题)";
  const link = f.sourceUrl
    ? `<a href="${escapeAttr(f.sourceUrl)}" target="_blank" rel="noopener">🔗</a>`
    : "";
  const note = f.statusNote ? `<span class="note">${escapeHtml(f.statusNote)}</span>` : "";
  return `<tr>
    <td><span class="badge" style="background:${sc}">${escapeHtml(f.source)}</span></td>
    <td><span class="badge" style="background:${stc}">${f.status}</span></td>
    <td class="title">${title} ${link} ${note}</td>
    <td class="time">${f.learnedAt || ""}</td>
  </tr>`;
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
function escapeAttr(t: string): string {
  return escapeHtml(t).replace(/'/g, "&#39;");
}

const learnedCount = purposeful.filter((f) => f.status === "learned").length;
const newsCount = purposeful.filter((f) => f.source === "News" && f.status === "learned").length;
const socialCount = purposeful.filter(
  (f) => f.source === "Hacker News" && f.status === "learned",
).length;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>golem 知识获取记录 · ysj</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
         background:#f6f7f9; color:#1f2937; margin:0; padding:24px; }
  .wrap { max-width: 920px; margin: 0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#6b7280; font-size:13px; margin-bottom:16px; }
  .cards { display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:14px 18px; flex:1; min-width:140px; }
  .card .n { font-size:26px; font-weight:700; }
  .card .l { font-size:12px; color:#6b7280; margin-top:2px; }
  h2 { font-size:15px; margin:22px 0 8px; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:9px 12px; font-size:13px; border-bottom:1px solid #f0f1f3; vertical-align:top; }
  th { background:#f9fafb; color:#6b7280; font-weight:600; }
  .badge { color:#fff; padding:2px 8px; border-radius:999px; font-size:11px; white-space:nowrap; }
  .title { max-width:520px; }
  .note { color:#9ca3af; font-size:11px; margin-left:6px; }
  .time { color:#9ca3af; white-space:nowrap; font-variant-numeric:tabular-nums; }
  tr:last-child td { border-bottom:none; }
</style></head>
<body><div class="wrap">
  <h1>golem 知识获取轨迹 · 实例 ysj</h1>
  <div class="sub">目的轨（模型规划）每日 1 次 + 随机轨（Wikipedia）每日 1 次 · 生成于 ${new Date().toLocaleString("zh-CN")}</div>
  <div class="cards">
    <div class="card"><div class="n">${purposeful.length}</div><div class="l">目的轨尝试总数</div></div>
    <div class="card"><div class="n" style="color:#16a34a">${learnedCount}</div><div class="l">成功 learned</div></div>
    <div class="card"><div class="n" style="color:#2563eb">${newsCount}</div><div class="l">新闻 News 成功</div></div>
    <div class="card"><div class="n" style="color:#ea580c">${socialCount}</div><div class="l">社交 HN 成功</div></div>
  </div>
  <h2>目的轨（含新闻 / 社交媒体）</h2>
  <table><thead><tr><th>渠道</th><th>状态</th><th>内容</th><th>时间</th></tr></thead>
  <tbody>${purposeful.slice().reverse().map(row).join("")}</tbody></table>
  <h2>随机轨（Wikipedia 探索）</h2>
  <table><thead><tr><th>渠道</th><th>状态</th><th>内容</th><th>时间</th></tr></thead>
  <tbody>${random.slice().reverse().map(row).join("")}</tbody></table>
</div></body></html>`;

fs.writeFileSync(OUT, html);
console.log("written:", OUT);
console.log(`purposeful=${purposeful.length} learned=${learnedCount} news=${newsCount} social=${socialCount} random=${random.length}`);
