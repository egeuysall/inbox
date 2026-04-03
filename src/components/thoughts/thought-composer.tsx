"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ThoughtComposerProps = {
  isOnline: boolean;
  isWorking: boolean;
  onSave: (text: string, runAi: boolean) => Promise<void>;
};

export function ThoughtComposer({ isOnline, isWorking, onSave }: ThoughtComposerProps) {
  const [rawText, setRawText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const characterCount = rawText.length;
  const canSubmit = rawText.trim().length > 0 && !isSubmitting;

  const helperText = useMemo(() => {
    if (isOnline) {
      return "Saved locally first, then synced to the backend.";
    }

    return "Offline mode: thoughts stay local and will sync automatically later.";
  }, [isOnline]);

  const submitThought = async (runAi: boolean) => {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(rawText, runAi);
      setRawText("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 border-b px-4 py-4 md:px-6">
      <FieldSet>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="thought-composer">&gt; Dump your thoughts…</FieldLabel>
            <Textarea
              id="thought-composer"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Write messy notes, ideas, context, reminders..."
              rows={5}
              className="min-h-28 resize-y"
            />
            <FieldDescription>{helperText}</FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{characterCount} chars</p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canSubmit || isWorking}
            onClick={() => void submitThought(false)}
          >
            {isSubmitting ? "Saving..." : "Save"}
          </Button>

          {isOnline ? (
            <Button
              size="sm"
              disabled={!canSubmit || isWorking}
              onClick={() => void submitThought(true)}
            >
              {isSubmitting ? "Saving..." : "Save & run AI"}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button size="sm" disabled>
                  Save &amp; run AI
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                AI requires connection - your thoughts are saved locally.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </section>
  );
}
