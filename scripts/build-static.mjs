import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const site = path.join(root, "site");

export async function buildWorkerAssets(destination) {
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, "src", "workers", "recipe.worker.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: ["es2022"],
    minify: true,
    legalComments: "inline",
    plugins: [{
      name: "same-origin-highs-worker",
      setup(builder) {
        builder.onResolve({ filter: /^highs$/ }, () => ({
          path: path.join(root, "src", "workers", "highs-browser.ts"),
        }));
      },
    }],
  });
  const highsDirectory = path.dirname(require.resolve("highs"));
  const worker = bundled.outputFiles[0].contents;
  const highs = await readFile(path.join(highsDirectory, "highs.js"));
  const wasm = await readFile(path.join(highsDirectory, "highs.wasm"));
  const version = createHash("sha256").update(worker).update(highs).update(wasm).digest("hex").slice(0, 20);
  const relativeDirectory = path.join("engine", version);
  const directory = path.join(destination, relativeDirectory);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "recipe.worker.js"), worker),
    writeFile(path.join(directory, "highs.js"), highs),
    writeFile(path.join(directory, "highs.wasm"), wasm),
    cp(path.join(highsDirectory, "..", "LICENSE"), path.join(directory, "highs.LICENSE.txt")),
  ]);
  return {
    workerPath: `/engine/${version}/recipe.worker.js`,
    sizes: { worker: worker.byteLength, highs: highs.byteLength, wasm: wasm.byteLength },
  };
}

async function main() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/fit-chef";
  if (basePath && !/^(?:\/[A-Za-z0-9_-]+)+$/.test(basePath)) {
    throw new Error("Invalid NEXT_PUBLIC_BASE_PATH: use /fit-chef or an empty string, without a trailing slash.");
  }
  const publicDirectory = path.join(site, "public");
  await rm(publicDirectory, { recursive: true, force: true });
  await cp(path.join(root, "public"), publicDirectory, { recursive: true });
  const assets = await buildWorkerAssets(publicDirectory);
  const manifest = { basePath, workerPath: assets.workerPath, sizes: assets.sizes };
  await writeFile(path.join(publicDirectory, "engine-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(publicDirectory, ".nojekyll"), "");
  const result = spawnSync(process.execPath, [
    require.resolve("next/dist/bin/next"), "build", site, "--webpack",
  ], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_FIT_STATIC: "true",
      NEXT_PUBLIC_BASE_PATH: basePath,
      NEXT_PUBLIC_RECIPE_WORKER_PATH: assets.workerPath,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Static export failed (exit ${result.status ?? result.signal}).`);
  await readFile(path.join(site, "out", "index.html"));
  await readFile(path.join(site, "out", assets.workerPath.replaceAll("/", path.sep)));
  console.log(`Static export: ${path.join(site, "out")}`);
  console.log(`Same-origin worker assets (bytes): ${JSON.stringify(assets.sizes)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
