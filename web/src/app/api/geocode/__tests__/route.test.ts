// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

describe("POST /api/geocode", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns a 400 feature collection response when prompt is missing", async () => {
        const req = new Request("http://localhost/api/geocode", {
            method: "POST",
            body: JSON.stringify({}),
        });

        const res = await POST(req as never);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.features).toEqual([]);
        expect(body._meta).toEqual({ error: "Missing prompt" });
    });

    it("builds the expected nominatim request from prompt and bbox inputs", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );

        const req = new Request("http://localhost/api/geocode", {
            method: "POST",
            body: JSON.stringify({
                prompt: "Golconda Fort",
                bbox: [78.1, 17.2, 78.5, 17.6],
                countrycodes: "in",
                limit: 99,
            }),
        });

        const res = await POST(req as never);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        const parsed = new URL(String(url));

        expect(res.status).toBe(200);
        expect(parsed.hostname).toBe("nominatim.openstreetmap.org");
        expect(parsed.searchParams.get("q")).toBe("Golconda Fort");
        expect(parsed.searchParams.get("limit")).toBe("40");
        expect(parsed.searchParams.get("countrycodes")).toBe("in");
        expect(parsed.searchParams.get("viewbox")).toBe("78.1,17.6,78.5,17.2");
        expect(parsed.searchParams.get("bounded")).toBe("1");
        expect(init).toMatchObject({
            cache: "force-cache",
            headers: {
                "Accept-Language": "en",
                "User-Agent": "NikaHangouts/1.0 (assignment)",
            },
            next: { revalidate: 15 },
        });
    });

    it("returns an empty feature collection with metadata when nominatim fails", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("upstream error", { status: 503 }),
        );

        const req = new Request("http://localhost/api/geocode", {
            method: "POST",
            body: JSON.stringify({ prompt: "Charminar" }),
        });

        const res = await POST(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.features).toEqual([]);
        expect(body._meta).toEqual({ error: "Nominatim HTTP 503" });
    });
});
