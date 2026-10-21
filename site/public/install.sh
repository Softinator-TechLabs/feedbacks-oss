#!/usr/bin/env bash
# Fresh, loopback-only quickstart using the verified Docker Hub release.
set +x
set -euo pipefail

fail() { printf 'Feedbacks: %s\n' "$*" >&2; exit 1; }

compose() {
  env -u FEEDBACKS_IMAGE -u APP_ORIGIN -u POSTGRES_PASSWORD -u ORGANIZATION_ID \
    -u FEEDBACKS_PORT -u COMPOSE_PROJECT_NAME \
    docker compose --project-name "$project" --project-directory "$directory" \
      --env-file "$directory/.env" -f "$directory/compose.yaml" "$@"
}

main() {
  local directory="$PWD/feedbacks-server" port=3000 project image checksum actual
  local database_password owner_password random_id organization_id origin
  image='softinator/feedbacks@sha256:c009ad90d1454b74f953c9d401b684837465948068f6d69fffd830bc428c6827'
  checksum='c3e98d0747d56189641df8d6822fb5a20d13ce187b5f454bfb730c22e5f4bc6f'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help)
        printf 'Usage: bash install.sh [--directory NEW_DIRECTORY] [--port 3000]\n'
        printf 'Requires Docker Compose v2, curl and OpenSSL. Starts on localhost with persistent database and image volumes.\n'
        return ;;
      --directory|--port)
        [[ $# -ge 2 && -n "$2" ]] || fail 'Missing option value. Use --help.'
        if [[ "$1" == --directory ]]; then directory=$2; else port=$2; fi
        shift 2 ;;
      *) fail 'Unknown option. Use --help.' ;;
    esac
  done
  [[ "$port" =~ ^[1-9][0-9]{3,4}$ && "$port" -ge 1024 && "$port" -le 65535 ]] || fail 'Use a port from 1024 to 65535.'
  [[ "$directory" == /* ]] || directory="$PWD/$directory"
  [[ ! -e "$directory" && ! -L "$directory" ]] || fail "Existing path preserved: $directory. Choose a new directory; this is not an upgrade command."
  for tool in docker curl openssl; do command -v "$tool" >/dev/null || fail "Install $tool first."; done
  docker compose version >/dev/null || fail 'Docker Compose v2 is required.'
  docker info >/dev/null 2>&1 || fail 'Start Docker and check your Docker access first.'

  umask 077
  mkdir -m 700 "$directory" || fail 'Could not create the installation directory.'
  trap 'printf "Setup stopped. Files and volumes are preserved. Inspect %s before retrying.\n" "$directory" >&2' ERR
  printf 'Installing Feedbacks 0.2.3 from Docker Hub…\n'
  curl --fail --silent --show-error --location \
    https://raw.githubusercontent.com/Softinator-TechLabs/feedbacks-oss/main/site/public/compose.quickstart.yaml \
    --output "$directory/compose.yaml.download"
  actual=$(openssl dgst -sha256 "$directory/compose.yaml.download")
  [[ ${actual##* } == "$checksum" ]] || fail 'Compose checksum did not match. No containers were started.'
  mv "$directory/compose.yaml.download" "$directory/compose.yaml"
  database_password=$(openssl rand -hex 32)
  owner_password=$(openssl rand -hex 24)
  random_id=$(openssl rand -hex 16)
  organization_id="${random_id:0:8}-${random_id:8:4}-4${random_id:13:3}-8${random_id:17:3}-${random_id:20:12}"
  project="feedbacks-${random_id:0:12}"
  origin="http://localhost:$port"
  {
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$project"
    printf 'FEEDBACKS_IMAGE=%s\n' "$image"
    printf 'FEEDBACKS_PORT=%s\nAPP_ORIGIN=%s\n' "$port" "$origin"
    printf 'POSTGRES_PASSWORD=%s\nORGANIZATION_ID=%s\n' "$database_password" "$organization_id"
  } > "$directory/.env"
  printf '%s' "$owner_password" > "$directory/owner-password"
  chmod 600 "$directory/.env" "$directory/owner-password"
  compose config --quiet
  compose pull --quiet
  compose up -d --wait
  printf '%s' "$owner_password" | compose exec -T -e BOOTSTRAP_EMAIL=owner@example.test \
    -e BOOTSTRAP_NAME=Owner app node dist/cli/bootstrap.js
  compose exec -T app node -e \
    "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  trap - ERR
  printf '\nFeedbacks is running.\nURL: %s\nEmail: owner@example.test\n' "$origin"
  if [[ -t 1 ]]; then printf 'Password: %s\n' "$owner_password"; fi
  printf 'Password saved privately: %s/owner-password\n' "$directory"
  printf 'Database and screenshots use persistent Docker volumes. No S3 account is needed.\n'
  printf 'To stop safely: cd %q && docker compose --project-name %q stop\n' "$directory" "$project"
  printf 'To resume: cd %q && docker compose --project-name %q up -d --wait\n' "$directory" "$project"
  printf 'For shared HTTPS hosting: https://feedbacks.softinator.ai/docs/guide/self-host#bring-the-server-online\n'
  unset owner_password database_password
}

# Run only after the complete downloaded script has been parsed.
main "$@"
