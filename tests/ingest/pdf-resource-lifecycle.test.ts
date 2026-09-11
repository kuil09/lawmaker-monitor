import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdfLines } from "../../packages/ingest/src/property-disclosures.js";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: vi.fn() }));

describe("property PDF resource lifetime", () => {
  afterEach(() => vi.resetAllMocks());
  async function withPdf(task: (path: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "pdf-lifecycle-"));
    try {
      const path = join(dir, "stub.pdf");
      await writeFile(path, "mocked input");
      await task(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  it("cleans each page before loading the next and destroys the document", async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn(async (number: number) => {
      if (number === 2) expect(cleanup).toHaveBeenCalledTimes(1);
      return {
        cleanup,
        getTextContent: async () => ({
          items: [
            { str: "국회의원", transform: [1, 0, 0, 1, 10, 10], width: 50 }
          ]
        })
      };
    });
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
      destroy
    } as any);
    await withPdf(async (path) => {
      expect(await extractPdfLines(path)).toEqual([
        { pageNumber: 1, text: "국회의원" },
        { pageNumber: 2, text: "국회의원" }
      ]);
    });
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("releases the page and document after text extraction fails", async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          cleanup,
          getTextContent: async () => {
            throw new Error("text failure");
          }
        })
      }),
      destroy
    } as any);
    await withPdf(async (path) => {
      await expect(extractPdfLines(path)).rejects.toThrow("text failure");
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("destroys the loading task after document initialization fails", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    await withPdf(async (path) => {
      vi.mocked(getDocument).mockImplementation(
        () =>
          ({
            promise: Promise.reject(new Error("invalid pdf")),
            destroy
          }) as any
      );
      await expect(extractPdfLines(path)).rejects.toThrow("invalid pdf");
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
