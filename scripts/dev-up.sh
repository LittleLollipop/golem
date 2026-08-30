#!/usr/bin/env bash
# golem 本地联调一键拉起脚本
# 用法: bash scripts/dev-up.sh
# 会启动 sidecar(8741) 与 dsh web(3080)，并把日志写入 /tmp/golem-*.log
set -u

GOLEM_DIR="/Users/sai/WorkBuddy/dev/golem"
# ⚠️ 必须是持久目录。历史坑：曾用 /tmp/dsh-src，被系统回收后 client/*/node_modules
# 里 265+ 条软链（tsdown / typescript / vitest / react / @deepseek-ai/*）集体断裂，
# 表现为「构建与测试链整体不可用 + dsh web 起不来」。不要再退回 /tmp。
# dsh 是开源仓库，丢了可重建：git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git
DSH_SRC="/Users/sai/WorkBuddy/dev/dsh-src"
SIDECAR_PORT=8741
DSH_PORT=3080

port_free() { ! lsof -iTCP:"$1" -sTCP:LISTEN -P >/dev/null 2>&1; }

# 跨平台后台脱离：Linux 有 setsid 时新建会话(可逃出调用方进程组，适合被 agent 后台任务拉起)；
# macOS 无 setsid，退回 nohup + disown（关终端不被 SIGHUP 带走）。
detach() {
  local cmd="$1" log="$2"
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bash -c "$cmd" > "$log" 2>&1 &
  else
    nohup bash -c "$cmd" > "$log" 2>&1 &
    disown 2>/dev/null || true
  fi
}

echo "[dev-up] golem dir   : $GOLEM_DIR"
echo "[dev-up] dsh src    : $DSH_SRC"

# --- sidecar (真 axolotl 后端: server.py, 依赖 lobster-memory venv 的 axolotl_rs) ---
# 注意: 这是唯一碰 axolotl_rs 的进程; 实例记忆落 <root>/<id>.axeb 图文件。
AXOLOTL_PY="/Users/sai/.workbuddy/venvs/lobster-memory/bin/python"
if port_free "$SIDECAR_PORT"; then
  detach "cd '$GOLEM_DIR' && '$AXOLOTL_PY' sidecar/server.py --root ~/.fakeren/instances --port $SIDECAR_PORT" /tmp/golem-sidecar.log
  echo "[dev-up] sidecar (axolotl) starting on :$SIDECAR_PORT ..."
else
  echo "[dev-up] sidecar :$SIDECAR_PORT already listening, skip"
fi

# --- dsh web ---
# ⚠️ 注入 LLM key：dsh 默认不把 ~/.dsh/.credentials.yaml 的 key 注入插件 env，
# 导致 golem 的 llm 为 undefined → LearningPlanner / 性格漂移 introspect 全部无法
# 真正运行（目的轨被「无模型规划」空消耗、当天永久跳过）。在此从 dsh 凭据提取并
# export，确保 golem 的 planner/drift 能用模型。改 src 后必须重建 dist（见下）。
DSH_CREDS="$HOME/.dsh/.credentials.yaml"
if [ -f "$DSH_CREDS" ]; then
  _EXTRACTED_KEY=$(grep "DEEPSEEK_API_KEY" "$DSH_CREDS" | head -1 | awk -F': ' '{print $2}')
  if [ -n "$_EXTRACTED_KEY" ]; then
    export DEEPSEEK_API_KEY="$_EXTRACTED_KEY"
    echo "[dev-up] DEEPSEEK_API_KEY injected from dsh credentials"
  else
    echo "[dev-up] WARN: DEEPSEEK_API_KEY not found in $DSH_CREDS; golem llm disabled"
  fi
else
  echo "[dev-up] WARN: $DSH_CREDS not found; golem llm disabled"
fi
if port_free "$DSH_PORT"; then
  # dsh loads golem from its BUILT dist/ (package main = dist/index.js), NOT src/.
  # Always rebuild so source edits actually reach the running process.
  echo "[dev-up] building golem dist ..."
  ( cd "$GOLEM_DIR" && npm run build > /tmp/golem-build.log 2>&1 )
  echo "[dev-up] build exit=$? (see /tmp/golem-build.log)"
  # 浏览器侧加载的是 client 包的【已构建 bundle】(lib/client.js)，不是 src/。
  # 只改 client/*/src 而不重新 bundle，页面行为不会变——历史坑：「保存人格」
  # 静默存空串的修复曾因此看不出效果。所以每次拉起都强制重打两个 client 包。
  echo "[dev-up] bundling golem client packages ..."
  for p in ui-golem-config ui-golem-remote; do
    if ( cd "$GOLEM_DIR/client/$p" && node node_modules/tsdown/dist/run.mjs >> /tmp/golem-build.log 2>&1 ); then
      echo "[dev-up]   $p bundled"
    else
      echo "[dev-up]   $p bundle FAILED (see /tmp/golem-build.log)"
    fi
  done
  rm -f /tmp/fakeren-prestep.log
  # ⚠️ 用 detach 让 dsh web 脱离脚本的进程组独立成会话：否则脚本作为后台任务退出时，
  # 工具会回收其进程组，连带把 dsh web 一起杀掉（症状：脚本自家探活 401 通过，但
  # 任务一结束 3080 立刻没监听）。sidecar 同理。macOS 无 setsid 时退回 nohup+disown。
  detach "cd '$DSH_SRC' && node --import tsx/esm apps/cli/src/bin.ts web --patch '$GOLEM_DIR/golem-cordis.yml' --no-open" /tmp/golem-dsh.log
  echo "[dev-up] dsh web starting on :$DSH_PORT ..."
else
  echo "[dev-up] dsh :$DSH_PORT already listening, skip (restart manually if you changed src)"
fi

# --- 探活 ---
sleep 8
echo "[dev-up] --- health ---"
curl -s -o /dev/null -w "sidecar :$SIDECAR_PORT -> %{http_code}\n" "http://127.0.0.1:$SIDECAR_PORT/" || true
curl -s -o /dev/null -w "dsh     :$DSH_PORT -> %{http_code}\n" "http://127.0.0.1:$DSH_PORT/" || true
# dsh web 每次启动生成新 token，不带 token 打不开；直接把带 token 的 URL 打出来。
TOKEN_URL=$(grep -o "http://127.0.0.1:$DSH_PORT/?token=[A-Za-z0-9_.~-]*" /tmp/golem-dsh.log 2>/dev/null | tail -1)
if [ -n "$TOKEN_URL" ]; then
  echo "[dev-up] web URL: $TOKEN_URL"
else
  echo "[dev-up] 未从 /tmp/golem-dsh.log 抓到 token URL，请自行查看该日志"
fi
echo "[dev-up] done."
