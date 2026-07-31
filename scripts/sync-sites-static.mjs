import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist/public", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });
await cp("dist/client", "dist/public", { recursive: true });
