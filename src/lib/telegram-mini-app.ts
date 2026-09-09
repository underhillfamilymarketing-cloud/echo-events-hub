type TelegramSafeAreaInset = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

type TelegramSafeAreaEvent = "safeAreaChanged" | "contentSafeAreaChanged";

type TelegramWebApp = {
  contentSafeAreaInset?: TelegramSafeAreaInset;
  isFullscreen?: boolean;
  onEvent?: (eventType: TelegramSafeAreaEvent, callback: () => void) => void;
  offEvent?: (eventType: TelegramSafeAreaEvent, callback: () => void) => void;
  expand?: () => void;
  ready?: () => void;
  requestFullscreen?: () => void;
  safeAreaInset?: TelegramSafeAreaInset;
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

  const updateSafeArea = () => {
    const inset = webApp.contentSafeAreaInset ?? webApp.safeAreaInset;
    const root = document.documentElement;
    const setInset = (name: string, value: number | undefined) => {
      root.style.setProperty(name, `${Math.max(0, Number(value) || 0)}px`);
    };

    setInset("--echo-tg-content-safe-top", inset?.top);
    setInset("--echo-tg-content-safe-bottom", inset?.bottom);
    setInset("--echo-tg-content-safe-left", inset?.left);
    setInset("--echo-tg-content-safe-right", inset?.right);
  };

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
    updateSafeArea();
  };

  try {
    webApp.ready?.();
  } catch {
    // The calendar remains fully usable outside Telegram.
  }

  updateSafeArea();
  webApp.onEvent?.("safeAreaChanged", updateSafeArea);
  webApp.onEvent?.("contentSafeAreaChanged", updateSafeArea);
  maximize();

  // Telegram may finish sizing the sheet just after the first API call.
  const retry = window.setTimeout(() => {
    maximize();
    updateSafeArea();
  }, 240);
  return () => {
    window.clearTimeout(retry);
    webApp.offEvent?.("safeAreaChanged", updateSafeArea);
    webApp.offEvent?.("contentSafeAreaChanged", updateSafeArea);
  };
}
