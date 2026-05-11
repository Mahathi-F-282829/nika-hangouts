import type { LngLatBoundsLike } from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";

export function emptyFC(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

/** Returns centroid computed from the geometry's bbox. */
export function centroidOf(g: Geometry): [number, number] | null {
    const b = bboxOfGeometry(g);
    if (!b) return null;
    const [minX, minY, maxX, maxY] = b;
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Computes a geometry bbox by walking coordinate arrays. */
export function bboxOfGeometry(g: Geometry): [number, number, number, number] | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const extend = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    };

    const walk = (c: unknown) => {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === "number" && typeof c[1] === "number") {
            extend(c[0], c[1]);
            return;
        }

        for (const sub of c) walk(sub);
    };

    switch (g.type) {
        case "Point":
            extend(g.coordinates[0], g.coordinates[1]);
            break;
        case "MultiPoint":
        case "LineString":
        case "MultiLineString":
        case "Polygon":
        case "MultiPolygon":
            walk(g.coordinates);
            break;
        case "GeometryCollection":
            for (const sub of g.geometries) {
                const b = bboxOfGeometry(sub);
                if (b) {
                    extend(b[0], b[1]);
                    extend(b[2], b[3]);
                }
            }
            break;
        default:
            return null;
    }

    if (minX === Infinity) return null;
    return [minX, minY, maxX, maxY];
}

/** Aggregates a bbox for a FeatureCollection. */
export function boundsOfFeatureCollection(fc: FeatureCollection): LngLatBoundsLike | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const f of fc.features ?? []) {
        if (!f.geometry) continue;

        const b = bboxOfGeometry(f.geometry);
        if (!b) continue;

        if (b[0] < minX) minX = b[0];
        if (b[1] < minY) minY = b[1];
        if (b[2] > maxX) maxX = b[2];
        if (b[3] > maxY) maxY = b[3];
    }

    if (minX === Infinity) return null;
    return [[minX, minY], [maxX, maxY]];
}
