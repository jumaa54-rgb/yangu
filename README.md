# Yangu Market Stores

Yangu is an online marketplace for local sellers and buyers.

## Deploy on Render

This repository includes a Render Blueprint in `render.yaml`. In the Render Dashboard, create a **Blueprint Instance** for this repository and select the `jumaa54-rgb-yangu-deployment` branch to deploy the preview. Render will create the web service and PostgreSQL database together. During setup, enter the comma-separated `ADMIN_EMAILS` addresses that should receive administrator access; Render generates `JWT_SECRET` automatically.

The Blueprint uses Render's free plans. The web service may spin down when idle, and the free PostgreSQL database expires after 30 days; use paid plans for persistent production hosting. Render provides the `PORT` environment variable automatically. The `onrender.com` address appears in the web service dashboard after its first successful deploy. To use a custom domain, add it in the service settings and configure the DNS records shown there.

Email verification requires SMTP credentials. Configure `SMTP_HOST`, `SMTP_PORT` (usually `587`, or `465` for implicit TLS), `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in the Render service environment before enabling signups. Signup emails contain a six-digit code for a single-field, autofill-friendly entry or a verification link that confirms the address and returns the user to finish signup. Codes and links expire after 10 minutes; codes are single-use and limited to five guesses. Render's `RENDER_EXTERNAL_URL` is used for email links; for local development, set `PUBLIC_URL` to the local app origin. The **Help** button beside **Ask AI** shows the first administrator's email and phone for signup and verification issues.

After signing in, users can open **Profile** to add a photo, update their display name and recovery phone, or change their recovery email after verifying a code sent to it. The sign-up email and primary phone are displayed as permanent account details and cannot be changed. Saving profile changes requires the current password.

Email addresses are normalized and unique across accounts. Passwords are hashed per account and may be reused by different users.

## Run locally

Requires Node.js 20+ and PostgreSQL. Set `DATABASE_URL` and `JWT_SECRET` in your environment, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. Images are stored in PostgreSQL. AI features remain unavailable unless an Anthropic API key is configured server-side.
