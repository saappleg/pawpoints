# PawPoints Loyalty Program for Pet Care by Steven

Static GitHub Pages site for Pet Care by Steven, including PawPoints rewards,
client tools, community trails, and the OneSignal notification studio.

## Development

Install dependencies and build the versioned production assets:

```sh
npm install
npm run build
```

Application source lives in `src/app.js`. The build generates the minified
JavaScript and Tailwind CSS files in `assets/`; commit those generated files so
GitHub Pages can serve them directly.
