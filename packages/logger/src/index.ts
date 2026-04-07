import { pino } from 'pino'
import type { Logger } from 'pino'

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

export function logger(service: string): Logger {
  return pino({
    level,
    name: service,
  })
}

export type { Logger }
