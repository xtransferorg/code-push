import express from 'express'
import { AppError, ErrorCode } from '../core/app-error'
import { i18n } from '../core/i18n'
import { checkToken, Req } from '../core/middleware'
import { clientManager } from '../core/services/client-manager'

export const indexRouter = express.Router()

indexRouter.get('/', (req, res) => {
  res.render('index', { title: 'CodePushServer' })
})

indexRouter.get('/tokens', (req, res) => {
  // eslint-disable-next-line no-underscore-dangle
  res.render('tokens', { title: `${i18n.__('Obtain')} token` })
})

indexRouter.get(
  '/updateCheck',
  async (
    req: Req<
      void,
      void,
      {
        deploymentKey: string
        appVersion: string
        label: string
        packageHash: string
        clientUniqueId: string
        basePackageHash: string
        commonHash?: string
      }
    >,
    res,
    next,
  ) => {
    const { logger, query } = req
    logger.info('updateCheck', {
      query: JSON.stringify(query),
    })
    const {
      deploymentKey,
      appVersion,
      label = '',
      packageHash,
      clientUniqueId,
      basePackageHash: builtInPackageHash,
      commonHash,
    } = query

    try {
      const rs = await clientManager.updateCheckForClient({
        deploymentKey: deploymentKey!,
        appVersion: appVersion!,
        label,
        packageHash: packageHash!,
        clientUniqueId: clientUniqueId!,
        builtInPackageHash: builtInPackageHash!,
        commonHash,
        logger,
      })
      logger.info('updateCheck success')
      res.send({ updateInfo: rs })
    } catch (e) {
      if (e instanceof AppError) {
        logger.info('updateCheck failed', {
          error: e.message,
        })
        res.status(404).send(e.message)
      } else {
        next(e)
      }
    }
  },
)

indexRouter.post(
  '/batchUpdateCheck',
  async (
    req: Req<
      void,
      {
        appVersion: string
        clientUniqueId: string
        items: Array<{
          deploymentKey: string
          label?: string
          packageHash?: string
          basePackageHash?: string
          commonHash?: string
        }>
      },
      void
    >,
    res,
    next,
  ) => {
    const { logger, body } = req
    logger.info('batchUpdateCheck', { itemCount: body?.items?.length })
    const { appVersion, clientUniqueId, items } = body

    if (!appVersion || !clientUniqueId) {
      return res.status(400).send('appVersion 和 clientUniqueId 不能为空')
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).send('items 不能为空')
    }
    if (items.length > 20) {
      return res.status(400).send('items 数量不能超过 20')
    }

    try {
      const results = await Promise.allSettled(
        items.map((item) =>
          clientManager.updateCheckForClient({
            deploymentKey: item.deploymentKey,
            appVersion,
            label: item.label ?? '',
            packageHash: item.packageHash ?? '',
            clientUniqueId,
            // basePackageHash 为接口入参名，对应内部字段 builtInPackageHash（内置包 hash），非必传
            builtInPackageHash: item.basePackageHash ?? '',
            commonHash: item.commonHash,
            logger,
          }),
        ),
      )

      const updateInfos = results.map((result, index) => {
        if (result.status === 'rejected') {
          logger.error('batchUpdateCheck item failed', {
            deploymentKey: items[index].deploymentKey,
            error: result.reason,
          })
        }
        return {
          deploymentKey: items[index].deploymentKey,
          updateInfo: result.status === 'fulfilled' ? result.value : null,
        }
      })

      res.send({ updateInfos })
    } catch (e) {
      next(e)
    }
  },
)

indexRouter.post(
  '/reportStatus/download',
  (
    req: Req<
      void,
      {
        clientUniqueId: string
        label: string
        deploymentKey: string
      },
      void
    >,
    res,
  ) => {
    const { logger, body } = req
    logger.info('reportStatus/download', {
      body: JSON.stringify(body),
    })
    const { clientUniqueId, label, deploymentKey } = body
    clientManager
      .reportStatusDownload(deploymentKey, label, clientUniqueId)
      .catch((err) => {
        if (err instanceof AppError) {
          logger.info('reportStatus/deploy failed', {
            error: err.message,
          })
        } else {
          logger.error(err)
        }
      })
    res.send('OK')
  },
)

indexRouter.post(
  '/reportStatus/deploy',
  (
    req: Req<
      void,
      {
        clientUniqueId: string
        label: string
        deploymentKey: string
      },
      void
    >,
    res,
  ) => {
    const { logger, body } = req
    logger.info('reportStatus/deploy', {
      body: JSON.stringify(body),
    })
    const { clientUniqueId, label, deploymentKey } = body
    clientManager
      .reportStatusDeploy(deploymentKey, label, clientUniqueId, req.body)
      .catch((err) => {
        if (err instanceof AppError) {
          logger.info('reportStatus/deploy failed', {
            error: err.message,
          })
        } else {
          logger.error(err)
        }
      })
    res.send('OK')
  },
)

indexRouter.get('/authenticated', checkToken, (req, res) => {
  return res.send({ authenticated: true })
})

indexRouter.get(
  '/isGray',
  async (
    req: Req<
      void,
      void,
      {
        deploymentKey: string
        appVersion: string
        label: string
      }
    >,
    res,
    next,
  ) => {
    const { logger, query } = req
    try {
      const { deploymentKey, appVersion, label } = query
      const isGray = await clientManager.isGray(
        deploymentKey,
        appVersion,
        label,
      )
      res.send({ isGray })
    } catch (e) {
      if (e instanceof AppError) {
        logger.error('check gray failed', {
          error: e.message,
        })
        res.status(500).send(e.message)
      } else {
        next(e)
      }
    }
  },
)
// node服务监控检测
indexRouter.get('/health_check', (req, res) => {
  res.status(200).json({ status: 'up' })
})
