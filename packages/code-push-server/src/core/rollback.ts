import { PackagesInterface } from '../models/packages'
import { AppError } from './app-error'
import { accountManager } from './services/account-manager'
import { clientManager } from './services/client-manager'
import { deploymentsManager } from './services/deployments-manager'
import { packageManager } from './services/package-manager'
import { delay } from './utils/common'
import { config } from './config'
import _ from 'lodash'
import type { Transaction } from 'sequelize'

export async function rollback(
  req: {
    params: {
      appName: string
      deploymentName: string
      label?: string
      deploymentVersionId?: number
      rollbackUuid?: string
    }
    logger: any
    users: { id: number }
  },
  t?: Transaction,
) {
  const { logger, params } = req
  const appName = _.trim(params.appName)
  const deploymentName = _.trim(params.deploymentName)
  const targetLabel = _.trim(params.label)
  const rollbackUuid = _.trim(params.rollbackUuid)
  const uid = req.users.id
  logger.info('try to rollback', {
    uid,
    appName,
    deploymentName,
    targetLabel,
    deploymentVersionId: params.deploymentVersionId,
  })
  const col = await accountManager.collaboratorCan(uid, appName, logger)
  const dep = await deploymentsManager.findDeploymentByName(
    deploymentName,
    col.appid,
    logger,
  )
  if (!dep) {
    throw new AppError('can not find deployment')
  }
  const packageInfo = await packageManager.rollbackPackage(
    params.deploymentVersionId || dep.last_deployment_version_id,
    targetLabel,
    uid,
    logger,
    rollbackUuid,
    t,
  )
  if (packageInfo) {
    delay(1000).then(() => {
      return packageManager
        .generateDiffWithRollback(dep.appid, packageInfo, logger)
        .catch((e) => {
          logger.error(e)
        })
    })
  }
  // clear cache if exists.
  if (config.common.updateCheckCache) {
    delay(2500).then(() => {
      logger.info('try clear update check cache')
      return clientManager.clearUpdateCheckCache(
        dep.deployment_key,
        '*',
        '*',
        '*',
        logger,
      )
    })
  }
  return packageInfo
}
