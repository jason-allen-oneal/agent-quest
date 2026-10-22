import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// Resolve the merger from Prisma's own dependency context, not a direct test-only install.
const projectRequire = createRequire(import.meta.url);
const prismaRequire = createRequire(projectRequire.resolve("@prisma/config"));
const { deepmerge } = await import(pathToFileURL(prismaRequire.resolve("deepmerge-ts")).href);
const { loadConfigFromFile } = await import("@prisma/config");

test("Prisma's patched merger preserves nested config records without mutating inputs", () => {
  const defaults = { migrations: { path: "prisma/migrations" }, datasource: { url: "mysql://127.0.0.1:9/fixture" } };
  const configured = { migrations: { seed: "node seed.mjs" }, schema: "prisma/schema.prisma" };
  const merged = deepmerge(defaults, configured);
  assert.deepEqual(merged, {
    migrations: { path: "prisma/migrations", seed: "node seed.mjs" },
    datasource: { url: "mysql://127.0.0.1:9/fixture" },
    schema: "prisma/schema.prisma",
  });
  assert.deepEqual(defaults.migrations, { path: "prisma/migrations" });
  assert.deepEqual(configured.migrations, { seed: "node seed.mjs" });
});

test("Prisma's merger handles recursive record pairs without stack exhaustion", () => {
  const left = { fromLeft: true };
  const right = { fromRight: true };
  left.self = left;
  right.self = right;
  const merged = deepmerge(left, right);
  assert.equal(merged.fromLeft, true);
  assert.equal(merged.fromRight, true);
  assert.equal(merged.self, merged);
});

test("Prisma loads a real config through the patched merger without a database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prisma-security-config-"));
  try {
    await writeFile(join(directory, "prisma.config.cjs"), `module.exports = {
      engine: "classic",
      schema: "prisma/schema.prisma",
      migrations: { path: "prisma/migrations" },
      datasource: { url: "mysql://127.0.0.1:9/fixture" }
    };`);
    const result = await loadConfigFromFile({ configRoot: directory });
    assert.ok(!result.error, result.error?._tag);
    assert.equal(result.config.schema, join(directory, "prisma/schema.prisma"));
    assert.equal(result.config.migrations.path, join(directory, "prisma/migrations"));
    assert.equal(result.config.datasource.url, "mysql://127.0.0.1:9/fixture");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
