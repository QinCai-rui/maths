#!/usr/bin/env bash
set -euo pipefail

image="${1:?Pass the locally built image tag}"
name="maths-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
mkdir -p test-results

cleanup() {
  docker logs "$name" > test-results/container.log 2>&1 || true
  docker rm --force --volumes "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The anonymous volume belongs only to this disposable CI container.
docker run --detach --name "$name" --publish 127.0.0.1::5185 \
  --mount type=volume,destination=/data \
  --env ORIGIN=http://127.0.0.1:5185 "$image"
address="$(docker port "$name" 5185/tcp)"
base="http://${address}"
for attempt in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$name")"
  if [ "$status" = healthy ]; then break; fi
  if [ "$status" = unhealthy ]; then
    echo 'Container healthcheck failed' >&2
    exit 1
  fi
  sleep 2
done
test "$(docker inspect --format '{{.State.Health.Status}}' "$name")" = healthy
for route in / /tools /mathex/app /mathex/app/create; do
  curl --fail --silent --show-error "${base}${route}" >/dev/null
done
# Exercise the actual Socket.IO endpoint, not just SvelteKit's HTTP handler.
curl --fail --silent --show-error "${base}/socket.io/?EIO=4&transport=polling" | grep --quiet '"sid"'
docker restart "$name" >/dev/null
for attempt in $(seq 1 30); do
  if curl --fail --silent "${base}/" >/dev/null; then exit 0; fi
  sleep 2
done
echo 'Container did not recover after restart' >&2
exit 1
