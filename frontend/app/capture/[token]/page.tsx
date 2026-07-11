"use client";

import { ChangeEvent, FormEvent, use, useState } from "react";
import { Badge, type BadgeGrade } from "@/components/handdrawn/Badge";
import { Button } from "@/components/handdrawn/Button";
import { Card } from "@/components/handdrawn/Card";
import { uploadCapture, type CaptureResult } from "@/lib/api";

type CaptureState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: CaptureResult }
  | { kind: "error"; message: string };

function gradeToBadgeGrade(grade: CaptureResult["grade"]): BadgeGrade {
  if (grade === "A") return "A";
  if (grade === "B") return "B";
  return "Waste";
}

function gradeHeadline(grade: CaptureResult["grade"]): string {
  switch (grade) {
    case "A":
      return "Grade A — off to market!";
    case "B":
      return "Grade B — still sellable.";
    default:
      return "Graded Waste — routed to compost.";
  }
}

export default function CapturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<CaptureState>({ kind: "idle" });

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setState({ kind: "loading" });
    try {
      const result = await uploadCapture(token, file);
      setState({ kind: "success", result });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed. Please try again.",
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-12">
      <Card wobble={1} decoration="tack" className="w-full">
        <h1 className="mb-2 text-3xl font-bold">Grade this batch</h1>
        <p className="mb-6 text-lg text-gray-600">
          Take a photo of the produce.{" "}
          <span className="font-bold text-primary">
            Include a coin in the frame for scale.
          </span>
        </p>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            aria-label="Batch photo"
            className="w-full rounded-card border-2 border-dashed border-primary bg-paper/50 px-4 py-6 text-lg file:mr-4 file:rounded-card file:border-2 file:border-primary file:bg-white file:px-3 file:py-2 file:font-bold"
          />

          {state.kind === "error" && (
            <p role="alert" className="font-bold text-accent">
              {state.message}
            </p>
          )}

          <Button
            type="submit"
            variant="accent"
            className="mt-2 w-full"
            disabled={!file || state.kind === "loading"}
          >
            {state.kind === "loading" ? "Grading…" : "Submit photo"}
          </Button>
        </form>
      </Card>

      {state.kind === "success" && (
        <Card wobble={2} className="mt-8 w-full">
          <div className="mb-3 flex items-center gap-3">
            <Badge grade={gradeToBadgeGrade(state.result.grade)} />
          </div>
          <h2 className="mb-2 text-2xl font-bold">
            {gradeHeadline(state.result.grade)}
          </h2>
          <p className="text-lg text-gray-700">{state.result.reason}</p>
        </Card>
      )}
    </main>
  );
}
