import { prisma } from "@/server/db";
import { json } from "@/server/http";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, status: "healthy" });
  } catch {
    return new Response("Unhealthy", { status: 503 });
  }
}
