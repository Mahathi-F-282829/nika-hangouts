// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../route";

const originalApiKey = process.env.OPENAI_API_KEY;

describe("POST /api/chat", () => {
    afterEach(() => {
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
            return;
        }

        process.env.OPENAI_API_KEY = originalApiKey;
    });

    it("falls back to an SSE error stream when OPENAI_API_KEY is missing", async () => {
        delete process.env.OPENAI_API_KEY;

        const req = new Request("http://localhost/api/chat", {
            method: "POST",
            body: JSON.stringify({ messages: [] }),
        });

        const res = await POST(req);
        const payload = await res.text();

        expect(res.headers.get("content-type")).toContain("text/event-stream");
        expect(payload).toContain('"type":"text-start"');
        expect(payload).toContain("Server missing OPENAI_API_KEY");
        expect(payload).toContain('"type":"text-end"');
    });
});
