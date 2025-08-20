import { omit } from 'lodash'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

const customFormat = winston.format.printf(
  ({ level, message, timestamp, ...metadata }) => {
    try {
      let text = message
      if (typeof message === 'object') {
        text = JSON.stringify(message)
      }
      return `${timestamp}:${level.toLocaleUpperCase()} ${process.pid} [${metadata?.requestId || 'default'}]: ${text} ${JSON.stringify(omit(metadata || {}, 'requestId'))}`
    } catch {
      return `${timestamp}:${level.toLocaleUpperCase()} ${message}`
    }
  },
)

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss,SSS',
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    customFormat,
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.colorize({ all: true }),
    }),
  ],
})

if (process.env.NODE_ENV === 'production') {
  logger.add(
    new DailyRotateFile({
      filename: '/var/data/logs/%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      createSymlink: true,
      symlinkName: 'app.log',
      maxFiles: 3,
    }),
  )
}

export type Logger = winston.Logger

export default logger
