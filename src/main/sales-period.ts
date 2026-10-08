export interface SalesDateRange {
  startInclusive: string
  endExclusive: string
  fileName: string
}

export class SalesPeriodError extends Error {
  readonly code = 'invalid-period' as const

  constructor(message: string) {
    super(message)
    this.name = 'SalesPeriodError'
  }
}

export function resolveSalesPeriod(value: unknown): SalesDateRange {
  if (!isRecord(value)) throw invalidPeriod()

  let start: Date
  let end: Date
  let fileName: string

  switch (value.type) {
    case 'day': {
      const date = parseDate(value.date)
      start = date
      end = addCalendarDays(date, 1)
      fileName = `sales-${value.date}.csv`
      break
    }
    case 'week': {
      const selectedDate = parseDate(value.date)
      start = startOfWeek(selectedDate)
      end = addCalendarDays(start, 7)
      fileName = `sales-week-of-${toLocalDateString(start)}.csv`
      break
    }
    case 'month': {
      const month = parseMonth(value.month)
      start = localDateAtMidnight(month.year, month.month - 1, 1)
      end = localDateAtMidnight(month.year, month.month, 1)
      fileName = `sales-${value.month}.csv`
      break
    }
    case 'year': {
      const year = parseYear(value.year)
      start = localDateAtMidnight(year, 0, 1)
      end = localDateAtMidnight(year + 1, 0, 1)
      fileName = `sales-${year}.csv`
      break
    }
    case 'custom': {
      const startText = value.startDate
      const endText = value.endDate
      start = parseDate(startText)
      const inclusiveEnd = parseDate(endText)
      if (start.getTime() > inclusiveEnd.getTime()) {
        throw new SalesPeriodError('The start date must be on or before the end date.')
      }
      end = addCalendarDays(inclusiveEnd, 1)
      fileName = `sales-${startText}-to-${endText}.csv`
      break
    }
    default:
      throw invalidPeriod()
  }

  return {
    startInclusive: toSqlUtcTimestamp(start),
    endExclusive: toSqlUtcTimestamp(end),
    fileName
  }
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string') throw invalidPeriod()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw invalidPeriod()

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw invalidPeriod()
  }

  const date = localDateAtMidnight(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw invalidPeriod()
  }
  return date
}

function parseMonth(value: unknown): { year: number; month: number } {
  if (typeof value !== 'string') throw invalidPeriod()
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) throw invalidPeriod()

  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 1000 || year > 9999 || month < 1 || month > 12) throw invalidPeriod()
  return { year, month }
}

function parseYear(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 9999) {
    throw invalidPeriod()
  }
  return value
}

function localDateAtMidnight(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0)
  date.setFullYear(year, monthIndex, day)
  date.setHours(0, 0, 0, 0)
  return date
}

function addCalendarDays(value: Date, days: number): Date {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfWeek(value: Date): Date {
  const date = new Date(value)
  const daysSinceMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - daysSinceMonday)
  date.setHours(0, 0, 0, 0)
  return date
}

function toLocalDateString(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0')
  const year = String(value.getFullYear()).padStart(4, '0')
  return `${year}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function toSqlUtcTimestamp(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0')
  const year = String(value.getUTCFullYear()).padStart(4, '0')
  return `${year}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
}

function invalidPeriod(): SalesPeriodError {
  return new SalesPeriodError('Choose a valid sales period.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
