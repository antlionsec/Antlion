import { NextRequest, NextResponse } from "next/server";
import {
  getAuthStatus,
  saveCredential,
  removeCredential,
  validateHackerOne,
  validateBugcrowd,
  validateIntigriti,
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

// POST /api/platform-auth — save + validate credentials for one platform
// Body: { platform: "hackerone"|"bugcrowd"|"intigriti", cookie: "..." }
// Credentials persist in the local DB and are shared by every project.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const platform = body.platform as PlatformId;
    const cookie: string = (body.cookie || "").trim();

    if (!["hackerone", "bugcrowd", "intigriti"].includes(platform)) {
      return NextResponse.json(
        { error: "platform must be hackerone, bugcrowd or intigriti" },
        { status: 400 },
      );
    }
    if (!cookie || cookie.length < 10) {
      return NextResponse.json(
        { error: "cookie header value required" },
        { status: 400 },
      );
    }

    // Validate against the real platform before persisting
    let validation;
    if (platform === "hackerone") validation = await validateHackerOne(cookie);
    else if (platform === "bugcrowd") validation = await validateBugcrowd(cookie);
    else validation = await validateIntigriti(cookie);

    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error || "Validation failed" },
        { status: 400 },
      );
    }

    await saveCredential(platform, {
      kind: "cookie",
      value: cookie,
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

// DELETE /api/platform-auth?platform=bugcrowd — logout
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
