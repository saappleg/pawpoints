# Pet Care by Steven / PawPoints

Production repository for [petcarebysteven.me](https://petcarebysteven.me), a
static pet-care website and installable PWA with client accounts, PawPoints
rewards, service-area tools, community trails, and rich OneSignal push
notifications.

## Architecture

- **Hosting:** GitHub Pages from the `main` branch
- **DNS/CDN:** Cloudflare free plan
- **Client data:** Firebase Authentication and Cloud Firestore
- **Abuse protection:** Firebase App Check with reCAPTCHA Enterprise
- **Push delivery:** OneSignal Web Push
- **Notification API:** Cloudflare Worker with D1 storage
- **Styling/build:** Tailwind CSS and esbuild

The website has no application server. Secrets used to send notifications stay
inside Cloudflare Worker secrets and are never included in the browser bundle.

## Repository layout

```text
index.html                    Main website and client/admin interface
src/app.js                    Application source
assets/                       Versioned, generated production CSS and JS
input.css                     Tailwind input
sw.js                         Offline PWA service worker
push/onesignal/               OneSignal service workers and scope
manifest.json                 PWA metadata, icons, screenshots, shortcuts
firestore.rules               Firestore authorization rules
notifications-worker/         Cloudflare Worker, D1 schema, and migrations
.github/workflows/            Monthly Lighthouse quality report
```

SEO, legal, and fallback pages (`404.html`, `offline.html`, `privacy.html`,
`terms.html`, and `cincinnati-dog-walking.html`) are deployed as static pages.

## Local development

Requirements: Node.js 20 or newer and npm.

```sh
npm install
npm run build
python3 -m http.server 4173
```

Open `http://localhost:4173`. OneSignal will report an origin warning locally
because the production OneSignal app is restricted to `petcarebysteven.me`.
That warning is expected.

Available build commands:

```sh
npm run build       # Build minified CSS and JavaScript
npm run build:css   # Build and fingerprint Tailwind only
npm run build:js    # Bundle and fingerprint the modular Firebase app only
```

Generated files in `assets/` must be committed because GitHub Pages serves the
repository directly. When a generated filename changes, update its references
in the HTML, `package.json`, and `sw.js`, and rotate `CACHE_NAME` in `sw.js` so
installed PWAs fetch the new version.

## Firebase administration

The Firebase project is selected by `.firebaserc`. Deploy the checked-in rules
with:

```sh
firebase deploy --only firestore:rules
```

Administrator access is controlled by an `admins/<firebase-user-uid>` Firestore
document containing `{ "enabled": true }`. Do not place admin status in a user
profile or authorize administrators by a hard-coded email address.

Referral submissions are written as pending claims. Review them in the Admin
Workspace before awarding points. Firestore rules prevent browser clients from
directly increasing their own loyalty balance.

## Notification Worker

The active Worker configuration is
`notifications-worker/wrangler.jsonc`. From that directory:

```sh
npx wrangler d1 execute petcare-notifications --local --file=./schema.sql
npx wrangler d1 execute petcare-notifications --remote --file=./schema.sql
npx wrangler deploy
```

Required Worker secrets:

```text
ONESIGNAL_APP_API_KEY
ADMIN_EMAILS
```

`ONESIGNAL_APP_ID` may be a Worker variable or secret. The Worker URL is set in
`index.html` as `window.PET_CARE_NOTIFICATIONS_URL`. See
`notifications-worker/README.md` for API capabilities, D1 templates, reminders,
and the security model.

## Deployment and operations

Push tested changes to `main`; GitHub Pages builds and publishes automatically.
The monthly Lighthouse workflow can also be run manually under GitHub Actions.

Cloudflare proxies only the website records. Zoho MX/SPF/DKIM and Firebase DKIM
records must remain DNS-only. Rocket Loader must remain disabled because the
application relies on the current OneSignal → app bundle → Alpine script order.

Before publishing a significant change:

1. Run `npm run build` and check for build errors. The build fingerprints CSS and JavaScript filenames and updates `index.html` and `sw.js` automatically.
2. Test home, PawPoints, trails, sign-in, admin, and notification flows.
3. Verify `sw.js` contains the current generated asset names.
4. Confirm the GitHub Pages deployment succeeds.
5. Open the production domain and check the browser console.

## Security notes

- Firebase client configuration is intentionally public; authorization belongs
  in Firestore rules and App Check.
- Never commit OneSignal API keys, Cloudflare secrets, Firebase service-account
  keys, passwords, or `.env` files.
- Keep OneSignal workers under `/push/onesignal/` so they do not conflict with
  the root offline service worker.
- Rich notification recipients are authorized using Firebase ID tokens, and
  administrative sends are restricted by the Worker.
