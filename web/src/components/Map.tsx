"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MapLibreMap, LngLatBoundsLike } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";

export default function Map() {
    // DOM container and map instance
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MapLibreMap | null>(null);
    const readyRef = useRef(false);

    // Keep references to DOM overlays so we can remove them between updates
    const markersRef = useRef<maplibregl.Marker[]>([]);
    const labelsRef = useRef<maplibregl.Popup[]>([]);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        // Base map
        const map = new maplibregl.Map({
            container: containerRef.current,
            style: "https://demotiles.maplibre.org/style.json",
            center: [78.382, 17.447],
            zoom: 11,
        });
        mapRef.current = map;

        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

        map.on("load", () => {
            // Vector layer that draws only polygons/multipolygons from the GeoJSON source
            map.addSource("results", { type: "geojson", data: emptyFC() });

            map.addLayer({
                id: "results-fill",
                type: "fill",
                source: "results",
                filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
                paint: { "fill-opacity": 0.30, "fill-color": "#e66a5c" },
            });

            map.addLayer({
                id: "results-line",
                type: "line",
                source: "results",
                filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
                paint: { "line-width": 2, "line-color": "#b3323a" },
            });

            readyRef.current = true;
        });

        // Receives a FeatureCollection via window event and renders pins + polygons
        const handleUpdate = (e: Event) => {
            const fc = (e as CustomEvent).detail as FeatureCollection | undefined;
            if (!fc || !readyRef.current) return;

            // Clear previous DOM markers/popups
            for (const m of markersRef.current) m.remove();
            for (const p of labelsRef.current) p.remove();
            markersRef.current = [];
            labelsRef.current = [];

            const polygons: Feature[] = [];
            const renderedOsm = new Set<string>();   // dedupe using OSM id when available
            const renderedName = new Set<string>();  // fallback dedupe by normalized name

            for (const f of fc.features ?? []) {
                if (!f.geometry) continue;

                // Only draw real shapes; points are ignored (no proxy squares)
                if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;

                const props = (f.properties ?? {}) as any;
                const label = props.short_name || props.name || props.display_name || "Place";
                const osm = props.osm_id ? String(props.osm_id) : "";
                const nameKey = String(label).toLowerCase().trim();

                // Prevent duplicate polygons from rendering
                if (osm) {
                    if (renderedOsm.has(osm)) continue;
                    renderedOsm.add(osm);
                } else {
                    if (renderedName.has(nameKey)) continue;
                    renderedName.add(nameKey);
                }

                polygons.push(f);

                // Drop a pin at the polygon’s centroid (keeps pin aligned with its shape)
                const c = centroidOf(f.geometry);
                if (c) addMarkerWithLabel(map, c, label, markersRef.current, labelsRef.current);
            }

            // Push all polygons to the single GeoJSON source
            const src = map.getSource("results") as maplibregl.GeoJSONSource | undefined;
            if (src) src.setData({ type: "FeatureCollection", features: polygons });

            // Fit map to new data
            const bounds = boundsOfFeatureCollection({ type: "FeatureCollection", features: polygons });
            if (bounds) map.fitBounds(bounds, { padding: 40, duration: 600, maxZoom: 16 });
        };

        window.addEventListener("map:update-results", handleUpdate);

        // Teardown
        return () => {
            window.removeEventListener("map:update-results", handleUpdate);
            for (const m of markersRef.current) m.remove();
            for (const p of labelsRef.current) p.remove();
            markersRef.current = [];
            labelsRef.current = [];
            map.remove();
            mapRef.current = null;
            readyRef.current = false;
        };
    }, []);

    return <div ref={containerRef} className="w-full h-full" />;
}

/* ---------- Helpers ---------- */

function emptyFC(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

/** Adds a red pin and a small always-visible text label at the same lng/lat. */
function addMarkerWithLabel(
    map: maplibregl.Map,
    lngLat: [number, number],
    label: string,
    markers: maplibregl.Marker[],
    labels: maplibregl.Popup[],
) {
    const marker = new maplibregl.Marker({ color: "#e11d48" })
        .setLngLat(lngLat)
        .setPopup(new maplibregl.Popup().setText(label))
        .addTo(map);
    markers.push(marker);

    const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 20,
        className: "maplibre-inline-label",
    })
        .setLngLat(lngLat)
        .setText(label)
        .addTo(map);
    labels.push(popup);
}

/** Returns centroid computed from the geometry’s bbox (fast and robust for UI). */
function centroidOf(g: Geometry): [number, number] | null {
    const b = bboxOfGeometry(g);
    if (!b) return null;
    const [minX, minY, maxX, maxY] = b;
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Computes a geometry bbox by walking its coordinate arrays. */
function bboxOfGeometry(g: Geometry): [number, number, number, number] | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const extend = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    };
    const walk = (c: any) => {
        if (typeof c[0] === "number") extend(c[0], c[1]);
        else for (const sub of c) walk(sub);
    };
    switch (g.type) {
        case "Point": extend(g.coordinates[0], g.coordinates[1]); break;
        case "MultiPoint":
        case "LineString":
        case "MultiLineString":
        case "Polygon":
        case "MultiPolygon": walk((g as any).coordinates); break;
        case "GeometryCollection":
            for (const sub of g.geometries) {
                const b = bboxOfGeometry(sub);
                if (b) { extend(b[0], b[1]); extend(b[2], b[3]); }
            }
            break;
        default: return null;
    }
    if (minX === Infinity) return null;
    return [minX, minY, maxX, maxY];
}

/** Aggregates a bbox for a FeatureCollection (used to fit the map). */
function boundsOfFeatureCollection(fc: FeatureCollection): LngLatBoundsLike | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (g: Geometry) => {
        const b = bboxOfGeometry(g);
        if (!b) return;
        if (b[0] < minX) minX = b[0];
        if (b[1] < minY) minY = b[1];
        if (b[2] > maxX) maxX = b[2];
        if (b[3] > maxY) maxY = b[3];
    };
    for (const f of fc.features ?? []) if (f.geometry) visit(f.geometry);
    if (minX === Infinity) return null;
    return [[minX, minY], [maxX, maxY]];
}
