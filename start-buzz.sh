#!/bin/bash
# Avvia Buzz in locale: apre Docker se serve, poi relay + app desktop.
# Uso: ./start-buzz.sh
set -euo pipefail

PLATFORM_DIR="/Applications/Self Developed Applications/wellbeing-agents/buzz-platform"

echo "1/4 — Controllo Docker..."
if ! docker info >/dev/null 2>&1; then
  echo "    Docker non è attivo, lo avvio (può richiedere una decina di secondi)..."
  open -a Docker
  for i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    echo "    Docker non si è avviato in tempo. Apri l'app Docker a mano e riprova."
    exit 1
  fi
fi
echo "    Docker OK."

echo "2/4 — Controllo che la porta 3000 sia libera..."
EXISTING_PID=$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  echo "    Trovato un processo già in ascolto sulla porta 3000 (PID $EXISTING_PID), lo fermo..."
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 2
fi
echo "    Porta 3000 libera."

echo "3/4 — Verifico il bucket di storage MinIO..."
cd "$PLATFORM_DIR"
if [ "$(docker compose ps -a --format '{{.Service}}: {{.Status}}' 2>/dev/null | grep '^minio-init' | grep -c 'Up\|Exited (0)')" -eq 0 ]; then
  docker compose up minio-init 2>&1 | tail -5 || true
fi
echo "    OK."

echo "4/4 — Avvio Buzz (relay + app desktop). La finestra dell'app si aprirà da sola tra poco..."
source bin/activate-hermit
exec just dev
