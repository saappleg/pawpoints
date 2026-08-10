# Pet Care notification Worker

This free Cloudflare Worker sends OneSignal pushes without exposing the OneSignal App API key in GitHub Pages. It also stores manually scheduled client reminders in Cloudflare D1 and checks for due reminders every five minutes.

## One-time Cloudflare setup

1. Create a Cloudflare account and install Wrangler: `npm install -g wrangler`.
2. In this folder, copy `wrangler.toml.example` to `wrangler.toml` and replace the D1 database ID after step 3.
3. Create the database: `wrangler d1 create petcare-notifications`.
4. Apply the schema locally and remotely:
   - `wrangler d1 execute petcare-notifications --local --file=./schema.sql`
   - `wrangler d1 execute petcare-notifications --remote --file=./schema.sql`
5. Add secrets (never commit these):
   - `wrangler secret put ONESIGNAL_APP_API_KEY`
   - `wrangler secret put FIREBASE_WEB_API_KEY`
   - `wrangler secret put ADMIN_EMAILS`
     - Use a comma-separated list, such as `saappleg@gmail.com,support@petcarebysteven.me`.
6. Add the OneSignal app ID as a plain Worker variable in the Cloudflare dashboard, or use `wrangler secret put ONESIGNAL_APP_ID`.
7. Deploy: `wrangler deploy`.
8. Copy the Worker URL (for example `https://petcare-notifications.your-account.workers.dev`) into `window.PET_CARE_NOTIFICATIONS_URL` in the site root `index.html`.

## Security model

- The portal sends the current Firebase ID token with every request.
- The Worker uses Firebase's `accounts:lookup` endpoint to validate that token, then allows administrative sends only from addresses in `ADMIN_EMAILS`.
- A client can request a push only to their own OneSignal external ID after redeeming a reward; they cannot target another client.
- The OneSignal App API key exists only as a Cloudflare secret.

## Booking reminders

Walkies booking data is not available to this site, so reminders are deliberately manual: choose a client, type the message, and select a future date/time. The Worker sends it within five minutes of that time.
