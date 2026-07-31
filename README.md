# ECHO Events Hub

Standalone ECHO Marketing events calendar.

## What It Does

- Shows a shared calendar of ECHO events.
- Stores events in Supabase.
- Mirrors event changes to a Google Sheets sync webhook when configured.

## Development

```sh
pnpm install
pnpm run dev
```

## Deployment

The production build is deployed with Sites. The deployment archive flattens built public assets to the deployment root so `/assets/*` URLs resolve in production.

Required runtime variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Optional runtime variables:

- `EVENTS_SHEETS_WEBHOOK_URL`
- `EVENTS_SHEETS_WEBHOOK_TOKEN`
