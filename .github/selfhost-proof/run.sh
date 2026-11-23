#!/usr/bin/env bash
# selfhost/ as someone runs it, then what a visitor reaches and where the server listens.
#
#   IMAGE=<image ref> bash .github/selfhost-proof/run.sh up|check|logs|down
#
# up writes the starter config's three sample fields (the ones a production server refuses while
# they're the example's) and .env from .env.example, pulls IMAGE, and starts compose.yml, waiting
# for its healthcheck. check fails on the first answer or listener that isn't what read-only
# serves. Run from the repository's root; it changes nothing outside selfhost/.
set -euo pipefail
cd "$(dirname "$0")/../../selfhost"

up() {
  : "${IMAGE:?IMAGE names the image to pull}"
  local f=config/portfolio.yml
  sed -i 's/^  name: Anamika Devi$/  name: Selfhost Proof/' "$f"
  sed -i 's/^  title: Anamika Devi .* Portfolio$/  title: Selfhost Proof/' "$f"
  sed -i 's#^    source: og/anamika.png$#    source: og/selfhost-proof.png#' "$f"
  grep -q '^  name: Selfhost Proof$' "$f"
  grep -q '^  title: Selfhost Proof$' "$f"
  grep -q '^    source: og/selfhost-proof.png$' "$f"
  cp .env.example .env
  sed -i 's#^PORTFOLIO_ORIGIN=.*#PORTFOLIO_ORIGIN=http://127.0.0.1:3000#' .env
  echo "PORTFOLIO_IMAGE=$IMAGE" >> .env
  cat .env
  docker compose config --quiet
  docker compose pull
  docker compose up -d --wait --wait-timeout 180
  docker compose ps
}

expect() {
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' -X "$1" "http://127.0.0.1:3000$2")
  case " $3 " in
    *" $got "*) echo "ok   $1 $2 -> $got" ;;
    *) echo "FAIL $1 $2 -> $got, wanted $3"; exit 1 ;;
  esac
}

check() {
  expect GET / 200
  expect GET /sitemap.xml 200
  expect GET /robots.txt 200
  curl -fsS http://127.0.0.1:3000/api/health | tee /dev/stderr | grep -q '"status":"ok"'
  echo
  # read-only has no Studio and nothing to sign in to.
  expect GET /studio '404 401'
  expect GET /studio/sign-in '404 401'
  expect GET /api/studio/auth.session '404 401'
  expect POST /api/studio/auth.login '404 401'
  expect POST /api/studio/draft.write '404 401'
  expect POST /api/studio/publish '404 401'

  local id
  test "$(docker compose port web 3000)" = '127.0.0.1:3000'
  id=$(docker compose ps -q web)
  test "$(docker inspect "$id" --format '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}')" = '127.0.0.1:3000 '
  test "$(docker inspect "$id" --format '{{.HostConfig.ReadonlyRootfs}}')" = true
  test "$(docker inspect "$id" --format '{{json .HostConfig.CapDrop}}')" = '["ALL"]'
  test "$(docker inspect "$id" --format '{{json .HostConfig.SecurityOpt}}')" = '["no-new-privileges:true"]'
  test "$(docker inspect "$id" --format '{{.Config.User}}')" = nextjs
  echo "ok   published on 127.0.0.1:3000 only; read-only root, no capabilities, no new privileges, as nextjs"
  # Whatever listens on the host's port 3000, Docker's proxy when it runs one, listens on
  # 127.0.0.1 alone, and the runner's own address gets nothing.
  sudo ss -ltnH 'sport = :3000' | tee listeners.txt
  if awk '{print $4}' listeners.txt | grep -v '^127\.0\.0\.1:3000$'; then echo "FAIL: a listener beyond 127.0.0.1"; exit 1; fi
  local addr
  addr=$(hostname -I | awk '{print $1}')
  if curl -s -o /dev/null --max-time 5 "http://$addr:3000/"; then echo "FAIL: $addr:3000 answered"; exit 1; fi
  echo "ok   nothing answers on $addr:3000"
}

case "${1:-}" in
  up) up ;;
  check) check ;;
  logs) docker compose logs --no-color web | tail -n 200 ;;
  down) docker compose down --volumes ;;
  *) echo "usage: IMAGE=<ref> $0 up|check|logs|down" >&2; exit 2 ;;
esac
