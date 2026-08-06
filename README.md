# Devarsh's Maths, revived

This is a website that contains resources about maths. It uses Bun and SvelteKit. You can try it [here](https://dvmaths.qincai.xyz).

## How to develop

You need to have Bun installed on your computer. You can get Bun [here](https://bun.sh).

Then, run `bun install` to install dependencies, and `bun --bun run dev` to start the Vite development server.

Alternatively, you could use the `Dockerfile`/`docker-compose.yml`:

```bash
docker-compose up --build
```

## Docker images

Every push to the repository triggers the `.github/workflows/docker-publish.yml`
workflow, which builds the image and publishes it to GHCR:

```nolang
ghcr.io/qincai-rui/maths:{branch}-{sha}
```

On the default branch (`main`) it also publishes `latest` and `{branch}` tags.

To run a published image:

```bash
docker run -p 5185:5185 ghcr.io/qincai-rui/maths:latest
```
