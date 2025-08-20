import express from 'express'
import { appRouter } from './app'
import { bundleRouter } from './bundle'
import { Req, Res } from '../../core/middleware'
import logger from '../../core/logger'
import { AppError } from '../../core/app-error'

export const xrnRouter = express.Router()

xrnRouter.use('/app', appRouter)
xrnRouter.use('/bundle', bundleRouter)
xrnRouter.use((dataOrError: unknown, req: Req, res: Res, next) => {
  const thisLogger = req.logger || logger
  if (dataOrError instanceof AppError) {
    thisLogger.error(dataOrError.message)
    res.status(dataOrError.status).send({
      code: dataOrError.code,
      message: dataOrError.message,
      data: {},
    })
  } else {
    res.send({
      code: 0,
      message: 'success',
      data: dataOrError,
    })
  }
})
