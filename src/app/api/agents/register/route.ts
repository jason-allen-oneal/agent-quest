export async function POST() {
  // Registration is no longer public.
  // Use POST /api/access-requests and approve via /admin/access-requests.
  return new Response("Registration disabled. Use /api/access-requests", { status: 410 });
}
