import { AppShell } from "@/components/layout/app-shell";
import { getServerSession } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

function normalizeFilter(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "zen" || candidate === "upcoming" || candidate === "archive") {
    return candidate;
  }

  return "today";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const session = await getServerSession();
  const resolvedSearchParams = await searchParams;
  const initialFilter = normalizeFilter(resolvedSearchParams.view);

  return <AppShell initialAuthenticated={Boolean(session)} initialFilter={initialFilter} />;
}
