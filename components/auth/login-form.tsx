"use client";

// Login form: username + password against the backend /login endpoint.
// Base UI components only (Card, FieldGroup/Field, Input, Button, Spinner,
// Alert).

import { TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";

export function LoginForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }

    setError(null);
    setPending(true);
    try {
      await login(username.trim(), password);
      navigate(searchParams.get("next") ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setPending(false);
    }
  };

  const invalid = error !== null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>
          Sign in to your account to continue chatting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invalid ? (
          <Alert variant="destructive" className="mb-4">
            <TriangleAlertIcon data-icon="inline-start" />
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="login-username">Username</FieldLabel>
              <Input
                id="login-username"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="johndoe"
                minLength={3}
                maxLength={32}
                autoFocus
                required
                aria-invalid={invalid || undefined}
              />
            </Field>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="login-password">Password</FieldLabel>
              <Input
                id="login-password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                minLength={8}
                maxLength={128}
                required
                aria-invalid={invalid || undefined}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" className="mt-4 w-full" disabled={pending}>
            {pending ? (
              <>
                <Spinner data-icon="inline-start" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-center gap-1.5">
        <p className="text-xs text-muted-foreground">
          Demo account: <span className="font-medium">admin</span> /{" "}
          <span className="font-medium">admin</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a
            className="font-medium text-foreground underline underline-offset-2"
            href="/register"
          >
            Register
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
