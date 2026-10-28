# Yangu Market Stores

Yangu is an online marketplace for local sellers and buyers.

## Deploy on Render

1. Create a Render PostgreSQL database and copy its **Internal Database URL**.
2. Create a Render Web Service from this repository. Set the build command to `npm install` and the start command to `npm start`.
3. Configure these environment variables:
   - `DATABASE_URL`: the PostgreSQL Internal Database URL.
   - `JWT_SECRET`: a long, randomly generated secret.
   - `NODE_ENV`: `production`.
   - `ADMIN_COUNT`: `5` (optional; this is the default).
4. Before sharing the site publicly, create the first five accounts. Those accounts receive administrator access; subsequent accounts are sellers or buyers.

Render provides the `PORT` environment variable automatically. To use a custom domain, add it in the Render service settings and configure the DNS records shown there.

## Run locally

Requires Node.js 20+ and PostgreSQL. Set `DATABASE_URL` and `JWT_SECRET` in your environment, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. Images are stored in PostgreSQL. AI features remain unavailable unless an Anthropic API key is configured server-side.
