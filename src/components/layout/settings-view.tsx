"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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
import { UNAUTHORIZED_EVENT_NAME, apiClient } from "@/lib/apiClient";
import { clearCachedTodos, clearLocalThoughts } from "@/lib/indexedDb";

const FILTER_STORAGE_KEY = "ibx:active-view";
const PROMPT_AUTOFOCUS_STORAGE_KEY = "ibx:prompt-autofocus";
const TIME_BLOCK_NOTIFICATIONS_STORAGE_KEY = "ibx:time-block-notifications";
const AI_AVAILABILITY_NOTES_STORAGE_KEY = "ibx:ai-availability-notes";
const CALENDAR_FEED_URL_STORAGE_KEY = "ibx:calendar-feed-url";
const DEFAULT_AVAILABILITY_NOTES =
  "Mon-Tue unavailable before 6:00 PM. Wed-Fri unavailable before 5:00 PM. Sunday avoid 11:00 AM-12:00 PM and 7:00-8:00 PM. Hard stop at 10:30 PM daily. I execute about 4x faster than average, but only use 15-30 minutes for truly quick admin tasks; deep work should usually stay 45-120 minutes.";
const PICKER_ITEM_CLASS =
  "border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background";
const CLI_INSTALL_COMMAND =
  "curl -fsSL https://ibx.egeuysal.com/install.sh | bash";
const SHORTCUT_INSTALL_URL =
  "https://ibx.egeuysal.com/shortcuts/ibx-capture.shortcut";

