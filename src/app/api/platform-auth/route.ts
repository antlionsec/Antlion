import { NextRequest, NextResponse } from "next/server";
import {
  getAuthStatus,
  saveCredential,
  removeCredential,
  validatePlatformApiKey,
  type PlatformId,
} from "@/lib/platform-auth";

// GET /api/platform-auth — masked auth status for all platforms
export async function GET() {
  try {
    const status = await getAuthStatus();
    return NextResponse.json({ status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/platform-auth — save + validate API-key credentials for one platform
// Body: { platform: "hackerone"|"bugcrowd"|"intigriti", fields: { ... } }
// The key is validated against the platform's real API before it is persisted
// in the local DB; invalid keys are rejected and never stored.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const platform = body.platform as PlatformId;
    const fields: Record<string, string> = {};

    // Accept { fields: {...} } (structured form) — values are trimmed strings.
    if (body.fields && typeof body.fields === "object") {
      for (const [k, v] of Object.entries(body.fields)) {
        if (typeof v === "string" && v.trim()) fields[k] = v.trim();
      }
    }

    if (!["hackerone", "bugcrowd", "intigriti"].includes(platform)) {
      return NextResponse.json(
        { error: "platform must be hackerone, bugcrowd or intigriti" },
        { status: 400 },
      );
    }
    if (Object.keys(fields).length === 0) {
      return NextResponse.json(
        { error: "API key fields required" },
        { status: 400 },
      );
    }

    // Validate against the real platform API before persisting
    const validation = await validatePlatformApiKey(platform, fields);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error || "Validation failed" },
        { status: 400 },
      );
    }

    await saveCredential(platform, {
      kind: "apikey",
      fields,
      savedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      account: validation.account,
    });

    return NextResponse.json({
      ok: true,
      platform,
      account: validation.account,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/platform-auth?platform=bugcrowd — remove the saved API key
export async function DELETE(req: NextRequest) {
  try {
    const platform = req.nextUrl.searchParams.get("platform") as PlatformId | null;
    if (!platform) {
      return NextResponse.json({ error: "platform required" }, { status: 400 });
    }
    await removeCredential(platform);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
