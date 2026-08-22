import {
  DatabaseIcon,
  DownloadIcon,
  FileIcon,
  FileUpIcon,
  FolderUpIcon,
  PlusIcon,
  RefreshCcwIcon,
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
  backendDocumentToKnowledgeBaseDocument,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeBaseFile,
  fetchKnowledgeBaseDocuments,
  KB_NAME_RE,
  type KnowledgeBase,
  type KnowledgeBaseDocument,
  knowledgeBaseDocumentUrl,
  reindexKnowledgeBase,
  type SettingsState,
  updateKnowledgeBase,
  uploadKnowledgeBaseFiles,
} from "@/lib/settings";
import { cn, generateUUID } from "@/lib/utils";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file (backend default)

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

function DocumentStatusBadge({ doc }: { doc: KnowledgeBaseDocument }) {
  if (doc.status === "failed") {
    return (
      <Badge variant="destructive" title={doc.error ?? undefined}>
        Failed
      </Badge>
    );
  }
  if (doc.status === "ready") {
    return <Badge variant="outline">Ready</Badge>;
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {doc.status === "processing" ? "Processing" : "Pending"}
    </Badge>
  );
}

// Local-only metadata for offline mode (backend unreachable): documents get
// synthetic ids and stay "pending" until a backend sync exists.
function toLocalDocument(file: File): KnowledgeBaseDocument {
  return {
    id: generateUUID(),
    path: file.webkitRelativePath || file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    status: "pending",
    error: null,
    chunkCount: 0,
  };
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
  const [reindexingKb, setReindexingKb] = useState<string | null>(null);

  const openNew = () => {
    const fresh: KnowledgeBase = {
      id: generateUUID(),
      name: "",
      description: "",
      documents: [],
      updatedAt: new Date().toISOString(),
    };
    setDraft(fresh);
    setPendingFiles([]);
    setNameError(null);
    setFileError(null);
    setEditing(fresh);
  };

  const openEdit = (kb: KnowledgeBase) => {
    setDraft({ ...kb, documents: [...kb.documents] });
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
    id: string,
    patch: (kb: KnowledgeBase) => KnowledgeBase,
  ) => {
    setSettings((current) => ({
      ...current,
      knowledgeBases: current.knowledgeBases.map((kb) =>
        kb.id === id ? patch(kb) : kb,
      ),
    }));
  };

  // Refresh one KB's documents from the backend (ingest statuses change
  // after upload/reindex). Returns the mapped list for callers that also
  // need it synchronously.
  const loadDocuments = async (
    kbId: string,
  ): Promise<KnowledgeBaseDocument[]> => {
    try {
      const docs = await fetchKnowledgeBaseDocuments(kbId);
      return docs.map(backendDocumentToKnowledgeBaseDocument);
    } catch {
      return [];
    }
  };

  // Upload files and surface per-file failures (unsupported extension,
  // quota, parse error). The backend ingests synchronously and reports
  // each file individually.
  const uploadWithResults = async (kbId: string, files: File[]) => {
    const paths = files.map((file) => file.webkitRelativePath || file.name);
    const results = await uploadKnowledgeBaseFiles(kbId, files, paths);
    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      const shown = failed.slice(0, 4);
      const more = failed.length - shown.length;
      toast.warning(
        `${failed.length} of ${results.length} file${results.length > 1 ? "s" : ""} failed to upload: ${shown.map((result) => `${result.path} (${result.error ?? "unknown error"})`).join(", ")}${more > 0 ? ` +${more} more` : ""}`,
      );
    }
  };

  // Create / edit name+description, then upload the files picked in the dialog.
  const save = async () => {
    if (!draft) {
      return;
    }
    const name = draft.name.trim();
    if (!KB_NAME_RE.test(name)) {
      setNameError(
        "Use letters, numbers, spaces, dots, dashes, or underscores (max 64 characters).",
      );
      return;
    }
    const original = editing
      ? (settings.knowledgeBases.find((k) => k.id === editing.id) ?? null)
      : null;
    const description = draft.description.trim();
    let kbId = draft.id;
    setSaving(true);
    try {
      if (backendOnline) {
        if (!original) {
          const created = await createKnowledgeBase({ name, description });
          kbId = created.id;
        } else {
          const updated = await updateKnowledgeBase(original.id, {
            name,
            description,
          });
          kbId = updated.id;
        }
        if (pendingFiles.length > 0) {
          await uploadWithResults(kbId, pendingFiles);
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
    // When online, documents come from the backend (fresh ingest status);
    // offline keeps the local metadata only.
    const documents = backendOnline
      ? await loadDocuments(kbId)
      : [...(original?.documents ?? []), ...pendingFiles.map(toLocalDocument)];
    setSettings((current) => {
      const rest = current.knowledgeBases.filter((k) => k.id !== original?.id);
      const exists = rest.some((k) => k.id === kbId);
      const kb: KnowledgeBase = {
        id: kbId,
        name,
        description,
        documents,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...current,
        knowledgeBases: exists
          ? rest.map((k) => (k.id === kbId ? kb : k))
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

  const deleteKb = async (id: string) => {
    try {
      if (backendOnline) {
        await deleteKnowledgeBase(id);
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
      knowledgeBases: current.knowledgeBases.filter((kb) => kb.id !== id),
    }));
    toast.success(
      backendOnline
        ? "Knowledge base deleted"
        : "Knowledge base deleted locally (backend offline)",
    );
  };

  // "Add files" on an existing KB card — uploads immediately.
  const addFiles = async (id: string, files: File[]) => {
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
    setUploadingKb(id);
    try {
      if (backendOnline) {
        await uploadWithResults(id, files);
        const documents = await loadDocuments(id);
        applyKbUpdate(id, (kb) => ({
          ...kb,
          documents,
          updatedAt: new Date().toISOString(),
        }));
        toast.success("Files uploaded");
      } else {
        applyKbUpdate(id, (kb) => ({
          ...kb,
          documents: [...kb.documents, ...files.map(toLocalDocument)],
          updatedAt: new Date().toISOString(),
        }));
        toast.success("Files added locally (backend offline)");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload files",
      );
    } finally {
      setUploadingKb(null);
    }
  };

  const removeDocument = async (kbId: string, docId: string) => {
    try {
      if (backendOnline) {
        await deleteKnowledgeBaseFile(kbId, docId);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete document",
      );
      return;
    }
    applyKbUpdate(kbId, (kb) => ({
      ...kb,
      documents: kb.documents.filter((doc) => doc.id !== docId),
      updatedAt: new Date().toISOString(),
    }));
    toast.success(
      backendOnline
        ? "Document deleted"
        : "Document deleted locally (backend offline)",
    );
  };

  // Re-parse + re-embed every document (e.g. after an embedding-model change
  // or to retry failed ingests).
  const reindex = async (kb: KnowledgeBase) => {
    if (!backendOnline) {
      toast.error("Reindex needs the backend.");
      return;
    }
    setReindexingKb(kb.id);
    try {
      await reindexKnowledgeBase(kb.id);
      const documents = await loadDocuments(kb.id);
      applyKbUpdate(kb.id, (current) => ({
        ...current,
        documents,
        updatedAt: new Date().toISOString(),
      }));
      toast.success("Knowledge base reindexed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reindex failed");
    } finally {
      setReindexingKb(null);
    }
  };

  const isEditingExisting =
    editing !== null &&
    settings.knowledgeBases.some((k) => k.id === editing.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          Documents the agent can consult (RAG).
        </p>
        <Button size="sm" variant="secondary" onClick={openNew}>
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
      </div>

      {settings.knowledgeBases.length === 0 && (
        <Card className="text-[13px] text-muted-foreground">
          No knowledge base yet.
        </Card>
      )}

      {settings.knowledgeBases.map((kb) => (
        <Card key={kb.id} className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{kb.name}</span>
                <Badge variant="outline">knowledge base</Badge>
                {kb.documents.length > 0 && (
                  <>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {kb.documents.length} doc
                      {kb.documents.length > 1 ? "s" : ""}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {formatBytes(
                        kb.documents.reduce(
                          (sum, doc) => sum + doc.sizeBytes,
                          0,
                        ),
                      )}
                    </Badge>
                    {kb.documents.some((doc) => doc.status === "failed") && (
                      <Badge variant="destructive">
                        {
                          kb.documents.filter((doc) => doc.status === "failed")
                            .length
                        }{" "}
                        failed
                      </Badge>
                    )}
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
              <Button
                size="sm"
                variant="ghost"
                disabled={reindexingKb === kb.id}
                onClick={() => reindex(kb)}
              >
                {reindexingKb === kb.id ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCcwIcon data-icon="inline-start" />
                )}
                Reindex
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openEdit(kb)}>
                Edit
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${kb.name}`}
                onClick={() => deleteKb(kb.id)}
              >
                <TrashIcon data-icon="inline-start" />
              </Button>
            </div>
          </div>

          {kb.documents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {kb.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5"
                >
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[12px]"
                    title={doc.path}
                  >
                    {doc.path}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatBytes(doc.sizeBytes)}
                  </span>
                  {doc.status === "ready" && doc.chunkCount > 0 && (
                    <Badge
                      variant="outline"
                      className="font-mono text-[11px]"
                      title={`${doc.chunkCount} chunks indexed`}
                    >
                      {doc.chunkCount} chunk{doc.chunkCount > 1 ? "s" : ""}
                    </Badge>
                  )}
                  <DocumentStatusBadge doc={doc} />
                  {backendOnline && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Open ${doc.path}`}
                      render={
                        <a
                          href={knowledgeBaseDocumentUrl(kb.id, doc.id)}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      <DownloadIcon data-icon="inline-start" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Delete ${doc.path}`}
                    onClick={() => removeDocument(kb.id, doc.id)}
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
              disabled={uploadingKb === kb.id}
              onClick={() =>
                document.getElementById(`kb-file-${kb.id}`)?.click()
              }
            >
              {uploadingKb === kb.id ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileUpIcon data-icon="inline-start" />
              )}
              {uploadingKb === kb.id ? "Uploading…" : "Add files"}
            </Button>
            <input
              id={`kb-file-${kb.id}`}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(kb.id, Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            {uploadingKb === kb.id && (
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
        <DialogContent className="sm:max-w-2xl max-h-[85dvh] overflow-y-auto">
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
                placeholder="e.g. Company Policies"
                aria-invalid={nameError ? true : undefined}
              />
              <FieldDescription>
                Letters, numbers, spaces, dots, dashes, underscores (max 64
                chars).
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
                placeholder="What&apos;s in this knowledge base?"
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
                  PDF, DOCX, TXT, MD, code… up to {formatBytes(MAX_FILE_SIZE)}{" "}
                  each
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
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() =>
                    document.getElementById("kb-dialog-folder-input")?.click()
                  }
                >
                  <FolderUpIcon data-icon="inline-start" />
                  Upload a folder
                </Button>
                <span className="text-[12px] text-muted-foreground">
                  Subfolders are preserved.
                </span>
              </div>
              <input
                id="kb-dialog-folder-input"
                type="file"
                multiple
                className="hidden"
                {...({
                  webkitdirectory: "",
                } as React.InputHTMLAttributes<HTMLInputElement>)}
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
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[12px]"
                        title={file.webkitRelativePath || file.name}
                      >
                        {file.webkitRelativePath || file.name}
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
                  ? "Add documents; already stored files stay untouched."
                  : "Uploaded and ingested when you save."}
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
