import { AppShell } from "@/components/layout/app-shell";
import { getServerSession } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession();

  return <AppShell initialAuthenticated={Boolean(session)} />;
}
