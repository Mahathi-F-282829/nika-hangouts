import type { FeatureCollection } from "geojson";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushResultsGeoJSON } from "../mapBus";

describe("pushResultsGeoJSON", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("dispatches a map update event with the feature collection payload", () => {
        const listener = vi.fn();
        window.addEventListener("map:update-results", listener as EventListener);

        const featureCollection: FeatureCollection = {
            type: "FeatureCollection",
            features: [],
        };

        pushResultsGeoJSON(featureCollection);

        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(featureCollection);
    });
});
