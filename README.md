# Yangu Market Stores

Yangu is an online marketplace for local sellers and buyers.

## Deploy on Render

This repository includes a Render Blueprint in `render.yaml`. In the Render Dashboard, create a **Blueprint Instance** for this repository and select the `jumaa54-rgb-yangu-deployment` branch to deploy the preview. Render will create the web service and PostgreSQL database together. On the first deployment of the administrator change, the two earliest accounts already in the database are reserved as administrators (or fewer if fewer accounts exist). New public signups are always sellers and can never claim an unfilled administrator slot. An empty database does not receive an administrator automatically, so provision the initial account(s) through a trusted, private process before relying on the admin panel. The reserved admin identities are stored separately from editable account data, and those accounts cannot be deleted through the admin panel.

The Blueprint uses Render's free plans. The web service may spin down when idle, and the free PostgreSQL database expires after 30 days; use paid plans for persistent production hosting. Render provides the `PORT` environment variable automatically. The `onrender.com` address appears in the web service dashboard after its first successful deploy. To use a custom domain, add it in the service settings and configure the DNS records shown there.

The sitemap is served at **https://yangu-market-stores.onrender.com/sitemap.xml** and is referenced by `/robots.txt`. A stylesheet makes the sitemap easier to read in a browser; the file remains standard XML for search engines. After deploying, open that URL to confirm it loads, then add and verify the site in [Google Search Console](https://search.google.com/search-console). In Search Console, submit `sitemap.xml` under **Sitemaps** and use **URL inspection** to request indexing for `https://yangu-market-stores.onrender.com/`. The sitemap currently lists the canonical homepage; product details use client-side hash routes, which are not separate sitemap URLs. Submitting a sitemap helps Google discover URLs but does not guarantee or immediately cause indexing.

Account signup does not send an email verification code. The signup form and API check email syntax, but do not confirm mailbox ownership; users should enter an address they control. When SMTP is configured, new accounts receive a welcome email thanking them for joining; account creation still succeeds if welcome-mail delivery fails. Configure `SMTP_HOST`, `SMTP_PORT` (usually `587`, or `465` for implicit TLS), `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` for welcome emails and recovery-email verification. Users must review and accept the current Terms and Conditions; the API records the accepted terms version and timestamp. The **Menu** groups services such as buyer and seller feedback, AI assistance, help, and sharing; only the reserved administrator accounts see **Admin panel**. **Help & support** provides the first administrator's email and phone.

After signing in, users can select their profile photo or initials beside their name to open the full profile. From there they can add a photo, update their display name and recovery phone, or change their recovery email after verifying a code sent to it. The sign-up email and primary phone are displayed as permanent account details and cannot be changed. Saving profile changes requires the current password. Existing accounts remain usable.

When creating or editing a product, sellers can enter a general area, town, street, or nearby landmark instead of sharing a precise pin. They can also optionally choose **Use my current location** to attach a one-time pin. Any location provided is visible to anyone viewing the listing; the browser asks for permission before capturing a pin, and Yangu does not track location in the background. Buyers can open a shared pin in Google Maps. Uploaded images are limited to JPEG, PNG, WebP, or GIF and checked against their file signatures; SVG and other active content are not served.

Buyers can choose **Find goods near me** and select a 10, 25, 50, or 100 km radius. Yangu requests the buyer's location only after they tap the button, calculates distances in their browser, and keeps that location in page memory only. Nearby matching requires a seller's map pin; text-only locations cannot be measured by distance.

Buyers can add multiple listings to the trolley and return to them later on the same device. The trolley icon shows the number of goods saved. It stores listing IDs in the browser, shows an estimated total, and offers a separate seller contact link for each good. It does not reserve stock, place an order, or process payment; buyers arrange purchases directly with sellers.

The AI assistant offers buyer recommendations from current marketplace listings and seller advice for product descriptions, pricing considerations, listing quality, and customer communication. Seller assistance requires login. Configure `ANTHROPIC_API_KEY` in the Render environment to enable AI requests; `ANTHROPIC_MODEL` defaults to `claude-haiku-5-5` and can be changed to a model available to your Anthropic account. AI requests may incur charges on that account. The key stays server-side and must never be added to browser code.

Administrators can manage advertisements in **Menu → Admin panel → Ads**. Only ads an administrator approves and publishes appear on the marketplace; administrators can pause, edit, or delete them. Ads may include a hosted HTTPS MP4/WebM video URL or an uploaded MP4/WebM video (up to 20 MB). Uploaded ad videos are served only while their ad is approved and published.
Visitors see one randomly selected active video ad (or another active ad if no video is available) in a dismissible popup when opening the site, then another every 10 minutes while visiting, rather than a page full of ads. Video ads start muted to support browser autoplay; viewers can turn on sound with the player controls.

Email addresses are normalized and unique across accounts. Passwords are hashed per account and may be reused by different users. Every administrator must sign in with a six-digit time-based code from an authenticator app after entering their password; the first admin login guides the administrator through authenticator setup. Codes expire quickly and are single-use. Another administrator can reset a locked-out administrator's authenticator from the Admin panel; the account must enroll a new authenticator on its next login. Administrator password resets are restricted to another administrator, generate a high-entropy temporary password, and invalidate existing sessions and pending admin login challenges for the reset account. The application also sends `nosniff`, frame, referrer, geolocation, and production HTTPS security headers.

## Run locally

Requires Node.js 20+ and PostgreSQL. Set `DATABASE_URL` and `JWT_SECRET` in your environment, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. Images are stored in PostgreSQL. Set `ANTHROPIC_API_KEY` to enable the AI assistant.
