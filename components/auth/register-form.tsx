// Register form: username/password (+ optional email, full name) against the
// backend /register endpoint. On success the account is created and the form
// signs the visitor in automatically (the backend issues tokens only at
// /login, so we call login() with the same credentials).

import { TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

export function RegisterForm() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }

    setError(null);

    if (!USERNAME_RE.test(username.trim())) {
      setError("Username may only contain letters, numbers and underscores.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          email: email.trim() || null,
          full_name: fullName.trim() || null,
        }),
      });

      if (!res.ok) {
        let detail = "Registration failed. Please try again.";
        try {
          const data = (await res.json()) as { detail?: string };
          if (data.detail) {
            detail = data.detail;
          }
        } catch {
          // non-JSON error body — keep the default message
        }
        throw new Error(detail);
      }

      // Account created — sign in with the same credentials.
      await login(username.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
      setPending(false);
    }
  };

  const invalid = error !== null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Register to chat with your own account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invalid ? (
          <Alert variant="destructive" className="mb-4">
            <TriangleAlertIcon data-icon="inline-start" />
            <AlertTitle>Registration failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="register-username">Username</FieldLabel>
              <Input
                id="register-username"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="johndoe"
                minLength={3}
                maxLength={32}
                pattern={USERNAME_RE.source}
                autoFocus
                required
                aria-invalid={invalid || undefined}
              />
              <FieldDescription>
                Letters, numbers and underscores only.
              </FieldDescription>
            </Field>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="register-password">Password</FieldLabel>
              <Input
                id="register-password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                minLength={8}
                maxLength={128}
                required
                aria-invalid={invalid || undefined}
              />
              <FieldDescription>At least 8 characters.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="register-email">
                Email{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Input
                id="register-email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="johndoe@example.com"
                maxLength={254}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="register-full-name">
                Full name{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Input
                id="register-full-name"
                name="full_name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                placeholder="John Doe"
                maxLength={100}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" className="mt-4 w-full" disabled={pending}>
            {pending ? (
              <>
                <Spinner data-icon="inline-start" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-xs text-muted-foreground">
          Already have an account?{" "}
          <a
            className="font-medium text-foreground underline underline-offset-2"
            href="/login"
          >
            Sign in
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