type DefaultView = "zen" | "today" | "upcoming" | "archive";
type ApiKeyPermission = "read" | "write" | "both";
type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  permission: ApiKeyPermission;
  createdAt: number;
};
type CalendarFeedSummary = {
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
    return stored === "zen" || stored === "upcoming" || stored === "archive"
      ? stored
      : "today";
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

function readStoredTimeBlockNotifications() {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(TIME_BLOCK_NOTIFICATIONS_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function readStoredAvailabilityNotes() {
  if (typeof window === "undefined") {
    return DEFAULT_AVAILABILITY_NOTES;
  }

  try {
    const stored = window.localStorage.getItem(AI_AVAILABILITY_NOTES_STORAGE_KEY);
    const base = stored?.trim() ? stored.slice(0, 640) : DEFAULT_AVAILABILITY_NOTES;
    if (/\b10:30\b|\b22:30\b/i.test(base)) {
      return base;
    }

    return `${base}${base.endsWith(".") ? "" : "."} Hard stop at 10:30 PM daily.`;
  } catch {
    return DEFAULT_AVAILABILITY_NOTES;
  }
}

function readStoredCalendarFeedUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(CALENDAR_FEED_URL_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    return stored.startsWith("http://") || stored.startsWith("https://")
      ? stored
      : null;
  } catch {
    return null;
  }
}

export function SettingsView() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const lastUnauthorizedToastAtRef = useRef(0);
  const [isClearing, startClearTransition] = useTransition();
  const [isSigningOut, startSignOutTransition] = useTransition();
  const [defaultView, setDefaultView] = useState<DefaultView>("today");
  const [promptAutofocus, setPromptAutofocus] = useState(true);
  const [timeBlockNotificationsEnabled, setTimeBlockNotificationsEnabled] =
    useState(false);
  const [availabilityNotes, setAvailabilityNotes] = useState(
    DEFAULT_AVAILABILITY_NOTES,
  );
  const [hasHydratedPreferences, setHasHydratedPreferences] = useState(false);
  const [keyName, setKeyName] = useState("cli");
  const [keyPermission, setKeyPermission] = useState<ApiKeyPermission>("both");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [calendarFeed, setCalendarFeed] = useState<CalendarFeedSummary | null>(
    null,
  );
  const [calendarFeedUrl, setCalendarFeedUrl] = useState<string | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [isCreatingKey, startCreateKeyTransition] = useTransition();
  const [isRotatingCalendarFeed, startRotateCalendarFeedTransition] =
    useTransition();
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);

  const setThemeFromGroup = (values: string[]) => {
    const nextTheme = values[0];
    if (
      nextTheme === "light" ||
      nextTheme === "dark" ||
      nextTheme === "system"
    ) {
      setTheme(nextTheme as ThemePreference);
    }
  };

  const setDefaultViewFromGroup = (values: string[]) => {
    const nextView = values[0];
    if (
      nextView !== "zen" &&
      nextView !== "today" &&
      nextView !== "upcoming" &&
      nextView !== "archive"
    ) {
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

  const setTimeBlockNotificationsFromGroup = (values: string[]) => {
    const nextValue = values[0];
    if (nextValue !== "on" && nextValue !== "off") {
      return;
    }

    const nextEnabled = nextValue === "on";

    if (nextEnabled && typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        void Notification.requestPermission().then((permission) => {
          const granted = permission === "granted";
          setTimeBlockNotificationsEnabled(granted);

          try {
            window.localStorage.setItem(
              TIME_BLOCK_NOTIFICATIONS_STORAGE_KEY,
              granted ? "1" : "0",
            );
          } catch {
            // Ignore localStorage failures (private mode, blocked storage)
          }

          if (granted) {
            toast.message("time-block notifications enabled");
          } else {
            toast.error("notification permission denied");
          }
        });
        return;
      }

      if (Notification.permission !== "granted") {
        toast.error("notifications are blocked in browser settings.");
        setTimeBlockNotificationsEnabled(false);
        try {
          window.localStorage.setItem(TIME_BLOCK_NOTIFICATIONS_STORAGE_KEY, "0");
        } catch {
          // Ignore localStorage failures (private mode, blocked storage)
        }
        return;
      }
    }

    setTimeBlockNotificationsEnabled(nextEnabled);
    try {
      window.localStorage.setItem(
        TIME_BLOCK_NOTIFICATIONS_STORAGE_KEY,
        nextEnabled ? "1" : "0",
      );
    } catch {
      // Ignore localStorage failures (private mode, blocked storage)
    }

    toast.message(
      `time-block notifications ${nextEnabled ? "enabled" : "disabled"}`,
    );
  };

  const setPromptAutofocusFromGroup = (values: string[]) => {
    const nextValue = values[0];
    if (nextValue !== "on" && nextValue !== "off") {
      return;
    }

    const nextAutofocus = nextValue === "on";
    setPromptAutofocus(nextAutofocus);
    try {
      window.localStorage.setItem(
        PROMPT_AUTOFOCUS_STORAGE_KEY,
        nextAutofocus ? "1" : "0",
      );
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
      await clearCachedTodos();
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
      const message =
        error instanceof Error ? error.message : "Failed to load API keys.";
      toast.error(message);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  useEffect(() => {
    setDefaultView(readStoredDefaultView());
    setPromptAutofocus(readStoredPromptAutofocus());
    setTimeBlockNotificationsEnabled(readStoredTimeBlockNotifications());
    setAvailabilityNotes(readStoredAvailabilityNotes());
    setCalendarFeedUrl(readStoredCalendarFeedUrl());
    setHasHydratedPreferences(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedPreferences) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          AI_AVAILABILITY_NOTES_STORAGE_KEY,
          availabilityNotes.trim().slice(0, 640),
        );
      } catch {
        // Ignore localStorage failures (private mode, blocked storage)
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [availabilityNotes, hasHydratedPreferences]);

  useEffect(() => {
    void refreshApiKeys();
    void refreshCalendarFeedStatus();
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      const now = Date.now();
      if (now - lastUnauthorizedToastAtRef.current > 1_500) {
        toast.error("Session expired. Sign in again.");
        lastUnauthorizedToastAtRef.current = now;
      }

      router.replace("/");
      router.refresh();
    };

    window.addEventListener(UNAUTHORIZED_EVENT_NAME, onUnauthorized as EventListener);
    return () =>
      window.removeEventListener(
        UNAUTHORIZED_EVENT_NAME,
        onUnauthorized as EventListener,
      );
  }, [router]);

  const handleCreateApiKey = () => {
    startCreateKeyTransition(async () => {
      try {
        const created = await apiClient.createApiKey(keyName, keyPermission);
        setCreatedApiKey(created.apiKey);
        setKeyName("cli");
        setKeyPermission("both");
        toast.message("API key created");
        await refreshApiKeys();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create API key.";
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
      const message =
        error instanceof Error ? error.message : "Failed to revoke API key.";
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

  const copyToClipboard = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.message(successMessage);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const refreshCalendarFeedStatus = async () => {
    try {
      const { activeFeed } = await apiClient.getCalendarFeedStatus();
      setCalendarFeed(activeFeed);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load calendar feed status.";
      toast.error(message);
    }
  };

  const rotateCalendarFeed = () => {
    startRotateCalendarFeedTransition(async () => {
      try {
        const { feedUrl, feed } = await apiClient.rotateCalendarFeedToken();
        setCalendarFeed(feed);
        setCalendarFeedUrl(feedUrl);
        try {
          window.localStorage.setItem(CALENDAR_FEED_URL_STORAGE_KEY, feedUrl);
        } catch {
          // Ignore localStorage failures (private mode, blocked storage)
        }
        toast.message("calendar feed url generated");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to rotate calendar feed token.";
        toast.error(message);
      }
    });
  };

  const clearLocalCalendarFeedUrl = () => {
    setCalendarFeedUrl(null);
    try {
      window.localStorage.removeItem(CALENDAR_FEED_URL_STORAGE_KEY);
    } catch {
      // Ignore localStorage failures (private mode, blocked storage)
    }
    toast.message("local calendar feed url cleared");
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
              <SidebarGroupLabel>focus</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/?view=zen" prefetch={false} />}
                      className="group-data-[collapsible=icon]:justify-center"
                    >
                      <span className="group-data-[collapsible=icon]:hidden">
                        zen
                      </span>
                      <span className="hidden group-data-[collapsible=icon]:inline">
                        t
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/?view=today" prefetch={false} />}
                      className="group-data-[collapsible=icon]:justify-center"
                    >
                      <span className="group-data-[collapsible=icon]:hidden">
                        today
                      </span>
                      <span className="hidden group-data-[collapsible=icon]:inline">
                        {"\\"}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/?view=upcoming" prefetch={false} />}
                      className="group-data-[collapsible=icon]:justify-center"
                    >
                      <span className="group-data-[collapsible=icon]:hidden">
                        upcoming
                      </span>
                      <span className="hidden group-data-[collapsible=icon]:inline">
                        /
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={<Link href="/?view=archive" prefetch={false} />}
                      className="group-data-[collapsible=icon]:justify-center"
                    >
                      <span className="group-data-[collapsible=icon]:hidden">
                        archive
                      </span>
                      <span className="hidden group-data-[collapsible=icon]:inline">
                        [
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive
                      render={<Link href="/settings" prefetch={false} />}
                      className="group-data-[collapsible=icon]:justify-center"
                    >
                      <span className="group-data-[collapsible=icon]:hidden">
                        settings
                      </span>
                      <span className="hidden group-data-[collapsible=icon]:inline">
                        ]
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-h-dvh flex flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center border-b bg-background px-4 md:px-6">
            <div className="flex items-center gap-2">
              <SidebarTrigger
                className="md:hidden"
                size="icon-sm"
                variant="ghost"
              />
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
                    <ToggleGroupItem
                      value="zen"
                      className={PICKER_ITEM_CLASS}
                    >
                      zen
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="today"
                      className={PICKER_ITEM_CLASS}
                    >
                      today
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="upcoming"
                      className={PICKER_ITEM_CLASS}
                    >
                      upcoming
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="archive"
                      className={PICKER_ITEM_CLASS}
                    >
                      archive
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    prompt autofocus
                  </p>
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

                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    time-block notifications
                  </p>
                  <ToggleGroup
                    multiple={false}
                    value={[timeBlockNotificationsEnabled ? "on" : "off"]}
                    onValueChange={setTimeBlockNotificationsFromGroup}
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
              <p className="text-sm">ai scheduling</p>
              <p className="mt-1 text-xs text-muted-foreground">
                configure your availability so scheduling stays realistic.
              </p>

              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    availability notes for ai scheduling
                  </p>
                  <textarea
                    value={availabilityNotes}
                    onChange={(event) =>
                      setAvailabilityNotes(event.target.value.slice(0, 640))
                    }
                    className="min-h-20 w-full max-w-xl rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-ring"
                    placeholder={DEFAULT_AVAILABILITY_NOTES}
                    disabled={!hasHydratedPreferences}
                  />
                </div>
              </div>
            </section>

            <section className="border-b px-4 py-4 md:px-6">
              <p className="text-sm">api keys</p>
              <p className="mt-1 text-xs text-muted-foreground">
                create keys for cli usage. keys are shown once and only hashed
                values are stored.
              </p>

              <div className="mt-3 flex max-w-xl flex-wrap items-center gap-1.5">
                <input
                  value={keyName}
                  onChange={(event) =>
                    setKeyName(event.target.value.slice(0, 64))
                  }
                  className="h-7 w-44 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                  placeholder="key name"
                />
                <ToggleGroup
                  multiple={false}
                  value={[keyPermission]}
                  onValueChange={(values) => {
                    const nextPermission = values[0];
                    if (
                      nextPermission === "read" ||
                      nextPermission === "write" ||
                      nextPermission === "both"
                    ) {
                      setKeyPermission(nextPermission);
                    }
                  }}
                  variant="default"
                  size="sm"
                >
                  <ToggleGroupItem value="both" className={PICKER_ITEM_CLASS}>
                    both
                  </ToggleGroupItem>
                  <ToggleGroupItem value="read" className={PICKER_ITEM_CLASS}>
                    read
                  </ToggleGroupItem>
                  <ToggleGroupItem value="write" className={PICKER_ITEM_CLASS}>
                    write
                  </ToggleGroupItem>
                </ToggleGroup>
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
                  <p className="text-[11px] text-muted-foreground">
                    copy now. this value will not be shown again.
                  </p>
                  <code className="break-all text-xs">{createdApiKey}</code>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-auto"
                      onClick={copyCreatedApiKey}
                    >
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
                  <p className="text-xs text-muted-foreground">
                    loading keys...
                  </p>
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
                        <p className="text-muted-foreground">
                          {key.prefix}_...{key.last4} / {key.permission}
                        </p>
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
              <p className="text-sm">calendar sync (ics)</p>
              <p className="mt-1 text-xs text-muted-foreground">
                subscribe from calendar via url. this is read-only and updates are cached for about 5 minutes on ibx.
              </p>

              <div className="mt-3 flex max-w-xl flex-wrap items-center gap-1.5">
                <input
                  value="calendar-feed"
                  readOnly
                  className="h-7 w-44 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground outline-none"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-auto"
                  onClick={rotateCalendarFeed}
                  disabled={isRotatingCalendarFeed}
                >
                  {isRotatingCalendarFeed ? "generating..." : "generate / rotate url"}
                </Button>
              </div>

              {calendarFeedUrl ? (
                <div className="mt-3 flex max-w-xl flex-col gap-2 rounded-md border border-input p-2">
                  <p className="text-[11px] text-muted-foreground">
                    copy now. keep this private.
                  </p>
                  <code className="break-all text-xs">{calendarFeedUrl}</code>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-auto"
                      onClick={() =>
                        void copyToClipboard(calendarFeedUrl, "calendar feed url copied")
                      }
                    >
                      copy url
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-auto"
                      onClick={clearLocalCalendarFeedUrl}
                    >
                      hide
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex max-w-xl flex-col gap-1.5">
                {!calendarFeed ? (
                  <p className="text-xs text-muted-foreground">no feed yet</p>
                ) : (
                  <div className="flex items-center justify-between rounded-md border border-input px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <p>{calendarFeed.name}</p>
                      <p className="text-muted-foreground">
                        {calendarFeed.prefix}_...{calendarFeed.last4} / read
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-auto"
                      onClick={rotateCalendarFeed}
                      disabled={isRotatingCalendarFeed}
                    >
                      {isRotatingCalendarFeed ? "rotating..." : "rotate"}
                    </Button>
                  </div>
                )}
              </div>

            </section>

            <section className="border-b px-4 py-4 md:px-6">
              <p className="text-sm">install</p>
              <p className="mt-1 text-xs text-muted-foreground">
                quick access to cli and apple shortcut install links.
              </p>

              <div className="mt-3 flex max-w-xl flex-col gap-3">
                <div className="rounded-md border border-input p-2">
                  <p className="text-xs text-muted-foreground">
                    google calendar ics install
                  </p>
                  <code className="mt-1 block break-all text-xs">
                    https://calendar.google.com/calendar/u/0/r/settings/addbyurl
                  </code>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {calendarFeedUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-auto"
                        onClick={() =>
                          void copyToClipboard(
                            calendarFeedUrl,
                            "calendar feed url copied",
                          )
                        }
                      >
                        copy feed url
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-auto"
                        onClick={rotateCalendarFeed}
                        disabled={isRotatingCalendarFeed}
                      >
                        {isRotatingCalendarFeed
                          ? "generating..."
                          : "generate feed url"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-input p-2">
                  <p className="text-xs text-muted-foreground">
                    cli install command
                  </p>
                  <code className="mt-1 block break-all text-xs">
                    {CLI_INSTALL_COMMAND}
                  </code>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-auto"
                      onClick={() =>
                        void copyToClipboard(
                          CLI_INSTALL_COMMAND,
                          "CLI install command copied",
                        )
                      }
                    >
                      copy command
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-input p-2">
                  <p className="text-xs text-muted-foreground">
                    apple shortcut install link
                  </p>
                  <code className="mt-1 block break-all text-xs">
                    {SHORTCUT_INSTALL_URL}
                  </code>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-auto"
                      onClick={() =>
                        window.open(
                          SHORTCUT_INSTALL_URL,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      open link
                    </Button>
                  </div>
                </div>
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
