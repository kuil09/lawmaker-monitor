import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function checkoutMinutesWorker(directory, plan, workerId) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8"
  }).trim();
  if (head !== plan.sourceCommit)
    throw new Error("Worker checkout is not the pinned commit.");
  const worker = plan.workers.find((entry) => entry.id === workerId);
  if (
    !worker ||
    worker.documents.length > 20 ||
    new Set(worker.documents.map((doc) => doc.documentId)).size !==
      worker.documents.length
  )
    throw new Error("Invalid worker document assignment.");
  const index = JSON.parse(
    await readFile(join(directory, "raw/index/document_index.json"), "utf8")
  );
  const paths = worker.documents.map((document) => {
    const item = index.items.find(
      (entry) => entry.documentId === document.documentId
    );
    const path = item?.transcriptRelativePath;
    if (
      item?.transcriptContentSha256 !== document.sourceHash ||
      typeof path !== "string" ||
      !path.startsWith("raw/") ||
      !path.endsWith(".transcript.json") ||
      path.split("/").includes("..") ||
      /[\r\n]/.test(path)
    )
      throw new Error(
        "Worker transcript assignment does not match the pinned index."
      );
    return `/${path.replace(/[\\*?[\]]/g, "\\$&")}`;
  });
  execFileSync("git", ["sparse-checkout", "add", "--stdin"], {
    cwd: directory,
    input: `${paths.join("\n")}\n`,
    stdio: ["pipe", "inherit", "inherit"]
  });
  return paths;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [directory, planPath, workerId] = process.argv.slice(2);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const paths = await checkoutMinutesWorker(directory, plan, Number(workerId));
  process.stdout.write(
    `Materialized ${paths.length} assigned transcript paths.\n`
  );
}
