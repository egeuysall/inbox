"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError, apiClient } from "@/lib/apiClient";

type LoginScreenProps = {
  onAuthenticated: () => void;
};

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const describeLoginError = (submitError: unknown) => {
    if (submitError instanceof ApiError) {
      if (submitError.status === 429 && submitError.retryAfterSeconds) {
        const retryAfterMinutes = Math.ceil(submitError.retryAfterSeconds / 60);
        if (retryAfterMinutes <= 1) {
          return "Too many attempts. Try again in about a minute.";
        }

        return `Too many attempts. Try again in about ${retryAfterMinutes} minutes.`;
      }

      if (submitError.isTimeout) {
        return "Sign-in timed out. Check your connection and try again.";
      }

      if (submitError.isNetworkError) {
        return "Cannot reach the server. Check your network and try again.";
      }

      return submitError.message;
    }

    if (submitError instanceof Error) {
      return submitError.message;
    }

    return "Unable to sign in.";
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!password) {
      setError("Password is required.");
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      await apiClient.login(password);
      onAuthenticated();
    } catch (submitError) {
      setError(describeLoginError(submitError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <section className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl border bg-card p-6">
        <header className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{"///"} access</p>
          <h1 className="text-xl font-medium tracking-tight">Enter access key</h1>
          <p className="text-sm text-muted-foreground">
            This workspace is private. The key is remembered on this device.
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <FieldSet>
            <FieldGroup>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="access-key">Access key</FieldLabel>
                <Input
                  id="access-key"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <FieldDescription>Stored only as a signed session cookie.</FieldDescription>
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
            </FieldGroup>
          </FieldSet>

          <Button type="submit" disabled={isPending}>
            {isPending ? "Checking..." : "> continue"}
          </Button>
        </form>
      </div>
    </section>
  );
}
