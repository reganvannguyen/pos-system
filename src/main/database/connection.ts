import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { runMigrations } from './migrations'
import type { PosDatabase } from './types'

export function openDatabase(databasePath: string): PosDatabase {
  mkdirSync(dirname(databasePath), { recursive: true })

  const database = new BetterSqlite3(databasePath)

  try {
    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 5000')
    database.pragma('journal_mode = WAL')
    runMigrations(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
