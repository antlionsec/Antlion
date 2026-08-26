// Next.js instrumentation hook — runs once when the server process boots.
// Starts the automatic backup scheduler (see src/lib/backup.ts).
// Automatic snapshots are PLAINTEXT by design: the encryption passphrase is
// never persisted, so encrypted automatic backups would be unrecoverable.
// Users who want encrypted archives use "Backup Now" / "Export" with a
// passphrase from Project Settings.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startAutoBackupScheduler } = await import("./lib/backup");
    startAutoBackupScheduler();
  } catch (e) {
    console.error("[instrumentation] failed to start backup scheduler:", e);
  }
}
