// web/src/app/api/geocode/route.ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type BBox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]

export async function POST(req: NextRequest) {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        // Request body from client
        const body = (await req.json().catch(() => ({}))) as {
            prompt?: string;        // user query, e.g. "Golconda Fort Hyderabad"
            bbox?: BBox;            // optional focus extent from client map
            countrycodes?: string;  // ISO2 filters, e.g. "in" or "in,us"
            limit?: number;         // number of candidates to return
        };

        const q = (body.prompt ?? "").trim();
        if (!q) {
            return fcResponse(emptyFC(), 400, { error: "Missing prompt" });
        }

        const limit = Math.min(Math.max(body.limit ?? 15, 1), 40);

        // Build the Nominatim search URL
        const params = new URLSearchParams({
            q,
            format: "geojson",
            polygon_geojson: "1",   // return area geometry when available
            addressdetails: "1",
            extratags: "1",
            namedetails: "1",
            limit: String(limit),
        });

        if (body.countrycodes) params.set("countrycodes", body.countrycodes);

        // If a bounding box is provided: bias results to the viewbox and
        // restrict results to the box for stricter locality.
        if (isBBox(body.bbox)) {
            const [minLng, minLat, maxLng, maxLat] = body.bbox;
            // Nominatim expects viewbox as: left,top,right,bottom (lon/lat)
            params.set("viewbox", `${minLng},${maxLat},${maxLng},${minLat}`);
            params.set("bounded", "1");
        }

        const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

        const res = await fetch(url, {
            headers: {
                "User-Agent": "NikaHangouts/1.0 (assignment)",
                "Accept-Language": "en",
            },
            // Small server-side cache keeps dev usage polite to Nominatim
            cache: "force-cache",
            next: { revalidate: 15 },
        });

        if (!res.ok) {
            return fcResponse(emptyFC(), 200, { error: `Nominatim HTTP ${res.status}` });
        }

        const fc = (await res.json()) as GeoJSON.FeatureCollection;
        return fcResponse(fc, 200);
    } catch (err: any) {
        return fcResponse(emptyFC(), 200, {
            error: String(err?.message ?? err ?? "Unknown error"),
        });
    }
}

/* --------------------------------- Helpers -------------------------------- */

function emptyFC(): GeoJSON.FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

/** Consistent FC JSON response with optional metadata envelope. */
function fcResponse(
    fc: GeoJSON.FeatureCollection,
    status = 200,
    meta?: Record<string, unknown>
) {
    const payload = meta ? { ...fc, _meta: meta } : fc;
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
    });
}

/** Type guard for a numeric 4-tuple bbox. */
function isBBox(x: unknown): x is [number, number, number, number] {
    return Array.isArray(x) && x.length === 4 && x.every((n) => typeof n === "number" && Number.isFinite(n));
}