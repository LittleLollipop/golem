#!/usr/bin/env bash
# golem 本地联调一键拉起脚本
# 用法: bash scripts/dev-up.sh
# 会启动 sidecar(8741) 与 dsh web(3080)，并把日志写入 /tmp/golem-*.log
set -u

GOLEM_DIR="/Users/sai/WorkBuddy/dev/golem"
DSH_SRC="/tmp/dsh-src"
SIDECAR_PORT=8741
DSH_PORT=3080

port_free() { ! lsof -iTCP:"$1" -sTCP:LISTEN -P >/dev/null 2>&1; }

echo "[dev-up] golem dir   : $GOLEM_DIR"
echo "[dev-up] dsh src    : $DSH_SRC"

# --- sidecar ---
if port_free "$SIDECAR_PORT"; then
  ( cd "$GOLEM_DIR" && node sidecar/memory-sidecar.mjs > /tmp/golem-sidecar.log 2>&1 & )
  echo "[dev-up] sidecar starting on :$SIDECAR_PORT ..."
else
  echo "[dev-up] sidecar :$SIDECAR_PORT already listening, skip"
fi

# --- dsh web ---
if port_free "$DSH_PORT"; then
  # dsh loads golem from its BUILT dist/ (package main = dist/index.js), NOT src/.
  # Always rebuild so source edits actually reach the running process.
  echo "[dev-up] building golem dist ..."
  ( cd "$GOLEM_DIR" && npm run build > /tmp/golem-build.log 2>&1 )
  echo "[dev-up] build exit=$? (see /tmp/golem-build.log)"
  rm -f /tmp/fakeren-prestep.log
  ( cd "$DSH_SRC" && node --import tsx/esm apps/cli/src/bin.ts web \
      --patch "$GOLEM_DIR/golem-cordis.yml" --no-open > /tmp/golem-dsh.log 2>&1 & )
  echo "[dev-up] dsh web starting on :$DSH_PORT ..."
else
  echo "[dev-up] dsh :$DSH_PORT already listening, skip (restart manually if you changed src)"
fi

# --- 探活 ---
sleep 4
echo "[dev-up] --- health ---"
curl -s -o /dev/null -w "sidecar :$SIDECAR_PORT -> %{http_code}\n" "http://127.0.0.1:$SIDECAR_PORT/" || true
curl -s -o /dev/null -w "dsh     :$DSH_PORT -> %{http_code}\n" "http://127.0.0.1:$DSH_PORT/" || true
echo "[dev-up] done. 打开 http://127.0.0.1:3080 即可对话"
