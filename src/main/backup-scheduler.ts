import { localDateKey } from './backup-service'

const backupHour = 2
const retryDelayMs = 15 * 60 * 1000
const checkIntervalMs = 60 * 1000

interface BackupSchedulerService {
  getStatus(): { destinationPath: string | null }
  getLastAutomaticDate(): string | null
  runAutomatic(): Promise<unknown>
}

interface BackupSchedulerOptions {
  now?: () => Date
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
}

export function isAutomaticBackupDue(now: Date, lastAutomaticDate: string | null): boolean {
  return now.getHours() >= backupHour && localDateKey(now) !== lastAutomaticDate
}

export function createBackupScheduler(
  service: BackupSchedulerService,
  options: BackupSchedulerOptions = {}
) {
  const now = options.now ?? (() => new Date())
  const setIntervalFn = options.setInterval ?? setInterval
  const clearIntervalFn = options.clearInterval ?? clearInterval
  let interval: ReturnType<typeof setInterval> | undefined
  let retryAfter = 0
  let running = false

  async function checkNow(): Promise<void> {
    const currentTime = now()
    if (
      running ||
      !service.getStatus().destinationPath ||
      !isAutomaticBackupDue(currentTime, service.getLastAutomaticDate()) ||
      currentTime.getTime() < retryAfter
    ) {
      return
    }

    running = true
    try {
      await service.runAutomatic()
      retryAfter = 0
    } catch {
      retryAfter = now().getTime() + retryDelayMs
    } finally {
      running = false
    }
  }

  function start(): void {
    if (interval) return
    interval = setIntervalFn(() => void checkNow(), checkIntervalMs)
    void checkNow()
  }

  function destinationChanged(): void {
    retryAfter = 0
    void checkNow()
  }

  function stop(): void {
    if (interval) clearIntervalFn(interval)
    interval = undefined
  }

  return { start, stop, checkNow, destinationChanged }
}
