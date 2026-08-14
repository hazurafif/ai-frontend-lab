"use client";

// Settings > Users (admin only): list, create, change role/disable state and
// delete accounts via the backend /users endpoints.

import { BanIcon, PlusIcon, TrashIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import {
  createUser,
  deleteUser,
  fetchUsers,
  type ManagedUser,
  updateUser,
} from "@/lib/users";

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

type CreateDraft = {
  username: string;
  password: string;
  email: string;
  full_name: string;
  role: "user" | "admin";
};

const EMPTY_DRAFT: CreateDraft = {
  username: "",
  password: "",
  email: "",
  full_name: "",
  role: "user",
};

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = () => {
    setDraft(EMPTY_DRAFT);
    setError(null);
    onOpenChange(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }

    setError(null);
    if (!USERNAME_RE.test(draft.username.trim())) {
      setError("Username may only contain letters, numbers and underscores.");
      return;
    }
    if (draft.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setPending(true);
    try {
      await createUser({
        username: draft.username.trim(),
        password: draft.password,
        email: draft.email.trim() || null,
        full_name: draft.full_name.trim() || null,
        role: draft.role,
      });
      toast.success(`User ${draft.username.trim()} created`);
      close();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User creation failed.");
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            Create an account; the admin role may be granted directly.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon data-icon="inline-start" />
            <AlertTitle>Creation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="user-username">Username</FieldLabel>
              <Input
                id="user-username"
                value={draft.username}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                autoComplete="off"
                minLength={3}
                maxLength={32}
                pattern={USERNAME_RE.source}
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="user-password">Password</FieldLabel>
              <Input
                id="user-password"
                type="password"
                value={draft.password}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="user-email">
                Email{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Input
                id="user-email"
                type="email"
                value={draft.email}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                autoComplete="off"
                maxLength={254}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="user-full-name">
                Full name{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Input
                id="user-full-name"
                value={draft.full_name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    full_name: event.target.value,
                  }))
                }
                autoComplete="off"
                maxLength={100}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="user-role">Role</FieldLabel>
              <Select
                value={draft.role}
                onValueChange={(role) =>
                  setDraft((current) => ({
                    ...current,
                    role: role as "user" | "admin",
                  }))
                }
              >
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Creating…
                </>
              ) : (
                "Create user"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchUsers()
      .then(setUsers)
      .catch((err) => {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load users.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRoleChange = (username: string, role: "user" | "admin") => {
    setPending(username);
    updateUser(username, { role })
      .then(() => {
        toast.success(`${username} is now ${role}`);
        refresh();
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Update failed."),
      )
      .finally(() => setPending(null));
  };

  const handleDisabledToggle = (username: string, disabled: boolean) => {
    setPending(username);
    updateUser(username, { disabled })
      .then(() => {
        toast.success(
          disabled ? `${username} disabled` : `${username} enabled`,
        );
        refresh();
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Update failed."),
      )
      .finally(() => setPending(null));
  };

  const handleDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) {
      return;
    }
    setPending(target.username);
    deleteUser(target.username)
      .then(() => {
        toast.success(`User ${target.username} deleted`);
        refresh();
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Delete failed."),
      )
      .finally(() => setPending(null));
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-sm">Users</CardTitle>
            <CardDescription>
              Manage accounts, roles and disabled state.
            </CardDescription>
          </div>
          <Button className="h-8" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New user
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : loadError ? (
            <Alert variant="destructive">
              <TriangleAlertIcon data-icon="inline-start" />
              <AlertTitle>Failed to load users</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.username}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {user.username}
                        </span>
                        {user.full_name && (
                          <span className="text-[12px] text-muted-foreground">
                            {user.full_name}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                      {user.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role ?? "user"}
                        disabled={pending === user.username}
                        onValueChange={(role) =>
                          handleRoleChange(
                            user.username,
                            role as "user" | "admin",
                          )
                        }
                      >
                        <SelectTrigger size="sm" className="h-7 w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">user</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {user.username === currentUser?.username ? (
                        <Badge variant="secondary">you</Badge>
                      ) : (
                        <Badge
                          variant={user.disabled ? "destructive" : "outline"}
                        >
                          {user.disabled ? "disabled" : "active"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {user.username !== currentUser?.username && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              handleDisabledToggle(
                                user.username,
                                !user.disabled,
                              )
                            }
                            disabled={pending === user.username}
                            aria-label={
                              user.disabled
                                ? `Enable ${user.username}`
                                : `Disable ${user.username}`
                            }
                            title={user.disabled ? "Enable" : "Disable"}
                          >
                            <BanIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(user)}
                            disabled={pending === user.username}
                            aria-label={`Delete ${user.username}`}
                          >
                            <TrashIcon />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refresh}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {deleteTarget?.username}. Their
              threads and history rows stay behind, orphaned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
