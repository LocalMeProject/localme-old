"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, Database, FolderPlus, Globe2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { StatCard, MeterBar } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiDelete, apiGet, apiPost } from "@/app/console";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface Project {
  id: number;
  name: string;
  isActive: boolean;
  freeVisitsPerMonth: number;
  createdAt: string;
}

interface StorageStatus {
  used: number;
  total: number;
  files: number;
}

interface ProjectWithUsage extends Project {
  storage: StorageStatus;
  visits: number;
}

export default function DashboardPage() {
  const { t, fmt } = useI18n();
  const [projects, setProjects] = useState<ProjectWithUsage[] | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data }, me] = await Promise.all([
        apiGet<{ data: Project[] }>("/api/projects"),
        apiGet<{ username: string | null }>("/auth/me").catch(() => ({ username: null })),
      ]);
      setUsername(me.username);
      const withUsage = await Promise.all(
        data.map(async (project) => {
          const [storage, visits] = await Promise.all([
            apiGet<StorageStatus>(`/api/storage/status?projectId=${project.id}`).catch(() => ({ used: 0, total: 0, files: 0 })),
            apiGet<{ visits: number }>(`/api/visits/summary?projectId=${project.id}`)
              .then((r) => r.visits)
              .catch(() => 0),
          ]);
          return { ...project, storage, visits };
        }),
      );
      setProjects(withUsage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projects.loadFailed"));
      setProjects([]);
    }
  }, [t]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const [createTab, setCreateTab] = useState<"empty" | "zip">("empty");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [libraryMode, setLibraryMode] = useState<"append" | "skip" | "overwrite">("append");

  const handleCreateOpenChange = (open: boolean) => {
    setCreating(open);
    if (!open) {
      setNewName("");
      setZipFile(null);
      setLibraryMode("append");
    }
  };

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiPost("/api/projects", { name: newName });
      toast.success(t("projects.create.done", { name: newName }));
      setNewName("");
      setCreating(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projects.create.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function deployZipProject(event: React.FormEvent) {
    event.preventDefault();
    if (!zipFile) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", zipFile);
      if (newName.trim()) {
        formData.append("name", newName.trim());
      }
      formData.append("libraryMode", libraryMode);
      const res = await fetch("/api/projects/deploy", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Deployment failed");
      }
      toast.success(t("projects.deploy.done", { name: data.project?.name || newName }));
      setNewName("");
      setZipFile(null);
      setLibraryMode("append");
      setCreating(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projects.create.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project: ProjectWithUsage) {
    if (!window.confirm(t("projects.delete.confirm", { name: project.name }))) return;
    try {
      await apiDelete(`/api/projects/${project.id}`);
      toast.success(t("projects.delete.done"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projects.delete.failed"));
    }
  }

  const totalStorage = (projects ?? []).reduce((sum, p) => sum + p.storage.used, 0);
  const totalFiles = (projects ?? []).reduce((sum, p) => sum + p.storage.files, 0);
  const totalVisits = (projects ?? []).reduce((sum, p) => sum + p.visits, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("projects.eyebrow")}
        title={t("projects.title")}
        description={t("projects.description")}
        actions={
          <Dialog open={creating} onOpenChange={handleCreateOpenChange}>
            <DialogTrigger asChild>
              <Button>
                <FolderPlus className="h-4 w-4" /> {t("projects.new")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("projects.create.dialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("projects.create.dialogDescription")}{" "}
                  <span className="font-mono">/{username ?? "you"}/{"{project}"}/</span>
                </DialogDescription>
              </DialogHeader>

              <Tabs value={createTab} onValueChange={(v) => setCreateTab(v as "empty" | "zip")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="empty">{t("projects.create.tabEmpty")}</TabsTrigger>
                  <TabsTrigger value="zip">{t("projects.create.tabZip")}</TabsTrigger>
                </TabsList>

                <TabsContent value="empty" className="mt-4">
                  <form onSubmit={createProject} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="project-name">{t("projects.create.nameLabel")}</Label>
                      <Input
                        id="project-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="my-app"
                        pattern="[a-z0-9][a-z0-9_-]{0,62}"
                        autoFocus
                        required
                      />
                      <p className="text-11.5px text-muted-foreground">
                        {t("projects.create.nameHint")}
                      </p>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={busy || !newName.trim()}>
                        {busy ? t("projects.create.working") : t("projects.create.submit")}
                      </Button>
                    </DialogFooter>
                  </form>
                </TabsContent>

                <TabsContent value="zip" className="mt-4">
                  <form onSubmit={deployZipProject} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="project-zip">{t("projects.create.zipLabel")}</Label>
                      <Input
                        id="project-zip"
                        type="file"
                        accept=".zip,application/zip"
                        onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                        required
                      />
                      <p className="text-11.5px text-muted-foreground">
                        {t("projects.create.zipHint")}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="project-name-opt">{t("projects.create.nameLabel")} (optional)</Label>
                      <Input
                        id="project-name-opt"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="my-app (or from localme.json)"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-12px">{t("projects.create.libraryModeLabel")}</Label>
                      <p className="text-11px text-muted-foreground">
                        {t("projects.create.libraryModeHint")}
                      </p>
                      <div className="space-y-1.5">
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors text-xs",
                            libraryMode === "append" ? "border-signal bg-signal/5" : "border-border hover:bg-muted/40",
                          )}
                        >
                          <input
                            type="radio"
                            name="libraryMode"
                            value="append"
                            checked={libraryMode === "append"}
                            onChange={() => setLibraryMode("append")}
                            className="mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <div className="font-medium text-foreground">{t("backup.conflict.append")}</div>
                            <div className="text-11px text-muted-foreground">{t("backup.conflict.appendDesc")}</div>
                          </div>
                        </label>

                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors text-xs",
                            libraryMode === "skip" ? "border-signal bg-signal/5" : "border-border hover:bg-muted/40",
                          )}
                        >
                          <input
                            type="radio"
                            name="libraryMode"
                            value="skip"
                            checked={libraryMode === "skip"}
                            onChange={() => setLibraryMode("skip")}
                            className="mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <div className="font-medium text-foreground">{t("backup.conflict.skip")}</div>
                            <div className="text-11px text-muted-foreground">{t("backup.conflict.skipDesc")}</div>
                          </div>
                        </label>

                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors text-xs",
                            libraryMode === "overwrite" ? "border-signal bg-signal/5" : "border-border hover:bg-muted/40",
                          )}
                        >
                          <input
                            type="radio"
                            name="libraryMode"
                            value="overwrite"
                            checked={libraryMode === "overwrite"}
                            onChange={() => setLibraryMode("overwrite")}
                            className="mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <div className="font-medium text-destructive">{t("backup.conflict.overwrite")}</div>
                            <div className="text-11px text-muted-foreground">{t("backup.conflict.overwriteDesc")}</div>
                          </div>
                        </label>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={busy || !zipFile}>
                        {busy ? t("projects.create.zipWorking") : t("projects.create.zipSubmit")}
                      </Button>
                    </DialogFooter>
                  </form>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("projects.stat.storage")}
          value={fmt.bytes(totalStorage)}
          hint={t("projects.stat.storageHint", { count: fmt.number(totalFiles) })}
          icon={HardDrive}
          tone="signal"
        />
        <StatCard
          label={t("projects.stat.visits")}
          value={fmt.number(totalVisits)}
          hint={t("projects.stat.visitsHint")}
          icon={Activity}
        />
        <StatCard
          label={t("projects.stat.count")}
          value={projects ? fmt.number(projects.length) : "…"}
          hint={t("projects.stat.countHint")}
          icon={Database}
          tone="blueprint"
        />
      </div>

      <section>
        <SectionHeader title={t("projects.section.title")} description={t("projects.section.description")} />
        {projects === null ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={Globe2}
            title={t("projects.empty.title")}
            description={t("projects.empty.description")}
            action={
              <Button onClick={() => setCreating(true)}>
                <FolderPlus className="h-4 w-4" /> {t("projects.empty.action")}
              </Button>
            }
          />
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <div key={project.id} className="panel p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/projects/${project.id}`}
                        className="truncate text-base font-semibold tracking-tight hover:text-signal"
                      >
                        {project.name}
                      </Link>
                      <Badge variant={project.isActive ? "default" : "outline"}>
                        {project.isActive ? t("projects.badge.live") : t("projects.badge.suspended")}
                      </Badge>
                    </div>
                    <div className="mt-1 font-mono text-11.5px text-muted-foreground">
                      /{username ?? "…"}/{project.name}/
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void removeProject(project)}
                  >
                    {t("action.delete")}
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between text-11.5px text-muted-foreground">
                      <span>{t("projects.meter.storage")}</span>
                      <span className="nums">
                        {fmt.bytes(project.storage.used)} / {fmt.bytes(project.storage.total || 5_242_880)}
                      </span>
                    </div>
                    <MeterBar value={project.storage.used} max={project.storage.total || 5_242_880} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-11.5px text-muted-foreground">
                      <span>{t("projects.meter.visits")}</span>
                      <span className="nums">
                        {fmt.number(project.visits)} / {fmt.number(project.freeVisitsPerMonth)}
                      </span>
                    </div>
                    <MeterBar value={project.visits} max={project.freeVisitsPerMonth} tone="blueprint" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/projects/${project.id}`}>{t("projects.openWorkspace")}</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <a
                      href={username ? `/${username}/${project.name}/` : "#"}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled={!username}
                    >
                      {t("projects.viewLive")}
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
