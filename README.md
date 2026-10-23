# Raymont's Maths

This is a website that contains resources about maths. It uses Bun and SvelteKit. You can try it at [https://maths.qincai.xyz](https://maths.qincai.xyz) or [https://maths.raymont.dev](https://maths.raymont.dev).

## How to develop

You need to have Bun installed on your computer. You can [get Bun here](https://bun.sh).

Then, run `bun install` to install dependencies, and `bun --bun run dev` to start the Vite development server.

Alternatively, you could use the `Dockerfile`/`docker-compose.yml`:

```bash
docker-compose up --build
```

## Docker images

Pushes to `main` and manual runs of `.github/workflows/docker-publish.yml`
publish images to GHCR after all required verification jobs pass:

```nolang
ghcr.io/qincai-rui/maths:{branch}-{sha}
```

On the default branch (`main`) it also publishes `latest` and `{branch}` tags.

To run a published image:

```bash
docker run -p 5185:5185 ghcr.io/qincai-rui/maths:latest
```

## CI

PR checks cover formatting, types, tests, production builds, browser journeys,
accessibility and colour contrast, dependency vulnerabilities, secrets, and
container startup. Daily runs also exercise Firefox and WebKit.

The workflow exposes `CI required` for branch protection. Repository rules must
require that check to prevent merging a failing PR. No repository settings change
automatically.

See the [CI reference](docs/ci.md) for coverage and limits, and the
[manual accessibility checklist](docs/accessibility-review.md) for checks that
automation cannot decide.
