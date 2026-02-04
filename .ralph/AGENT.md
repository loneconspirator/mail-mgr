# Ralph Agent Configuration

## Build Instructions

```bash
npm run build
```

## Test Instructions

```bash
npm test
```

## Run Instructions

```bash
# Development (with watch)
npm run dev

# Production
npm start
```

## Notes
- Node.js 22+ required
- TypeScript strict mode, ES2022 target, NodeNext module resolution
- Tests use vitest (`npm test` for single run, `npm run test:watch` for watch mode)
- Runtime state stored under `DATA_PATH` env var (default `./data`)
