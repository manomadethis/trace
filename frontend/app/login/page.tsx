"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/handdrawn/Button";
import { Card } from "@/components/handdrawn/Card";
import { Input } from "@/components/handdrawn/Input";
import { login } from "@/lib/api";
import { setSession, homeRouteForRole } from "@/lib/tokens";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage(null);
    try {
      const { role } = await login(email, password);
      setSession(role, email);
      router.push(homeRouteForRole(role));
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 -rotate-2 rounded-full border-2 border-primary bg-white px-4 py-1 shadow-hard">
        <span className="text-2xl font-bold tracking-tight">TRACE</span>
      </Link>
      <Card wobble={1} decoration="tape" className="w-full">
        <h1 className="mb-2 text-3xl font-bold">Log in</h1>
        <p className="mb-6 text-lg text-gray-600">
          Sign in to see your role&apos;s view of the supply chain.
        </p>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="mb-2 block font-bold">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="admin@trace.demo"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-2 block font-bold">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {status === "error" && (
            <p role="alert" className="text-accent font-bold">
              {errorMessage}
            </p>
          )}
          <Button
            type="submit"
            variant="accent"
            className="mt-2 w-full"
            disabled={status === "loading"}
          >
            {status === "loading" ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
