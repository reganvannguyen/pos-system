import initialSchema from './migrations/001_initial_schema.sql?raw'
import type { PosDatabase } from './types'

interface Migration {
  version: number
  sql: string
}

const migrations: Migration[] = [{ version: 1, sql: initialSchema }]

export function runMigrations(database: PosDatabase): void {
  let currentVersion = database.pragma('user_version', { simple: true }) as number
  const latestVersion = migrations.at(-1)?.version ?? 0

  if (currentVersion > latestVersion) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this app supports (${latestVersion}).`
    )
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue
    if (migration.version !== currentVersion + 1) {
      throw new Error(`Missing migration for database schema version ${currentVersion + 1}.`)
    }

    database.transaction(() => {
      database.exec(migration.sql)
      database.pragma(`user_version = ${migration.version}`)
    })()

    currentVersion = migration.version
  }
}
