"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ThemePreference } from "@/hooks/useTheme";
import { useTheme } from "@/hooks/useTheme";
import { apiClient } from "@/lib/apiClient";
import { clearLocalThoughts } from "@/lib/indexedDb";

const FILTER_STORAGE_KEY = "ibx:active-view";
const PROMPT_AUTOFOCUS_STORAGE_KEY = "ibx:prompt-autofocus";
const PICKER_ITEM_CLASS =
  "border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background";
const LOCAL_STATUS_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

type DefaultView = "today" | "upcoming" | "archive";
type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: number;
};

function readStoredDefaultView(): DefaultView {
  if (typeof window === "undefined") {
    return "today";
  }

  try {
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
    return stored === "upcoming" || stored === "archive" ? stored : "today";
  } catch {
    return "today";
  }
}

function readStoredPromptAutofocus() {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(PROMPT_AUTOFOCUS_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function getLocalStatusLabel(timestamp: number) {
  return LOCAL_STATUS_TIME_FORMATTER.format(new Date(timestamp)).toLowerCase();
}

export function SettingsView() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [isClearing, startClearTransition] = useTransition();
  const [isSigningOut, startSignOutTransition] = useTransition();
  const [defaultView, setDefaultView] = useState<DefaultView>("today");
  const [promptAutofocus, setPromptAutofocus] = useState(true);
  const [hasHydratedPreferences, setHasHydratedPreferences] = useState(false);
  const [keyName, setKeyName] = useState("cli");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [isCreatingKey, startCreateKeyTransition] = useTransition();
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [currentTimestamp, setCurrentTimestamp] = useState(() => Date.now());

  const setThemeFromGroup = (values: string[]) => {
    const nextTheme = values[0];
    if (nextTheme === "light" || nextTheme === "dark" || nextTheme === "system") {
      setTheme(nextTheme as ThemePreference);
    }
  };

  const setDefaultViewFromGroup = (values: string[]) => {
    const nextView = values[0];
    if (nextView !== "today" && nextView !== "upcoming" && nextView !== "archive") {
      return;
    }

    setDefaultView(nextView);
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, nextView);
    } catch {
      // Ignore localStorage failures (private mode, blocked storage)
    }
    toast.message(`startup view set to ${nextView}`);
  };

  const setPromptAutofocusFromGroup = (values: string[]) => {
    const nextValue = values[0];
    if (nextValue !== "on" && nextValue !== "off") {
      return;
    }

    const nextAutofocus = nextValue === "on";
    setPromptAutofocus(nextAutofocus);
    try {
      window.localStorage.setItem(PROMPT_AUTOFOCUS_STORAGE_KEY, nextAutofocus ? "1" : "0");
    } catch {
      // Ignore localStorage failures (private mode, blocked storage)
    }
    toast.message(`prompt autofocus ${nextAutofocus ? "enabled" : "disabled"}`);
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

  const refreshApiKeys = async () => {
    setIsLoadingKeys(true);
    try {
      const { keys } = await apiClient.listApiKeys();
      setApiKeys(keys);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load API keys.";
      toast.error(message);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  useEffect(() => {
    setDefaultView(readStoredDefaultView());
    setPromptAutofocus(readStoredPromptAutofocus());
    setHasHydratedPreferences(true);
  }, []);

  useEffect(() => {
    void refreshApiKeys();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTimestamp(Date.now());
    }, 30_000);

    return () => window.clearInterval(timer);
  }, []);

  const handleCreateApiKey = () => {
    startCreateKeyTransition(async () => {
      try {
        const created = await apiClient.createApiKey(keyName);
        setCreatedApiKey(created.apiKey);
        setKeyName("cli");
        toast.message("API key created");
        await refreshApiKeys();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create API key.";
        toast.error(message);
      }
    });
  };

  const handleRevokeApiKey = async (keyId: string) => {
    setRevokingKeyId(keyId);
    try {
      await apiClient.revokeApiKey(keyId);
      toast.message("API key revoked");
      await refreshApiKeys();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke API key.";
      toast.error(message);
    } finally {
      setRevokingKeyId(null);
    }
  };

  const copyCreatedApiKey = async () => {
    if (!createdApiKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdApiKey);
      toast.message("API key copied");
    } catch {
      toast.error("Could not copy API key");
    }
  };

  return (
    <>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="h-12 border-b p-0">
            <div className="flex h-12 items-center justify-between px-3 group-data-[collapsible=icon]:hidden">
              <p className="text-sm">ibx</p>
              <SidebarTrigger size="icon-sm" variant="ghost" />
            </div>
            <div className="hidden h-12 items-center justify-center group-data-[collapsible=icon]:flex">
              <SidebarTrigger size="icon-sm" variant="ghost" />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>views</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/?view=today" prefetch={false} />}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">today</span>
                    <span className="hidden group-data-[collapsible=icon]:inline">{"\\"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/?view=upcoming" prefetch={false} />}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">upcoming</span>
                    <span className="hidden group-data-[collapsible=icon]:inline">/</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/?view=archive" prefetch={false} />}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">archive</span>
                    <span className="hidden group-data-[collapsible=icon]:inline">[</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive
                    render={<Link href="/settings" prefetch={false} />}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">settings</span>
                    <span className="hidden group-data-[collapsible=icon]:inline">]</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              {getLocalStatusLabel(currentTimestamp)}
            </p>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-h-dvh flex flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center border-b bg-background px-4 md:px-6">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="md:hidden" size="icon-sm" variant="ghost" />
              <p className="text-sm text-muted-foreground">{"> settings"}</p>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto py-4">
            <section className="border-b px-4 pb-4 md:px-6">
              <p className="text-sm">theme</p>
              <p className="mt-1 text-xs text-muted-foreground">
                choose how the interface should appear.
              </p>
              <ToggleGroup
                multiple={false}
                value={[theme]}
                onValueChange={setThemeFromGroup}
                variant="default"
                size="sm"
                className="mt-3"
              >
                <ToggleGroupItem value="system" className={PICKER_ITEM_CLASS}>
                  system
                </ToggleGroupItem>
                <ToggleGroupItem value="light" className={PICKER_ITEM_CLASS}>
                  light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" className={PICKER_ITEM_CLASS}>
                  dark
                </ToggleGroupItem>
              </ToggleGroup>
            </section>

            <section className="border-b px-4 py-4 md:px-6">
              <p className="text-sm">behavior</p>
              <p className="mt-1 text-xs text-muted-foreground">
                tune startup and input interaction defaults.
              </p>

              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">startup view</p>
                  <ToggleGroup
                    multiple={false}
                    value={[defaultView]}
                    onValueChange={setDefaultViewFromGroup}
                    variant="default"
                    size="sm"
                    disabled={!hasHydratedPreferences}
                  >
                    <ToggleGroupItem value="today" className={PICKER_ITEM_CLASS}>
                      today
                    </ToggleGroupItem>
                    <ToggleGroupItem value="upcoming" className={PICKER_ITEM_CLASS}>
                      upcoming
                    </ToggleGroupItem>
                    <ToggleGroupItem value="archive" className={PICKER_ITEM_CLASS}>
                      archive
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">prompt autofocus</p>
                  <ToggleGroup
                    multiple={false}
                    value={[promptAutofocus ? "on" : "off"]}
                    onValueChange={setPromptAutofocusFromGroup}
                    variant="default"
                    size="sm"
                    disabled={!hasHydratedPreferences}
                  >
                    <ToggleGroupItem value="on" className={PICKER_ITEM_CLASS}>
                      on
                    </ToggleGroupItem>
                    <ToggleGroupItem value="off" className={PICKER_ITEM_CLASS}>
                      off
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
            </section>

            <section className="border-b px-4 py-4 md:px-6">
              <p className="text-sm">api keys</p>
              <p className="mt-1 text-xs text-muted-foreground">
                create keys for cli usage. keys are shown once and only hashed values are stored.
              </p>

              <div className="mt-3 flex max-w-xl flex-wrap items-center gap-1.5">
                <input
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value.slice(0, 64))}
                  className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                  placeholder="key name"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-auto"
                  onClick={handleCreateApiKey}
                  disabled={isCreatingKey}
                >
                  {isCreatingKey ? "generating..." : "generate key"}
                </Button>
              </div>

              {createdApiKey ? (
                <div className="mt-3 flex max-w-xl flex-col gap-2 rounded-md border border-input p-2">
                  <p className="text-[11px] text-muted-foreground">copy now. this value will not be shown again.</p>
                  <code className="break-all text-xs">{createdApiKey}</code>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="w-auto" onClick={copyCreatedApiKey}>
                      copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-auto"
                      onClick={() => setCreatedApiKey(null)}
                    >
                      hide
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex max-w-xl flex-col gap-1.5">
                {isLoadingKeys ? (
                  <p className="text-xs text-muted-foreground">loading keys...</p>
                ) : apiKeys.length === 0 ? (
                  <p className="text-xs text-muted-foreground">no keys yet</p>
                ) : (
                  apiKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between rounded-md border border-input px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p>{key.name}</p>
                        <p className="text-muted-foreground">{key.prefix}_...{key.last4}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-auto"
                        disabled={revokingKeyId === key.id}
                        onClick={() => void handleRevokeApiKey(key.id)}
                      >
                        {revokingKeyId === key.id ? "revoking..." : "revoke"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="border-b px-4 py-4 md:px-6">
              <p className="text-sm">session</p>
              <p className="mt-1 text-xs text-muted-foreground">
                manage local queue and active access session.
              </p>
              <div className="mt-3 flex max-w-xl flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-auto"
                  disabled={isClearing || isSigningOut}
                  onClick={handleClearQueue}
                >
                  {isClearing ? "clearing..." : "clear local queue"}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="w-auto border border-input bg-white text-black hover:bg-white/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
                  disabled={isSigningOut}
                  onClick={handleSignOut}
                >
                  {isSigningOut ? "signing out..." : "sign out"}
                </Button>
              </div>
            </section>
          </main>
        </SidebarInset>
      </SidebarProvider>

      <Toaster position="bottom-right" />
    </>
  );
}
