import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist/assets", { recursive: true, force: true });
await cp("dist/client/assets", "dist/assets", { recursive: true });
await rm("dist/public", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });
await cp("dist/client", "dist/public", { recursive: true });
