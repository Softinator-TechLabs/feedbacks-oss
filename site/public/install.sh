#!/usr/bin/env bash
# Fresh, loopback-only quickstart using the verified Docker Hub release.
set +x
set -euo pipefail

fail() { printf 'Feedbacks: %s\n' "$*" >&2; exit 1; }

progress() { printf '\n[%s/7] %s\n' "$1" "$2"; }

download() {
  curl --fail --silent --show-error --location --connect-timeout 10 --max-time 90 \
    --retry 2 --retry-delay 1 --proto '=https' --proto-redir '=https' "$@"
}

read_release() {
  local key value
  version= image= checksum= revision=
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    case "$key" in
      version) [[ -z "$version" ]] || fail 'Duplicate release version.'; version=$value ;;
      image) [[ -z "$image" ]] || fail 'Duplicate release image.'; image=$value ;;
      compose_sha256) [[ -z "$checksum" ]] || fail 'Duplicate Compose checksum.'; checksum=$value ;;
      compose_revision) [[ -z "$revision" ]] || fail 'Duplicate Compose revision.'; revision=$value ;;
      *) fail 'Invalid stable release metadata. No containers were started.' ;;
    esac
  done < "$directory/release.txt"
  [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail 'Invalid stable version.'
  [[ "$image" =~ ^softinator/feedbacks@sha256:[a-f0-9]{64}$ ]] || fail 'Invalid release image.'
  [[ "$checksum" =~ ^[a-f0-9]{64}$ && "$revision" =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid Compose release pin.'
}

management_commands() {
  printf 'Stop:   cd %q && docker compose --project-name %q stop\n' "$directory" "$project"
  printf 'Start:  cd %q && docker compose --project-name %q up -d --wait\n' "$directory" "$project"
  printf 'Status: cd %q && docker compose --project-name %q ps\n' "$directory" "$project"
  printf 'Logs:   cd %q && docker compose --project-name %q logs -f --tail=50\n' "$directory" "$project"
}

setup_stopped() {
  printf '\nSetup stopped. Files and volumes are preserved in %s.\n' "$directory" >&2
  if [[ -n "${project:-}" && -f "$directory/.env" ]]; then management_commands >&2; fi
}

compose() {
  env -u FEEDBACKS_IMAGE -u APP_ORIGIN -u POSTGRES_PASSWORD -u ORGANIZATION_ID \
    -u FEEDBACKS_PORT -u COMPOSE_PROJECT_NAME \
    docker compose --project-name "$project" --project-directory "$directory" \
      --env-file "$directory/.env" -f "$directory/compose.yaml" "$@"
}

main() {
  local directory="$PWD/feedbacks-server" port=3000 project= image checksum actual version revision
  local database_password owner_password random_id organization_id origin
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
  progress 1 'Checking Docker and the requested local port…'
  if (: < /dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
    fail "Port $port is already in use. Nothing was installed. Retry with --port 3300 --directory feedbacks-3300 (or choose another free port)."
  fi
  docker compose version >/dev/null || fail 'Docker Compose v2 is required.'
  docker info >/dev/null 2>&1 || fail 'Start Docker and check your Docker access first.'

  umask 077
  mkdir -m 700 "$directory" || fail 'Could not create the installation directory.'
  trap setup_stopped EXIT
  progress 2 'Finding the latest verified stable release…'
  download --max-filesize 4096 https://feedbacks.softinator.ai/quickstart-stable.txt --output "$directory/release.txt"
  read_release
  printf 'Selected Feedbacks %s (verified image digest).\n' "$version"
  progress 3 'Downloading and verifying the Compose configuration…'
  download "https://raw.githubusercontent.com/Softinator-TechLabs/feedbacks-oss/$revision/site/public/compose.quickstart.yaml" \
    --output "$directory/compose.yaml.download"

  actual=$(openssl dgst -sha256 "$directory/compose.yaml.download")
  [[ ${actual##* } == "$checksum" ]] || fail 'Compose checksum did not match. No containers were started.'
  mv "$directory/compose.yaml.download" "$directory/compose.yaml"
  progress 4 'Creating private login and persistent-volume configuration…'
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
  progress 5 'Pulling images from Docker Hub (the first download can take several minutes)…'
  compose pull
  progress 6 'Starting PostgreSQL and Feedbacks; waiting for health checks…'
  compose up -d --wait --wait-timeout 180
  progress 7 'Creating the owner account and checking readiness…'
  printf '%s' "$owner_password" | compose exec -T -e BOOTSTRAP_EMAIL=owner@example.test \
    -e BOOTSTRAP_NAME=Owner app node dist/cli/bootstrap.js
  compose exec -T app node -e \
    "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  trap - EXIT
  printf '\nFeedbacks is running.\nURL: %s\nEmail: owner@example.test\n' "$origin"
  if [[ -t 1 ]]; then printf 'Password: %s\n' "$owner_password"; fi
  printf 'Password saved privately: %s/owner-password\n' "$directory"
  printf 'Database and screenshots use persistent Docker volumes. No S3 account is needed.\n'
  management_commands
  printf 'For shared HTTPS hosting: https://feedbacks.softinator.ai/docs/guide/self-host#bring-the-server-online\n'
  unset owner_password database_password
}

# Run only after the complete downloaded script has been parsed.
main "$@"
