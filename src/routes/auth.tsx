import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Clapperboard, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

const searchSchema = z.object({
  mode: z.enum(["login", "signup"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Clipfy" },
      { name: "description", content: "Sign in or create your Clipfy account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode: initialMode, redirect } = Route.useSearch();
  const [mode, setMode] = useState<"login" | "signup">(initialMode ?? "login");
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const destination = isSafeRedirect(redirect) ? redirect! : "/app/dashboard";

  // If already signed in, bounce.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        navigate({ to: destination, replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [destination, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${destination}`,
            data: { full_name: name },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      navigate({ to: destination, replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        const msg =
          result.error instanceof Error ? result.error.message : String(result.error);
        toast.error(msg);
        return;
      }
      if (result.redirected) return; // browser is navigating away
      // Popup flow: tokens set, session ready
      navigate({ to: destination, replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* Left — visual */}
      <div className="relative hidden overflow-hidden border-r border-border bg-white/[0.02] lg:block">
        <div className="pointer-events-none absolute -top-40 -left-40 size-[500px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Clapperboard className="size-4" strokeWidth={2.5} />
            </div>
            <span className="text-xl font-extrabold tracking-tighter">CLIPFY</span>
          </Link>

          <div className="max-w-md">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-primary">
              // Editorial console
            </div>
            <h2 className="mb-6 text-balance text-4xl font-extrabold leading-tight tracking-tight">
              Turn raw footage into <span className="italic text-primary">viral currency.</span>
            </h2>
            <p className="text-muted-foreground">
              AI-scored clips, karaoke captions, and one-click render for TikTok, Reels, and
              Shorts.
            </p>
          </div>

          <div className="font-mono text-xs text-muted-foreground">
            © {new Date().getFullYear()} Clipfy Labs
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link to="/" className="inline-flex items-center gap-2">
              <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <Clapperboard className="size-4" strokeWidth={2.5} />
              </div>
              <span className="text-lg font-extrabold tracking-tighter">CLIPFY</span>
            </Link>
          </div>

          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            {mode === "login" ? "// Access" : "// New account"}
          </div>
          <h1 className="mb-2 text-3xl font-extrabold tracking-tight">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            {mode === "login"
              ? "Sign in to keep clipping."
              : "Start with 60 free credits. No card required."}
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "login" && (
                  <button
                    type="button"
                    className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
                    onClick={async () => {
                      if (!email) {
                        toast("Enter your email first");
                        return;
                      }
                      const { error } = await supabase.auth.resetPasswordForEmail(email, {
                        redirectTo: `${window.location.origin}/reset-password`,
                      });
                      if (error) toast.error(error.message);
                      else toast.success("Reset link sent");
                    }}
                  >
                    Forgot?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            <Button
              type="submit"
              className="w-full rounded-xl font-extrabold"
              size="lg"
              disabled={loading}
            >
              {loading ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              or
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full rounded-xl border-border bg-transparent font-semibold"
            size="lg"
            onClick={onGoogle}
            disabled={googleLoading}
          >
            <svg className="mr-2 size-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09A6.98 6.98 0 0 1 5.47 12c0-.73.13-1.43.36-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
              />
            </svg>
            {googleLoading ? "Opening Google..." : "Continue with Google"}
          </Button>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            {mode === "login" ? "New to Clipfy? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="font-semibold text-primary hover:underline"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function isSafeRedirect(value: string | undefined): value is string {
  return !!value && value.startsWith("/") && !value.startsWith("//");
}
