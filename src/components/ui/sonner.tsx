"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      icons={{ success: null, info: null, warning: null, error: null, loading: null }}
      style={
        {
          "--normal-bg": "var(--background)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--background)",
          "--success-text": "var(--foreground)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--background)",
          "--error-text": "var(--foreground)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--background)",
          "--warning-text": "var(--foreground)",
          "--warning-border": "var(--border)",
          "--info-bg": "var(--background)",
          "--info-text": "var(--foreground)",
          "--info-border": "var(--border)",
        } as Record<string, string>
      }
      toastOptions={{
        classNames: {
          toast: "border border-border bg-background text-foreground shadow-none",
          title: "text-foreground",
          description: "text-muted-foreground",
          success: "border-border bg-background text-foreground",
          error: "border-border bg-background text-foreground",
          warning: "border-border bg-background text-foreground",
          info: "border-border bg-background text-foreground",
        },
      }}
      {...props}
    />
  );
}
