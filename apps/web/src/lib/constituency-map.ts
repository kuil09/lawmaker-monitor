import type { ConstituencyBoundaryProperties } from "@lawmaker-monitor/schemas";

export type ConstituencyBoundaryTopology = {
  type: "Topology";
  objects: {
    constituencies: {
      type: "GeometryCollection";
      geometries: Array<{
        type: string;
        properties: ConstituencyBoundaryProperties;
        arcs: unknown;
      }>;
    };
  };
  arcs: unknown[];
  bbox?: [number, number, number, number];
  transform?: {
    scale: [number, number];
    translate: [number, number];
  };
};

export function normalizeConstituencyLookupKey(
  value: string | null | undefined
): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, "").replace(/[ㆍ?]/g, "·").trim();
}
