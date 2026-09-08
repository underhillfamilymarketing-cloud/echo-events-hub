export type RuntimeEnv = Record<string, unknown>;

export function runtimeValue(env: RuntimeEnv | undefined, key: string): string | undefined {
  const runtimeValue = env?.[key];
  if (typeof runtimeValue === "string" && runtimeValue.trim()) return runtimeValue.trim();

  const localValue = typeof process === "undefined" ? undefined : process.env[key];
  return localValue?.trim() || undefined;
}
