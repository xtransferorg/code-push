import express from 'express'
import { checkToken, Req } from '../../core/middleware'
import { Apps } from '../../models/apps'
import { AppError, ErrorCode } from '../../core/app-error'

export const bundleRouter = express.Router()

// Bundle 查询
bundleRouter.get(
  '/query_bundle/:app_key',
  async (req: Req<{ app_key: string }>, res, next) => {
    const { app_key } = req.params
    try {
      const bundles = await Apps.findAll({ where: { native_app_key: app_key } })
      return next(
        bundles.map((bundle) => {
          return {
            os: bundle.os,
            platform: bundle.platform,
            name: bundle.name,
            port: bundle.port,
            gitUrl: bundle.repository_url,
          }
        }),
      )
    } catch (error) {
      return next(new AppError(error, ErrorCode.QUERY_ERROR, 500))
    }
  },
)
