#!/usr/bin/env bash
# One-time (and safe to repeat) setup of Gym Planner on a Linux server WITHOUT Docker.
# Works on Amazon Linux 2023 and Ubuntu/Debian. Run it as root from the folder you uploaded:
#
#     sudo bash setup-server.sh
#
# Expects, next to this script:   backend.tar.gz  (the backend code)   and   dist/  (the built website)
# Uses little disk: no Node, no build tools, no pip cache.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=/opt/gym-planner
DATA=/var/lib/gym-planner
WEB=/var/www/gym-planner
ENV_FILE=/etc/gym-planner.env

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo:  sudo bash setup-server.sh"; exit 1; }
[ -f "$HERE/backend.tar.gz" ] || { echo "backend.tar.gz is missing next to this script."; exit 1; }
[ -d "$HERE/dist" ] || { echo "The dist folder (built website) is missing next to this script."; exit 1; }

echo "==> 1/7 Installing Python and nginx"
if command -v dnf >/dev/null 2>&1; then
  dnf install -y python3.11 nginx >/dev/null
  PY=python3.11
elif command -v apt-get >/dev/null 2>&1; then
  apt-get update -y >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv nginx >/dev/null
  PY=python3
else
  echo "Unsupported system: need dnf or apt-get."; exit 1
fi
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Python 3.10 or newer is needed."; exit 1; }

echo "==> 2/7 Creating the service user and folders"
id gymplanner >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin gymplanner
mkdir -p "$APP" "$DATA/media" "$DATA/backups" "$WEB"

# Your data from the PC (only if you made the bundle with -WithDatabase, and only the first time: never overwrites)
if [ -f "$HERE/data/gym_planner.db" ] && [ ! -f "$DATA/gym_planner.db" ] && ! grep -q '^DATABASE_URL=postgres' "$ENV_FILE" 2>/dev/null; then
  echo "    Copying your database to $DATA"
  cp "$HERE/data/gym_planner.db" "$DATA/gym_planner.db"
  [ -d "$HERE/data/media" ] && cp -r "$HERE/data/media/." "$DATA/media/" || true
fi

echo "==> 3/7 Installing the backend"
rm -rf "$APP/backend"
mkdir -p "$APP/backend"
tar -xzf "$HERE/backend.tar.gz" -C "$APP/backend"
if [ ! -d "$APP/venv" ]; then "$PY" -m venv "$APP/venv"; fi
"$APP/venv/bin/pip" install --no-cache-dir --quiet --upgrade pip
"$APP/venv/bin/pip" install --no-cache-dir --quiet -r "$APP/backend/requirements.txt"

echo "==> 4/7 Settings file"
if [ ! -f "$ENV_FILE" ]; then
  cp "$HERE/env.server.example" "$ENV_FILE"
  SECRET="$("$APP/venv/bin/python" -c 'import secrets; print(secrets.token_urlsafe(48))')"
  sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET|" "$ENV_FILE"
  echo "    Created $ENV_FILE. EDIT IT now: set CORS_ORIGINS and RESEND_API_KEY (sudo nano $ENV_FILE), then run this script again."
  chown root:gymplanner "$ENV_FILE"; chmod 640 "$ENV_FILE"
  exit 0
fi
chown root:gymplanner "$ENV_FILE"; chmod 640 "$ENV_FILE"
if grep -q "YOUR-EC2-PUBLIC-IP" "$ENV_FILE"; then echo "Edit CORS_ORIGINS in $ENV_FILE first (sudo nano $ENV_FILE)."; exit 1; fi
if grep -q "^RESEND_API_KEY=$" "$ENV_FILE"; then echo "    Note: RESEND_API_KEY is empty, so emails cannot be sent."; fi

DB_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
IS_PG=0
case "$DB_URL" in postgres*) IS_PG=1;; esac
run_as_app() { runuser -u gymplanner -- env DATABASE_URL="$DB_URL" "$@"; }

if [ "$IS_PG" = 1 ]; then
  echo "==> 4b/7 Checking the connection to the RDS database"
  if ! (cd "$APP/backend" && run_as_app "$APP/venv/bin/python" -) <<'PYCHECK'
import sys
from sqlalchemy import create_engine, text
from app.db.session import normalise_url
import os
try:
    e = create_engine(normalise_url(os.environ["DATABASE_URL"]), connect_args={"connect_timeout": 10})
    with e.connect() as c:
        print("    Connected:", c.execute(text("select version()")).scalar().split(",")[0])
except Exception as exc:
    print("    COULD NOT CONNECT to the database:", type(exc).__name__)
    print("    Check: (1) the endpoint, user and password in DATABASE_URL; (2) the RDS security group allows this server on port 5432;")
    print("           (3) the RDS instance and this server are in the same VPC. Details: DEPLOY.md, part B.")
    sys.exit(1)
PYCHECK
  then exit 1; fi
fi

echo "==> 5/7 Installing the website and permissions"
rm -rf "$WEB"/*
cp -r "$HERE/dist/." "$WEB/"
chown -R gymplanner:gymplanner "$APP" "$DATA"
chmod 750 "$DATA"
# the website folder must be readable by nginx
chmod -R a+rX "$WEB"

if [ "$IS_PG" = 1 ]; then
  echo "    Preparing the database tables"
  (cd "$APP/backend" && run_as_app "$APP/venv/bin/python" -m alembic upgrade head)
  if [ -f "$HERE/data/gym_planner.db" ]; then
    echo "    Copying your data from the PC into RDS (only if RDS has no accounts yet)"
    (cd "$APP/backend" && run_as_app "$APP/venv/bin/python" scripts/sqlite_to_postgres.py --sqlite "$HERE/data/gym_planner.db" --postgres "$DB_URL") \
      || echo "    (not copied: see the message above. This is fine if RDS already has your accounts.)"
    [ -d "$HERE/data/media" ] && cp -rn "$HERE/data/media/." "$DATA/media/" && chown -R gymplanner:gymplanner "$DATA/media" || true
  fi
fi

echo "==> 6/7 Starting the API (systemd)"
cp "$HERE/gym-planner.service" /etc/systemd/system/gym-planner.service
systemctl daemon-reload
systemctl enable gym-planner >/dev/null 2>&1
systemctl restart gym-planner

echo "==> 7/7 Starting nginx"
rm -f /etc/nginx/conf.d/default.conf /etc/nginx/sites-enabled/default 2>/dev/null || true
cp "$HERE/nginx-gym-planner.conf" /etc/nginx/conf.d/gym-planner.conf
nginx -t
systemctl enable nginx >/dev/null 2>&1
systemctl restart nginx

if [ "$IS_PG" = 1 ]; then
  rm -f /etc/cron.d/gym-planner-backup          # RDS makes its own automatic backups and snapshots
  echo "    Database backups: handled by RDS (automated backups and snapshots)."
else
  # daily database backup at 03:30, keeping the last 14
  cat > /etc/cron.d/gym-planner-backup <<CRON
30 3 * * * gymplanner $APP/venv/bin/python $APP/backend/scripts/backup_db.py $DATA/gym_planner.db $DATA/backups 14
CRON
  chmod 644 /etc/cron.d/gym-planner-backup
fi

sleep 3
if curl -fsS http://127.0.0.1:8000/health >/dev/null; then
  echo
  echo "Done. The API is running. Open http://<your-server-public-ip>/ in a browser."
else
  echo
  echo "The API did not answer. See why with:  sudo journalctl -u gym-planner -n 50 --no-pager"
  exit 1
fi
