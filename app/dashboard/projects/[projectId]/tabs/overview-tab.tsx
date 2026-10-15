"use client";

import { useEffect, useState } from "react";
import { Activity, Globe2, HardDrive, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard, MeterBar } from "@/components/stat-card";
import { useI18n } from "@/lib/i18n/client";
import { apiGet } from "@/app/console";
import type { Project } from "../types";

export function OverviewTab({ project, base }: { project: Project; base: string | null }) {
  const { t, fmt } = useI18n();
  const [storage, setStorage] = useState<{ used: number; total: number; files: number } | null>(null);
  const [visits, setVisits] = useState<number | null>(null);
  const [deployFile, setDeployFile] = useState<File | null>(null);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    void apiGet<{ used: number; total: number; files: number }>(`/api/storage/status?projectId=${project.id}`)
      .then(setStorage)
      .catch(() => setStorage({ used: 0, total: 0, files: 0 }));
    void apiGet<{ visits: number }>(`/api/visits/summary?projectId=${project.id}`)
      .then((r) => setVisits(r.visits))
      .catch(() => setVisits(0));
  }, [project.id]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("projects.stat.storage")}
          value={storage ? fmt.bytes(storage.used) : "…"}
          hint={storage ? t("overview.storage.hint", { count: fmt.number(storage.files) }) : undefined}
          icon={HardDrive}
          tone="signal"
        />
        <StatCard
          label={t("projects.stat.visits")}
          value={visits === null ? "…" : fmt.number(visits)}
          hint={t("overview.visits.hint", { count: fmt.number(project.freeVisitsPerMonth) })}
          icon={Activity}
        />
        <StatCard
          label={t("overview.url.title")}
          value={<span className="ltr-content font-mono text-sm">{base ? `${base}/` : "…"}</span>}
          hint={t("overview.url.hint")}
          icon={Globe2}
          tone="blueprint"
        />
      </div>
      {storage && storage.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("overview.cap.title")}</CardTitle>
            <CardDescription className="text-12.5px">
              {t("overview.cap.used", {
                used: fmt.bytes(storage.used),
                total: fmt.bytes(storage.total),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MeterBar value={storage.used} max={storage.total} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>{t("overview.deploy.title")}</span>
            <Upload className="h-4 w-4 text-muted-foreground" />
          </CardTitle>
          <CardDescription className="text-12.5px">
            {t("overview.deploy.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!deployFile) return;
              setDeploying(true);
              try {
                const formData = new FormData();
                formData.append("file", deployFile);
                formData.append("projectId", String(project.id));
                const res = await fetch("/api/projects/deploy", {
                  method: "POST",
                  body: formData,
                  credentials: "include",
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || data.error || "Deployment failed");
                toast.success(t("overview.deploy.success"));
                setDeployFile(null);
                void apiGet<{ used: number; total: number; files: number }>(`/api/storage/status?projectId=${project.id}`)
                  .then(setStorage);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Deployment failed");
              } finally {
                setDeploying(false);
              }
            }}
            className="flex flex-wrap items-center gap-3"
          >
            <Input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setDeployFile(e.target.files?.[0] ?? null)}
              className="w-72"
            />
            <Button type="submit" size="sm" variant="default" disabled={!deployFile || deploying}>
              <Upload className="h-3.5 w-3.5 me-1.5" />
              {deploying ? "..." : t("overview.deploy.button")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
