// web/src/app/page.tsx
import Link from "next/link";

export default function Page() {
    return (
        <main className="h-dvh grid place-items-center">
            <Link
                href="/chat"
                className="px-4 py-2 rounded bg-black text-white hover:opacity-90"
            >
                Open Chat
            </Link>
        </main>
    );
}
