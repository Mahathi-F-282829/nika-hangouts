import type { FeatureCollection, Geometry } from "geojson";
import { describe, expect, it } from "vitest";
import { bboxOfGeometry, boundsOfFeatureCollection, centroidOf, emptyFC } from "../map-geometry";

describe("map geometry helpers", () => {
    it("returns an empty feature collection", () => {
        expect(emptyFC()).toEqual({
            type: "FeatureCollection",
            features: [],
        });
    });

    it("computes a bounding box and centroid for polygons", () => {
        const polygon: Geometry = {
            type: "Polygon",
            coordinates: [[[1, 2], [5, 2], [5, 6], [1, 6], [1, 2]]],
        };

        expect(bboxOfGeometry(polygon)).toEqual([1, 2, 5, 6]);
        expect(centroidOf(polygon)).toEqual([3, 4]);
    });

    it("aggregates bounds across a feature collection", () => {
        const fc: FeatureCollection = {
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [78.3, 17.4] },
                    properties: null,
                },
                {
                    type: "Feature",
                    geometry: {
                        type: "Polygon",
                        coordinates: [[[78.1, 17.2], [78.5, 17.2], [78.5, 17.6], [78.1, 17.6], [78.1, 17.2]]],
                    },
                    properties: null,
                },
            ],
        };

        expect(boundsOfFeatureCollection(fc)).toEqual([
            [78.1, 17.2],
            [78.5, 17.6],
        ]);
    });
});
