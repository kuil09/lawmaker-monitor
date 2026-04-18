import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const sharedEnv = {
  ...process.env,
  VITE_DATA_REPO_BASE_URL: "http://127.0.0.1:4174"
};

function run(command, args, env = sharedEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`
        )
      );
    });
  });
}

await run(npmCommand, [
  "run",
  "build",
  "--workspace",
  "@lawmaker-monitor/schemas"
]);
await run(
  npmCommand,
  ["run", "build", "--workspace", "@lawmaker-monitor/web"],
  sharedEnv
);
await run(
  npxCommand,
  ["vitest", "run", "--config", "vitest.ui.config.ts"],
  sharedEnv
);
