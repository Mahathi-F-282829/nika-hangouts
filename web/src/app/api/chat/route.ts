// web/src/app/api/chat/route.ts
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

export const runtime = "nodejs";

type TextMessagePart = {
    type: "text";
    text: string;
};

type UIMessageLike = {
    role: string;
    parts?: unknown[];
    content?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isUIMessageLike(value: unknown): value is UIMessageLike {
    return isRecord(value) && typeof value.role === "string";
}

function isTextMessagePart(value: unknown): value is TextMessagePart {
    return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

/**
 * System contract appended to the model so the UI can reliably parse places
 * from the final streamed line (<PLACES>…</PLACES> with compact JSON).
 */
const PLACES_INSTRUCTION = `
Answer the user normally in prose.

At the VERY END of your answer, append exactly ONE compact JSON block on a single line,
wrapped in <PLACES> ... </PLACES>.

JSON schema (no extra fields):
{"places":[{"name":"...","city?":"...","state?":"...","country?":"..."}]}

Rules for places:
- Include only real, named locations explicitly mentioned or recommended in your answer (venues, landmarks, parks, museums, restaurants, cafes, malls, markets, neighborhoods with established names).
- EXCLUDE categories, activities, tips, vague areas without proper names, or invented places.
- Do not infer a place that wasn’t clearly named.
- Dedupe by normalized name (case/spacing).
- Max 12 items.
- Include city/state/country ONLY if clearly implied by the user or already stated in your answer.
- The <PLACES> line must contain VALID JSON only (no comments, no trailing commas, no markdown).
Nothing else may appear inside the <PLACES> tags.
`.trim();

/** Minimal SSE fallback used when no API key is present. */
function fallbackStream(text: string) {
    const id = `m_${Date.now().toString(36)}`;
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                const send = (obj: unknown) =>
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
                send({ type: "text-start", id });
                send({ type: "text-delta", id, delta: text });
                send({ type: "text-end", id });
                controller.close();
            },
        }),
        {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            },
        }
    );
}

export async function POST(req: Request) {
    if (!process.env.OPENAI_API_KEY) {
        return fallbackStream("Server missing OPENAI_API_KEY. Add it to web/.env.local and restart.");
    }

    try {
        // Extract the latest user prompt from the UI message array.
        const body = (await req.json().catch(() => ({}))) as { messages?: unknown };
        const uiMessages = Array.isArray(body.messages) ? body.messages.filter(isUIMessageLike) : [];
        const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
        let prompt = "Hello!";
        if (lastUser) {
            if (Array.isArray(lastUser.parts)) {
                const textParts = lastUser.parts.filter(isTextMessagePart);
                prompt = textParts.map((p) => p.text).join("\n").trim() || prompt;
            } else if (typeof lastUser.content === "string") {
                prompt = lastUser.content;
            }
        }

        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });

        // Stream the model’s text; the system prompt enforces the <PLACES> footer.
        const result = streamText({
            model: openai("gpt-5-mini"),
            system: [
                "You are Nika’s location hangouts assistant. Be concise and friendly.",
                PLACES_INSTRUCTION,
            ].join("\n\n"),
            prompt,
            temperature: 0.2,
        });

        // Wrap the model stream as Server-Sent Events for the frontend.
        const encoder = new TextEncoder();
        const id = `m_${Date.now().toString(36)}`;
        let closed = false;

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const send = (obj: unknown) => {
                    if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
                };

                send({ type: "text-start", id });

                try {
                    for await (const chunk of result.textStream) {
                        if (closed) break;
                        send({ type: "text-delta", id, delta: chunk }); // UI renders as it arrives
                    }
                } catch (e) {
                    console.error("[/api/chat] stream error:", e);
                    send({ type: "text-delta", id, delta: " (stream error) " });
                }

                if (!closed) {
                    send({ type: "text-end", id });
                    closed = true;
                    controller.close();
                }
            },
            cancel() {
                // Triggered when the client aborts (e.g., user hit “Stop”).
                closed = true;
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[/api/chat] Fatal error:", msg);
        return fallbackStream(`(Error) ${msg}`);
    }
}
