# Pet Care notification Worker

This free Cloudflare Worker sends OneSignal pushes without exposing the OneSignal App API key in GitHub Pages. It also stores manually scheduled client reminders in Cloudflare D1 and checks for due reminders every five minutes.

## One-time Cloudflare setup

1. Create a Cloudflare account and authenticate Wrangler with `npx wrangler login`.
2. Create the database if it does not already exist: `npx wrangler d1 create petcare-notifications`.
3. Confirm the returned database ID matches the active binding in `wrangler.jsonc`.
4. Apply the schema locally and remotely:
   - `npx wrangler d1 execute petcare-notifications --local --file=./schema.sql`
   - `npx wrangler d1 execute petcare-notifications --remote --file=./schema.sql`
5. Add secrets (never commit these):
   - `npx wrangler secret put ONESIGNAL_APP_API_KEY`
   - `npx wrangler secret put ADMIN_EMAILS`
     - Use a comma-separated list, such as `saappleg@gmail.com,support@petcarebysteven.me`.
6. Add the OneSignal app ID as a plain Worker variable in the Cloudflare dashboard, or use `npx wrangler secret put ONESIGNAL_APP_ID`.
7. Deploy: `npx wrangler deploy`.
8. Copy the Worker URL (for example `https://petcare-notifications.your-account.workers.dev`) into `window.PET_CARE_NOTIFICATIONS_URL` in the site root `index.html`.

Once connected, eligible point changes, referral-driven status upgrades, and the annual status rollover automatically send a OneSignal push to that specific client. Push delivery while the PWA is closed still requires that client to have opted in to notifications on their device.

## PawPoints Notification Studio

The website admin panel includes a rich notification composer backed by `POST /v1/notifications/send`. In addition to a title and message, an admin can configure:

- a large HTTPS image and notification icon;
- up to two Chrome web-push action buttons;
- a destination URL and custom JSON data;
- normal or high priority, expiration time, and a collapse/replacement key;
- immediate delivery or a future OneSignal `send_after` time;
- all subscribed users or one client identified by Firebase/OneSignal external ID.

Broadcasts target the OneSignal segment named `Total Subscriptions` by default. If that segment is renamed, set the Worker variable `ONESIGNAL_BROADCAST_SEGMENT` to the new segment name.

Admins can also save, load, update, and delete reusable notification designs. These templates are stored in the `notification_templates` D1 table, remain available across devices, and never store a selected recipient or scheduled send time.

OneSignal and the receiving browser decide which rich fields are displayed. Chrome supports web action buttons and large images; Firefox and Safari expose fewer visual controls. The API validates every advanced field before forwarding it, and the OneSignal API key remains server-side.

## Security model

- The portal sends the current Firebase ID token with every request.
- The Worker verifies the Firebase ID token signature against Firebase's rotating public keys, then allows administrative sends only from addresses in `ADMIN_EMAILS`. No Firebase API key is needed by the Worker.
- A client can request a push only to their own OneSignal external ID after redeeming a reward; they cannot target another client.
- The OneSignal App API key exists only as a Cloudflare secret.

## Booking reminders

Walkies booking data is not available to this site, so reminders are deliberately manual: choose a client, type the message, and select a future date/time. The Worker sends it within five minutes of that time.
