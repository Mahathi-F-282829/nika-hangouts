// web/src/lib/mapBus.ts
import type { FeatureCollection } from "geojson";

/** Push a GeoJSON FeatureCollection to the map (Map.tsx listens for this). */
export function pushResultsGeoJSON(fc: FeatureCollection) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("map:update-results", { detail: fc }));
}
