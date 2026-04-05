"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LocalThought, TodoItem } from "@/lib/types";

type TodosPanelProps = {
  selectedThought: LocalThought | null;
  todos: TodoItem[];
  onAdd: (
    externalId: string,
    title: string,
    notes: string | null,
  ) => Promise<void>;
  onToggle: (
    externalId: string,
    todoId: string,
    status: "open" | "done",
  ) => Promise<void>;
};

export function TodosPanel({
  selectedThought,
  todos,
  onAdd,
  onToggle,
}: TodosPanelProps) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedThought || !title.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onAdd(
        selectedThought.externalId,
        title.trim(),
        notes.trim() || null,
      );
      setTitle("");
      setNotes("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <p className="text-sm">Todos from this thought</p>
        <p className="text-xs text-muted-foreground">
          {selectedThought ? todos.length : 0}
        </p>
      </header>
      <Separator />

      {!selectedThought ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Select a thought</EmptyTitle>
              <EmptyDescription>
                Pick an item from ibx to view and manage generated todos.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <>
          <form
            onSubmit={submitTodo}
            className="flex flex-col gap-3 border-b px-4 py-4 md:px-6"
          >
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="todo-title">
                    &gt; Add manual todo
                  </FieldLabel>
                  <Input
                    id="todo-title"
                    placeholder="Short actionable title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <FieldDescription>
                    Add quick items even before running AI.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="todo-notes">Notes (optional)</FieldLabel>
                  <Textarea
                    id="todo-notes"
                    rows={3}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Context, links, or next steps"
                  />
                </Field>
              </FieldGroup>
            </FieldSet>

            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || !title.trim()}
              >
                Add todo
              </Button>
            </div>
          </form>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {todos.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No todos yet</EmptyTitle>
                    <EmptyDescription>
                      Run AI or add one manually.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : (
              todos.map((todo) => (
                <div
                  key={todo.id}
                  className="flex flex-col gap-2 border-b px-4 py-3 md:px-6"
                >
                  <div className="flex items-start gap-3">
                    <Field orientation="horizontal" className="w-auto pt-0.5">
                      <Switch
                        checked={todo.status === "done"}
                        onCheckedChange={() =>
                          void onToggle(
                            selectedThought.externalId,
                            todo.id,
                            todo.status,
                          )
                        }
                        id={`todo-${todo.id}`}
                        aria-label={`Mark ${todo.title} as ${todo.status === "done" ? "open" : "done"}`}
                      />
                    </Field>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label
                        htmlFor={`todo-${todo.id}`}
                        className={cn(
                          "text-sm leading-relaxed lowercase",
                          todo.status === "done"
                            ? "text-muted-foreground line-through"
                            : "text-foreground",
                        )}
                      >
                        {todo.title}
                      </label>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {todo.status === "done" ? "done" : "open"}
                      </p>

                      {todo.notes ? (
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer select-none">
                            notes
                          </summary>
                          <p className="mt-1 whitespace-pre-wrap lowercase">
                            {todo.notes}
                          </p>
                        </details>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
