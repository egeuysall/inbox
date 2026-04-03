"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ThemePreference } from "@/hooks/useTheme";
import { useTheme } from "@/hooks/useTheme";
import { apiClient } from "@/lib/apiClient";
import { clearLocalThoughts } from "@/lib/indexedDb";

export function SettingsView() {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isClearing, startClearTransition] = useTransition();
  const [isSigningOut, startSignOutTransition] = useTransition();

  const setThemeFromGroup = (values: string[]) => {
    const nextTheme = values[0];
    if (nextTheme === "light" || nextTheme === "dark" || nextTheme === "system") {
      setTheme(nextTheme as ThemePreference);
    }
  };

  const handleClearQueue = () => {
    startClearTransition(async () => {
      await clearLocalThoughts();
      toast.message("Local queue cleared");
    });
  };

  const handleSignOut = () => {
    startSignOutTransition(async () => {
      await apiClient.logout();
      await clearLocalThoughts();
      toast.message("Signed out");
      router.replace("/");
      router.refresh();
    });
  };

  return (
    <>
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-6 md:px-6">
        <header className="flex items-center justify-between border-b pb-4">
          <p className="text-sm tracking-tight">Settings</p>
          <Button variant="ghost" size="sm" render={<Link href="/" prefetch={false} />}>
            &gt; back
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>Choose how the interface should appear.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ToggleGroup
              multiple={false}
              value={[theme]}
              onValueChange={setThemeFromGroup}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="system">system</ToggleGroupItem>
              <ToggleGroupItem value="light">light</ToggleGroupItem>
              <ToggleGroupItem value="dark">dark</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">resolved: {resolvedTheme}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Manage local queue and active access session.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={isClearing || isSigningOut}
              onClick={handleClearQueue}
            >
              {isClearing ? "Clearing..." : "Clear local queue"}
            </Button>
            <Separator />
            <Button
              variant="outline"
              size="sm"
              disabled={isSigningOut}
              onClick={handleSignOut}
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Toaster position="bottom-right" />
    </>
  );
}
