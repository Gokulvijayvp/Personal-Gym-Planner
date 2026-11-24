import { useCallback, useEffect, useState } from "react";
import { Database, Download } from "lucide-react";
import ErrorState from "../../components/ui/ErrorState";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../services/apiError";
import { useSession } from "../auth/session";
import { settingsService } from "../../services/settingsService";
import type { DataInfo } from "../../types/settings";
import { formatBytes, saveBlob } from "./settingsForm";

/** Read-only facts about the stored data, plus a one-click backup download. Nothing here can change or delete data. */
export default function DataManagement() {
  const toast = useToast();
  const session = useSession();
  const isAdmin = session.status === "in" && session.user.role === "admin";   // the backup is the WHOLE database, so only the admin gets it
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    settingsService.dataInfo(controller.signal)
      .then(setInfo)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [attempt]);

  const download = useCallback(async () => {
    if (downloading) return; // repeated taps never start a second download
    setDownloading(true);
    setBackupError(null);
    try {
      const { blob, filename } = await settingsService.downloadBackup();
      saveBlob(blob, filename);
      toast.success(`Backup downloaded (${filename}).`);
    } catch (e) {
      setBackupError(getErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  }, [downloading, toast]);

  return (
    <section className="panel settings-card" aria-labelledby="set-data">
      <header className="settings-card-head">
        <span className="settings-icon"><Database size={18} /></span>
        <div>
          <h2 id="set-data">Data Management</h2>
          <p>What is stored for your account{isAdmin ? ", plus server details and a backup you can keep safe" : ""}.</p>
        </div>
      </header>

      {error ? (
        <ErrorState title="Couldn't load data information" message={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !info ? (
        <div className="skeleton data-skeleton" role="status" aria-label="Loading data information" />
      ) : (
        <dl className="data-grid" aria-label="Application and database information">
          {isAdmin && info.application && (
            <>
              <div><dt>Application</dt><dd>{info.application}</dd></div>
              <div><dt>Database</dt><dd>{info.database_engine} · {formatBytes(info.database_size_bytes)}</dd></div>
              <div><dt>Schema version</dt><dd>{info.schema_version ?? "Unknown"}</dd></div>
              <div><dt>Timezone</dt><dd>{info.timezone}</dd></div>
            </>
          )}
          <div><dt>Exercises</dt><dd>{info.counts.exercises}</dd></div>
          <div><dt>Workout cycles</dt><dd>{info.counts.cycles}</dd></div>
          <div><dt>Planned days</dt><dd>{info.counts.planned_days}</dd></div>
          <div><dt>Logged workouts</dt><dd>{info.counts.workout_sessions}</dd></div>
        </dl>
      )}

      {isAdmin && info && info.database_engine !== "SQLite" && (
        <div className="backup-box">
          <h3>Backup</h3>
          <p>This server uses a managed {info.database_engine} database (AWS RDS). Its backups are automatic: use the RDS automated
            backups and snapshots in the AWS console. There is nothing to download here.</p>
        </div>
      )}
      {isAdmin && (!info || info.database_engine === "SQLite") && <div className="backup-box">
        <h3>Backup</h3>
        <p>Admin only. Downloads one file: a complete copy of the whole database (every user's data) as it is right now.</p>
        <ul>
          {(info?.backup_includes ?? [
            "Exercise Library", "Workout Cycles and Weekly Planner", "These settings",
          ]).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="hint">
          Keep it somewhere private: it holds all of your data. Restoring is a manual step for now (stop the app and
          replace the database file); there is no in-app restore or reset.
        </p>
        {backupError && <p className="form-alert" role="alert">{backupError}</p>}
        <button type="button" className="btn btn-outline" onClick={download} disabled={downloading}>
          <Download size={16} /> {downloading ? "Preparing backup…" : "Download backup"}
        </button>
      </div>}
    </section>
  );
}
