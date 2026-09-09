# ECHO Events Hub

Standalone ECHO Marketing events calendar.

## What It Does

- Shows a shared calendar of ECHO events.
- Stores events in the Site-managed D1 database.
- Mirrors every create, update, and delete through the configured Google Sheets sync webhook.
- Lets approved editors add events from the protected website or Telegram bot.

## Development

```sh
pnpm install
pnpm run dev
```

## Deployment

The production build is deployed with Sites. The deployment archive flattens built public assets to the deployment root so `/assets/*` URLs resolve in production.

Required runtime variables:

- `EVENTS_EDIT_PASSWORD`
- `EVENTS_SESSION_SECRET`

Optional runtime variables:

- `EVENTS_SHEETS_WEBHOOK_URL`
- `EVENTS_SHEETS_WEBHOOK_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_BOOTSTRAP_CHAT_ID`
