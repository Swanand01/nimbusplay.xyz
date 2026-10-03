# NimbusPlay

NimbusPlay is an experimental cloud-gaming platform built around Apollo and Artemis. It provides a web interface for starting a personal gaming machine, pairing a client, and stopping the session when finished.

## What it includes

- A TypeScript and Fastify backend for authentication and session management
- A React web application in `web/`
- Apollo/Artemis pairing using a link or PIN
- AWS infrastructure definitions in `infra/terraform/`
- Separate persistent storage for each player's games

## Local development

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

The API runs on `http://localhost:8080`.

To run the frontend separately:

```bash
cd web
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API requests to the backend.

## Useful commands

```bash
npm run build       # compile the backend
npm run typecheck   # check TypeScript
cd web && npm test  # run frontend tests
cd web && npm run build
```

## Status

NimbusPlay is an archived prototype. Its AWS infrastructure has been removed, but the application and infrastructure code are preserved for reference.
