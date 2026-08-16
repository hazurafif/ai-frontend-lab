"use client";

// Settings > Account: the signed-in user's profile plus self-service
// password change (POST /api/auth/users/me/password).

import { TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";
import { changeOwnPassword } from "@/lib/auth";

function ProfileCard() {
  const { user } = useAuth();

  const rows: { label: string; value: string }[] = [
    { label: "Username", value: user?.username ?? "—" },
    { label: "Full name", value: user?.full_name ?? "—" },
    { label: "Email", value: user?.email ?? "—" },
  ];

  return (
    <Card>
      <CardContent>
        <dl className="flex flex-col gap-3">
          {rows.map((row) => (
            <div
              className="flex items-center justify-between gap-4"
              key={row.label}
            >
              <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
              <dd className="truncate text-[13px] font-medium text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[13px] text-muted-foreground">Role</dt>
            <dd>
              <Badge variant={user?.role === "admin" ? "secondary" : "outline"}>
                {user?.role ?? "user"}
              </Badge>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reset = () => {
    setOldPassword("");
    setNewPassword("");
    setConfirm("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }

    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }

    setPending(true);
    try {
      await changeOwnPassword(oldPassword, newPassword);
      reset();
      toast.success("Password changed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed.");
      setPending(false);
    }
  };

  const invalid = error !== null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <span className="text-sm font-medium">Change password</span>
        {invalid ? (
          <Alert variant="destructive" className="mb-4">
            <TriangleAlertIcon data-icon="inline-start" />
            <AlertTitle>Password change failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="old-password">Current password</FieldLabel>
              <Input
                id="old-password"
                type="password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                autoComplete="current-password"
                required
                aria-invalid={invalid || undefined}
              />
            </Field>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                aria-invalid={invalid || undefined}
              />
              <FieldDescription>At least 8 characters.</FieldDescription>
            </Field>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="confirm-password">
                Confirm new password
              </FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
                aria-invalid={invalid || undefined}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" className="mt-4" disabled={pending}>
            {pending ? (
              <>
                <Spinner data-icon="inline-start" />
                Changing…
              </>
            ) : (
              "Change password"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function AccountTab() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        Your profile as registered on the backend.
      </p>
      <ProfileCard />
      <PasswordCard />
    </div>
  );
}
