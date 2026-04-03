import { redirect } from "next/navigation";

import { SettingsView } from "@/components/layout/settings-view";
import { getServerSession } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/");
  }

  return <SettingsView />;
}
