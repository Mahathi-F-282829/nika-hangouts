// web/src/app/chat/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import Map from "@/components/Map";
import { pushResultsGeoJSON } from "@/lib/mapBus";
import type { FeatureCollection, Feature } from "geojson";

/* ----------------------------- Helpers & Types ---------------------------- */

type TextPart = { type: "text"; text: string };
const isTextPart = (p: unknown): p is TextPart =>
    !!p && (p as any).type === "text" && typeof (p as any).text === "string";

/** Try to infer a city from the user’s last prompt (very light-weight heuristic). */
function extractCityHint(prompt: string): string | null {
    const lower = prompt.toLowerCase();
    const m =
        /(?: in | near | around | at )([a-z0-9 .'-]+)$/i.exec(prompt) ||
        /(?: in | near | around | at )([a-z0-9 .'-]+)[.,;!?)\]]/i.exec(prompt);
    if (m?.[1]) return m[1].trim();
    if (/\bhyd\b/i.test(lower)) return "Hyderabad";
    return null;
}

/** Hide the special <PLACES>…</PLACES> block (including partial while streaming). */
function stripPlacesTag(s: string): string {
    return s.replace(/<PLACES>[\s\S]*?(?:<\/PLACES>|$)/g, "");
}

/** Shape emitted inside the <PLACES> JSON block. */
type PlaceJSON = {
    name: string;
    ["city?"]?: string;
    ["state?"]?: string;
    ["country?"]?: string;
};

/** Normalized place used by our geocoding logic. */
type Place = { name: string; city?: string; state?: string; country?: string };

/**
 * Parse the assistant’s full text to extract places from the trailing
 * <PLACES>{ "places":[...] }</PLACES> block. We cap to 12 unique items.
 */
function parsePlacesFromAssistant(fullText: string): Place[] {
    const m = fullText.match(/<PLACES>([\s\S]*?)<\/PLACES>/);
    if (!m) return [];

    let raw: unknown;
    try {
        raw = JSON.parse(m[1]);
    } catch {
        return [];
    }

    const obj = raw as { places?: unknown };
    if (!obj || !Array.isArray(obj.places)) return [];

    const seen = new Set<string>();
    const out: Place[] = [];

    for (const item of obj.places as unknown[]) {
        const p = item as Partial<PlaceJSON> | null;
        if (!p || typeof p.name !== "string") continue;

        const name = p.name.trim();
        if (!name) continue;

        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const city = typeof p["city?"] === "string" ? p["city?"].trim() : undefined;
        const state = typeof p["state?"] === "string" ? p["state?"].trim() : undefined;
        const country = typeof p["country?"] === "string" ? p["country?"].trim() : undefined;

        out.push({ name, city, state, country });
        if (out.length >= 12) break;
    }

    return out;
}

/** Flatten a chat message into plain text (handles parts/deltas). */
function messageToPlainText(m: any): string {
    if (Array.isArray(m.parts)) {
        return (m.parts as unknown[])
            .filter(isTextPart)
            .map((p: TextPart) => p.text)
            .join(" ");
    }
    return (m.content as string) ?? "";
}

/* --------------------------------- Page UI -------------------------------- */

export default function ChatPage() {
    const [input, setInput] = useState("");
    const { messages, status, error, sendMessage, stop } = useChat();

    // Keep chat scrolled to bottom as messages arrive
    const chatContainerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Prevent processing the same assistant message twice
    const lastHandledAssistantId = useRef<string | null>(null);

    /**
     * When an assistant message completes:
     *  - Read the natural language answer
     *  - Parse the hidden <PLACES> JSON block
     *  - Geocode each place (polygons only), de-dupe, then push one FC to the map
     */
    useEffect(() => {
        if (status !== "ready" || messages.length === 0) return;

        const last = messages[messages.length - 1] as any;
        if (last.role !== "assistant") return;
        if (last.id === lastHandledAssistantId.current) return;

        const assistantText = messageToPlainText(last).trim();
        if (!assistantText) return;

        const userLast = [...messages].reverse().find((m: any) => m.role === "user") as any | undefined;
        const cityHint = userLast ? extractCityHint(messageToPlainText(userLast)) : null;

        (async () => {
            try {
                // Extract places directly from the assistant’s <PLACES> block
                const places = parsePlacesFromAssistant(assistantText);
                if (!Array.isArray(places) || places.length === 0) {
                    lastHandledAssistantId.current = last.id;
                    return;
                }

                // Geocode & collect only polygon/multipolygon features, with de-duplication
                const features: Feature[] = [];
                const seenOsm = new Set<string>();
                const seenByName = new Set<string>();

                for (const { name } of places) {
                    const q = cityHint ? `${name} ${cityHint}` : name;

                    const res = await fetch("/api/geocode", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ prompt: q, limit: 5 }),
                    });
                    if (!res.ok) continue;

                    const fc = (await res.json()) as FeatureCollection;

                    for (const f of fc.features ?? []) {
                        if (!f.geometry) continue;
                        if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;

                        const props = (f.properties ?? {}) as any;
                        const label = props.short_name || props.name || props.display_name || name;
                        const osm = props.osm_id ? String(props.osm_id) : "";
                        const nameKey = label.toLowerCase().trim();

                        // De-dupe by osm_id if available, otherwise by normalized name
                        if (osm) {
                            if (seenOsm.has(osm)) continue;
                            seenOsm.add(osm);
                        } else {
                            if (seenByName.has(nameKey)) continue;
                            seenByName.add(nameKey);
                        }

                        (f.properties as any) = { ...props, name: label };
                        features.push(f);
                        break; // take the first polygon match for this query
                    }
                }

                // Render all results at once on the map
                if (features.length > 0) {
                    pushResultsGeoJSON({ type: "FeatureCollection", features });
                }
            } catch {
                /* ignore network/parsing errors */
            }

            lastHandledAssistantId.current = last.id;
        })();
    }, [messages, status]);

    /* --------------------------------- Render -------------------------------- */

    return (
        <main className="grid md:grid-cols-[1fr_360px] h-dvh overflow-hidden">
            <section className="bg-gray-50 min-h-0 overflow-hidden">
                <Map />
            </section>

            <aside className="border-l flex min-h-0 flex-col overflow-hidden">
                <header className="p-3 border-b font-medium shrink-0">Nika Hangouts</header>

                <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                    {messages.map((m: any) => (
                        <div
                            key={m.id}
                            className={
                                m.role === "user"
                                    ? "self-end bg-blue-50 p-2 rounded-lg"
                                    : "self-start bg-gray-100 p-2 rounded-lg"
                            }
                        >
                            {(() => {
                                // Raw content (handles both parts & plain content)
                                const raw = Array.isArray(m.parts)
                                    ? (m.parts as unknown[]).filter(isTextPart).map((p: TextPart) => p.text).join(" ")
                                    : ((m as any).content ?? "");

                                // For assistant messages, hide the embedded <PLACES> JSON block from the UI
                                const visible = m.role === "assistant" ? stripPlacesTag(raw).trim() : raw;
                                return <p>{visible}</p>;
                            })()}
                        </div>
                    ))}

                    {status === "streaming" && <div className="text-xs text-gray-500">Streaming…</div>}
                    {error && <div className="text-xs text-red-600">Error: {error.message}</div>}
                </div>

                <form
                    className="p-3 border-t flex gap-2 shrink-0"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const q = input.trim();
                        if (!q) return;
                        sendMessage({ text: q });
                        setInput("");
                    }}
                >
                    <input
                        className="flex-1 border rounded px-3 py-2"
                        placeholder="Ask for a hangout spot…"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={status === "streaming"}
                    />
                    <button
                        type="submit"
                        className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
                        disabled={status === "streaming"}
                    >
                        Send
                    </button>
                    {status === "streaming" && (
                        <button type="button" className="px-3 py-2" onClick={stop}>
                            Stop
                        </button>
                    )}
                </form>
            </aside>
        </main>
    );
}
