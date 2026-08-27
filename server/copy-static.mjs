import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(root, "dist/agents"), { recursive: true });
copyFileSync(
  join(root, "src/agents/elite-hr-resume.md"),
  join(root, "dist/agents/elite-hr-resume.md")
);
