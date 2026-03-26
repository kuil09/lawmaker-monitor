import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, resolve } from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export const appPort = 4173;
export const dataPort = 4174;
export const appUrl = `http://127.0.0.1:${appPort}`;
export const dataUrl = `http://127.0.0.1:${dataPort}`;

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const appDistDir = resolve(repoRoot, "apps/web/dist");
const fixturesRoot = resolve(repoRoot, "tests/fixtures/contracts");
const screenshotRoot = resolve(repoRoot, ".artifacts/ui");
const placeholderAvatarSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">',
  '<rect width="192" height="192" rx="24" fill="#e7dcc8"/>',
  '<circle cx="96" cy="72" r="34" fill="#8f7158"/>',
  '<path d="M42 164c8-30 31-46 54-46s46 16 54 46" fill="#8f7158"/>',
  "</svg>"
].join("");

export type ViewportCase = {
  name: string;
  width: number;
  height: number;
  isMobile?: boolean;
  hasTouch?: boolean;
};

export const viewportCases: ViewportCase[] = [
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1440, height: 900 }
];

type BrowserSession = {
  context: BrowserContext;
  page: Page;
  issues: string[];
};

const fixtureOverrides = new Map<string, string>([
  ["/manifests/latest.json", resolve(fixturesRoot, "manifest.json")]
]);

function getContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".woff2") {
    return "font/woff2";
  }

  return "application/octet-stream";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function serveFile(response: ServerResponse, filePath: string): Promise<void> {
  const body = await readFile(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", getContentType(filePath));
  response.end(body);
}

function createListener(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      await handler(request, response);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(`Unexpected test server error: ${(error as Error).message}`);
    }
  };
}

function startServer(
  port: number,
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<Server> {
  const server = createServer(createListener(handler));

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveServer(server);
    });
  });
}

async function handleAppRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", appUrl);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const filePath =
    pathname === "/"
      ? resolve(appDistDir, "index.html")
      : resolve(appDistDir, pathname.slice(1));

  if (await fileExists(filePath)) {
    await serveFile(response, filePath);
    return;
  }

  await serveFile(response, resolve(appDistDir, "index.html"));
}

async function handleDataRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", dataUrl);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const overridePath = fixtureOverrides.get(pathname);

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (overridePath) {
    await serveFile(response, overridePath);
    return;
  }

  if (!pathname.startsWith("/exports/")) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }

  const filePath = resolve(fixturesRoot, pathname.slice("/exports/".length));
  if (!(await fileExists(filePath))) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }

  await serveFile(response, filePath);
}

function resolveChromiumExecutablePath(): string {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.UI_CHROME_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Chromium executable not found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or UI_CHROME_EXECUTABLE_PATH."
  );
}

export async function ensureScreenshotRoot(): Promise<void> {
  await rm(screenshotRoot, { recursive: true, force: true });
  await mkdir(screenshotRoot, { recursive: true });
}

export async function startUiServers(): Promise<{ appServer: Server; dataServer: Server }> {
  const [appServer, dataServer] = await Promise.all([
    startServer(appPort, handleAppRequest),
    startServer(dataPort, handleDataRequest)
  ]);

  return { appServer, dataServer };
}

export async function stopServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolveServer, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolveServer();
    });
  });
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    executablePath: resolveChromiumExecutablePath()
  });
}

export async function createBrowserSession(
  browser: Browser,
  viewport: ViewportCase
): Promise<BrowserSession> {
  const issues: string[] = [];
  const context = await browser.newContext({
    viewport: {
      width: viewport.width,
      height: viewport.height
    },
    deviceScaleFactor: 1,
    hasTouch: viewport.hasTouch ?? false,
    isMobile: viewport.isMobile ?? false,
    colorScheme: "light",
    locale: "ko-KR"
  });

  await context.route("**/*", async (route) => {
    const url = route.request().url();

    if (url.startsWith("https://www.assembly.go.kr/")) {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: placeholderAvatarSvg
      });
      return;
    }

    if (url.startsWith(appUrl) || url.startsWith(dataUrl)) {
      await route.continue();
      return;
    }

    await route.abort();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  page.on("console", (message) => {
    if (message.type() === "error") {
      issues.push(`console:${message.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    issues.push(`pageerror:${error.message}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.startsWith(appUrl) || url.startsWith(dataUrl)) {
      issues.push(`requestfailed:${request.method()} ${url}`);
    }
  });

  return { context, page, issues };
}

export async function saveScreenshot(page: Page, relativePath: string): Promise<string> {
  const outputPath = resolve(screenshotRoot, relativePath);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await page.screenshot({
    path: outputPath,
    fullPage: true
  });
  return outputPath;
}

export async function writeScenarioManifest(
  entries: Array<{ viewport: string; scenario: string; screenshot: string }>
): Promise<void> {
  await writeFile(resolve(screenshotRoot, "manifest.json"), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}
