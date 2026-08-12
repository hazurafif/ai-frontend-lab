"use client";

import {
  DatabaseIcon,
  FileIcon,
  FileUpIcon,
  PlusIcon,
  TrashIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeBaseFile,
  type KnowledgeBase,
  normalizeSkillName,
  type SettingsState,
  SKILL_NAME_RE,
  updateKnowledgeBase,
  uploadKnowledgeBaseFiles,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function toFileMeta(file: File): KnowledgeBase["files"][number] {
  return { name: file.name, size: file.size, type: file.type };
}

export function KnowledgeBaseTab({
  settings,
  setSettings,
  backendOnline,
}: {
  settings: SettingsState;
  setSettings: (updater: (current: SettingsState) => SettingsState) => void;
  backendOnline: boolean;
}) {
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [draft, setDraft] = useState<KnowledgeBase | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [saving, setSaving] = useState(false);
  const [uploadingKb, setUploadingKb] = useState<string | null>(null);

  const openNew = () => {
    const fresh: KnowledgeBase = {
      name: "",
      description: "",
      files: [],
      updatedAt: new Date().toISOString(),
    };
    setDraft(fresh);
    setPendingFiles([]);
    setNameError(null);
    setFileError(null);
    setEditing(fresh);
  };

  const openEdit = (kb: KnowledgeBase) => {
    setDraft({ ...kb, files: [...kb.files] });
    setPendingFiles([]);
    setNameError(null);
    setFileError(null);
    setEditing(kb);
  };

  const validateFiles = (files: File[]): File | null => {
    return files.find((file) => file.size > MAX_FILE_SIZE) ?? null;
  };

  const addPendingFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setFileError(null);
    const list = Array.from(files);
    const oversized = validateFiles(list);
    if (oversized) {
      setFileError(
        `"${oversized.name}" exceeds the ${formatBytes(MAX_FILE_SIZE)} limit.`,
      );
      return;
    }
    setPendingFiles((current) => [...current, ...list]);
  };

  const applyKbUpdate = (
    name: string,
    patch: (kb: KnowledgeBase) => KnowledgeBase,
  ) => {
    setSettings((current) => ({
      ...current,
      knowledgeBases: current.knowledgeBases.map((kb) =>
        kb.name === name ? patch(kb) : kb,
      ),
    }));
  };

  // Create / edit name+description, then upload the files picked in the dialog.
  const save = async () => {
    if (!draft) {
      return;
    }
    const name = normalizeSkillName(draft.name.trim());
    if (!SKILL_NAME_RE.test(name)) {
      setNameError(
        "Use lowercase letters, numbers, and hyphens (e.g. company-policies).",
      );
      return;
    }
    const originalName = editing?.name ?? "";
    const kb: KnowledgeBase = {
      name,
      description: draft.description.trim(),
      files: [...(editing?.files ?? []), ...pendingFiles.map(toFileMeta)],
      updatedAt: new Date().toISOString(),
    };
    const isNew = !settings.knowledgeBases.some((k) => k.name === originalName);
    setSaving(true);
    try {
      if (backendOnline) {
        if (isNew) {
          await createKnowledgeBase({ name, description: kb.description });
        } else {
          await updateKnowledgeBase(originalName, {
            name,
            description: kb.description,
          });
          if (originalName !== name) {
            // Backend PUT keys the entry by body.name — drop the stale key.
            await deleteKnowledgeBase(originalName);
          }
        }
        if (pendingFiles.length > 0) {
          await uploadKnowledgeBaseFiles(name, pendingFiles);
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save knowledge base",
      );
      setSaving(false);
      return;
    }
    setSettings((current) => {
      const rest = current.knowledgeBases.filter(
        (k) => k.name !== originalName,
      );
      const exists = rest.some((k) => k.name === name);
      return {
        ...current,
        knowledgeBases: exists
          ? rest.map((k) => (k.name === name ? kb : k))
          : [...rest, kb],
      };
    });
    setSaving(false);
    setEditing(null);
    toast.success(
      backendOnline
        ? "Knowledge base saved to backend"
        : "Knowledge base saved locally (backend offline)",
    );
  };

  const deleteKb = async (name: string) => {
    try {
      if (backendOnline) {
        await deleteKnowledgeBase(name);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete knowledge base",
      );
      return;
    }
    setSettings((current) => ({
      ...current,
      knowledgeBases: current.knowledgeBases.filter((k) => k.name !== name),
    }));
    toast.success(
      backendOnline
        ? "Knowledge base deleted"
        : "Knowledge base deleted locally (backend offline)",
    );
  };

  // "Add files" on an existing KB card — uploads immediately.
  const addFiles = async (name: string, files: File[]) => {
    if (files.length === 0) {
      return;
    }
    const oversized = validateFiles(files);
    if (oversized) {
      toast.error(
        `"${oversized.name}" exceeds the ${formatBytes(MAX_FILE_SIZE)} limit.`,
      );
      return;
    }
    setUploadingKb(name);
    try {
      if (backendOnline) {
        await uploadKnowledgeBaseFiles(name, files);
      }
      applyKbUpdate(name, (kb) => ({
        ...kb,
        files: [...kb.files, ...files.map(toFileMeta)],
        updatedAt: new Date().toISOString(),
      }));
      toast.success(
        backendOnline
          ? "Files uploaded"
          : "Files added locally (backend offline)",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload files",
      );
    } finally {
      setUploadingKb(null);
    }
  };

  const removeFile = async (kbName: string, fileName: string) => {
    try {
      if (backendOnline) {
        await deleteKnowledgeBaseFile(kbName, fileName);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete file",
      );
      return;
    }
    applyKbUpdate(kbName, (kb) => ({
      ...kb,
      files: kb.files.filter((file) => file.name !== fileName),
      updatedAt: new Date().toISOString(),
    }));
    toast.success(
      backendOnline ? "File deleted" : "File deleted locally (backend offline)",
    );
  };

  const isEditingExisting =
    editing !== null &&
    settings.knowledgeBases.some((k) => k.name === editing.name);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          Documents the agent can consult (RAG). Files are uploaded to the
          backend and referenced on the next run; the client never stores file
          content.
        </p>
        <Button size="sm" variant="secondary" onClick={openNew}>
          <PlusIcon data-icon="inline-start" />
          New knowledge base
        </Button>
      </div>

      {settings.knowledgeBases.length === 0 && (
        <Card className="text-[13px] text-muted-foreground">
          No knowledge base yet — create one and upload documents the agent
          should know about.
        </Card>
      )}

      {settings.knowledgeBases.map((kb) => (
        <Card key={kb.name} className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{kb.name}</span>
                <Badge variant="outline">knowledge base</Badge>
                {kb.files.length > 0 && (
                  <>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {kb.files.length} file{kb.files.length > 1 ? "s" : ""}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {formatBytes(
                        kb.files.reduce((sum, file) => sum + file.size, 0),
                      )}
                    </Badge>
                  </>
                )}
              </div>
              {kb.description && (
                <p className="text-[13px] text-muted-foreground">
                  {kb.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => openEdit(kb)}>
                Edit
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${kb.name}`}
                onClick={() => deleteKb(kb.name)}
              >
                <TrashIcon data-icon="inline-start" />
              </Button>
            </div>
          </div>

          {kb.files.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {kb.files.map((file) => (
                <div
                  key={file.name}
                  className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5"
                >
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {file.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Delete ${file.name}`}
                    onClick={() => removeFile(kb.name, file.name)}
                  >
                    <XIcon data-icon="inline-start" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={uploadingKb === kb.name}
              onClick={() =>
                document.getElementById(`kb-file-${kb.name}`)?.click()
              }
            >
              {uploadingKb === kb.name ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileUpIcon data-icon="inline-start" />
              )}
              {uploadingKb === kb.name ? "Uploading…" : "Add files"}
            </Button>
            <input
              id={`kb-file-${kb.name}`}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(kb.name, Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            {uploadingKb === kb.name && (
              <span className="text-[12px] text-muted-foreground">
                Uploading to backend…
              </span>
            )}
          </div>
        </Card>
      ))}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditingExisting ? "Edit knowledge base" : "New knowledge base"}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor="kb-name">Name</FieldLabel>
              <Input
                id="kb-name"
                value={draft?.name ?? ""}
                onChange={(e) => {
                  setNameError(null);
                  setDraft((d) => (d ? { ...d, name: e.target.value } : d));
                }}
                placeholder="e.g. company-policies"
                aria-invalid={nameError ? true : undefined}
              />
              <FieldDescription>
                The backend key the agent references: lowercase letters,
                numbers, and hyphens.
              </FieldDescription>
              {nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="kb-description">Description</FieldLabel>
              <Input
                id="kb-description"
                value={draft?.description ?? ""}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, description: e.target.value } : d,
                  )
                }
                placeholder="What documents does this knowledge base contain?"
              />
            </Field>
            <Field data-invalid={fileError ? true : undefined}>
              <FieldLabel>Files</FieldLabel>
              <button
                type="button"
                aria-label="Upload files"
                className={cn(
                  "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors duration-150",
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-border/70 hover:border-foreground/30",
                )}
                onClick={() =>
                  document.getElementById("kb-dialog-file-input")?.click()
                }
                onDragEnter={(e) => {
                  e.preventDefault();
                  dragCounter.current += 1;
                  setDragOver(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={(e) => {
                  e.preventDefault();
                  dragCounter.current -= 1;
                  if (dragCounter.current <= 0) {
                    dragCounter.current = 0;
                    setDragOver(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dragCounter.current = 0;
                  setDragOver(false);
                  addPendingFiles(e.dataTransfer.files);
                }}
              >
                <UploadCloudIcon className="size-6 text-muted-foreground" />
                <p className="text-[13px] text-muted-foreground">
                  Drag &amp; drop files here, or{" "}
                  <span className="font-medium text-foreground underline underline-offset-2">
                    browse
                  </span>
                </p>
                <p className="text-[12px] text-muted-foreground">
                  PDF, DOCX, TXT, MD… up to {formatBytes(MAX_FILE_SIZE)} each
                </p>
              </button>
              <input
                id="kb-dialog-file-input"
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPendingFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {pendingFiles.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {pendingFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5"
                    >
                      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                        {file.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setPendingFiles((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <XIcon data-icon="inline-start" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <FieldDescription>
                {isEditingExisting
                  ? "Add more documents — already stored files stay untouched."
                  : "Uploaded to the backend when you save."}
              </FieldDescription>
              {fileError && <FieldError>{fileError}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Spinner data-icon="inline-start" />}
              {saving ? "Saving…" : "Save knowledge base"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
