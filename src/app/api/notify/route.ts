import { NextRequest, NextResponse } from "next/server";
import { sendTestNotification, type NotifyHook } from "@/lib/notify";

// POST /api/notify — send a test notification to an (optionally unsaved) hook.
// The UI uses this for the "Send test" button in the global settings dialog.
export async function POST(req: NextRequest) {
  try {
    const hook = (await req.json()) as NotifyHook;
    if (hook?.type === "email") {
      const e = hook.email;
      if (!e?.host?.trim() || !e?.to?.trim() || !e?.from?.trim()) {
        return NextResponse.json({ error: "Email hooks need an SMTP host, a from address and at least one recipient" }, { status: 400 });
      }
    } else {
      if (!hook?.url || typeof hook.url !== "string" || hook.url.trim().length < 8) {
        return NextResponse.json({ error: "A webhook URL (or bot token) is required" }, { status: 400 });
      }
      if (hook.type === "telegram" && !hook.chatId) {
        return NextResponse.json({ error: "Telegram hooks need a chat id" }, { status: 400 });
      }
    }
    await sendTestNotification({ ...hook, url: (hook.url || "").trim() });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Delivery failed" }, { status: 502 });
  }
}
