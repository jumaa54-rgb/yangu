# Yangu Market Stores

Yangu is an online marketplace for local sellers and buyers.

## Deploy on Render

This repository includes a Render Blueprint in `render.yaml`. In the Render Dashboard, create a **Blueprint Instance** for this repository and select the `jumaa54-rgb-yangu-deployment` branch to deploy the preview. Render will create the web service and PostgreSQL database together. During setup, enter the comma-separated `ADMIN_EMAILS` addresses that should receive administrator access; Render generates `JWT_SECRET` automatically.

The Blueprint uses Render's free plans. The web service may spin down when idle, and the free PostgreSQL database expires after 30 days; use paid plans for persistent production hosting. Render provides the `PORT` environment variable automatically. The `onrender.com` address appears in the web service dashboard after its first successful deploy. To use a custom domain, add it in the service settings and configure the DNS records shown there.

Email verification requires SMTP credentials. Configure `SMTP_HOST`, `SMTP_PORT` (usually `587`, or `465` for implicit TLS), `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in the Render service environment before enabling signups. The app emails a six-digit code that expires after 10 minutes; codes are single-use and limited to five guesses. SMTP settings can also be added to the environment for local development.

Email addresses are normalized and unique across accounts. Passwords are hashed per account and may be reused by different users.

## Run locally

Requires Node.js 20+ and PostgreSQL. Set `DATABASE_URL` and `JWT_SECRET` in your environment, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. Images are stored in PostgreSQL. AI features remain unavailable unless an Anthropic API key is configured server-side.
