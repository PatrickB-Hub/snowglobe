# Snowglobe

An interactive snow globe built with Three.js. Drag the globe to shake it, and petals or confetti swirl in a
simplified water current, then settle again.

```sh
npm install
npm run dev      # local dev server; add ?debug for the tuning panel
npm test         # snow physics tests
npm run build    # typecheck + production build
npm run format   # Prettier
```

Open a world directly with `?world=hochzeit` or `?world=festival`.

- `src/main.ts`: scene, worlds, interaction and UI
- `src/globe.ts`: glass, pedestal and contact shadow
- `src/snow.ts`: particle physics (no Three.js dependency, tested in `snow.test.ts`)
- Asset credits: [public/ASSET-CREDITS.md](public/ASSET-CREDITS.md)
