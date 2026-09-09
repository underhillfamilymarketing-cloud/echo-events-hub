type TelegramWebApp = {
  isFullscreen?: boolean;
  expand?: () => void;
  ready?: () => void;
  requestFullscreen?: () => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  setHeaderColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const TELEGRAM_SURFACE_COLOR = "#0d1024";

export function prepareTelegramMiniApp(): (() => void) | undefined {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;

  const maximize = () => {
    try {
      webApp.expand?.();
      webApp.setHeaderColor?.(TELEGRAM_SURFACE_COLOR);
      webApp.setBackgroundColor?.(TELEGRAM_SURFACE_COLOR);
      webApp.setBottomBarColor?.(TELEGRAM_SURFACE_COLOR);

      if (!webApp.isFullscreen) webApp.requestFullscreen?.();
    } catch {
      // Older Telegram clients still receive the expand() fallback.
    }
  };

  try {
    webApp.ready?.();
  } catch {
    // The calendar remains fully usable outside Telegram.
  }

  maximize();

  // Telegram may finish sizing the sheet just after the first API call.
  const retry = window.setTimeout(maximize, 240);
  return () => window.clearTimeout(retry);
}
