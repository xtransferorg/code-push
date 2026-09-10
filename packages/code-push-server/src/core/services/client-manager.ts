import { Logger } from '../logger'
import _, { isEmpty } from 'lodash'
import { Op } from 'sequelize'
import { Apps } from '../../models/apps'
import { Deployments } from '../../models/deployments'
import { DeploymentsVersions } from '../../models/deployments_versions'
import { LogReportDeploy } from '../../models/log_report_deploy'
import { LogReportDownload } from '../../models/log_report_download'
import { Packages } from '../../models/packages'
import { PackagesDiff } from '../../models/packages_diff'
import { PackagesMetrics } from '../../models/packages_metrics'
import { AppError } from '../app-error'
import { config } from '../config'
import {
  DELIVERY_TYPE_DYNAMIC,
  DEPLOYMENT_FAILED,
  DEPLOYMENT_SUCCEEDED,
  IOS,
  IS_DISABLED_NO,
  PATCH_FAILED,
  PATCH_SUCCEEDED,
  RELEASE_METHOD_PROMOTE,
  RELEASE_METHOD_UPLOAD,
} from '../const'
import { parseVersion, getBlobDownloadUrl } from '../utils/common'
import { redisClient } from '../utils/connections'
import { Releases } from '../../models/releases'
import { appManager } from './app-manager'

const UPDATE_CHECK = 'UPDATE_CHECK'
const CHOSEN_MAN = 'CHOSEN_MAN'
const EXPIRED = 600

interface DiffInfo {
  downloadDiffUrl: string
  downloadDiffSize: number
  isDiffAvailable: boolean
}

interface UpdateCheckInfo {
  packageId: number
  downloadDiffUrl: string
  downloadDiffSize: number
  isDiffAvailable: boolean
  currentPackageDiff: DiffInfo
  downloadURL: string
  downloadUrl: string
  description: string
  isAvailable: boolean
  isDisabled: boolean
  isMandatory: boolean
  appVersion: string
  targetBinaryRange: string
  packageHash: string
  label: string
  originalLabel: string
  packageSize: number
  updateAppVersion: boolean
  shouldRunBinaryVersion: boolean
  rollout: number
  whiteList: string
  channelReleaseId: number
  releaseId: number
  basePackageHash: string
  baseDownloadUrl: string
  basePackageSize: number
}

class ClientManager {
  private getUpdateCheckCacheKey(
    deploymentKey,
    appVersion,
    label,
    packageHash,
  ) {
    return [UPDATE_CHECK, deploymentKey, appVersion, label, packageHash].join(
      ':',
    )
  }

  clearUpdateCheckCache(
    deploymentKey,
    appVersion,
    label,
    packageHash,
    logger: Logger,
  ) {
    logger.info('clear cache Deployments key', {
      key: deploymentKey,
    })
    const redisCacheKey = this.getUpdateCheckCacheKey(
      deploymentKey,
      appVersion,
      label,
      packageHash,
    )
    return redisClient.keys(redisCacheKey).then((data) => {
      if (_.isArray(data)) {
        return Promise.all(
          data.map((key) => {
            return redisClient.del(key)
          }),
        )
      }
      return null
    })
  }

  updateCheckFromCache(
    deploymentKey: string,
    appVersion: string,
    label: string,
    packageHash: string,
    previousRelease = false,
    builtInPackageHash = '',
    commonHash: string = '',
    logger: Logger,
  ) {
    if (!config.common.updateCheckCache) {
      return this.updateCheck(
        deploymentKey,
        appVersion,
        label,
        packageHash,
        previousRelease,
        builtInPackageHash,
        commonHash,
        logger,
      )
    }
    const redisCacheKey = this.getUpdateCheckCacheKey(
      deploymentKey,
      appVersion,
      label,
      packageHash,
    )
    return redisClient.get(redisCacheKey).then((data) => {
      if (data) {
        try {
          logger.debug('updateCheckFromCache read from cache')
          const obj = JSON.parse(data) as UpdateCheckInfo
          return obj
        } catch (e) {
          // do nothing
        }
      }
      return this.updateCheck(
        deploymentKey,
        appVersion,
        label,
        packageHash,
        previousRelease,
        builtInPackageHash,
        commonHash,
        logger,
      ).then((rs) => {
        try {
          logger.debug('updateCheckFromCache read from db')
          const strRs = JSON.stringify(rs)
          redisClient.setEx(redisCacheKey, EXPIRED, strRs)
        } catch (e) {
          // do nothing
        }
        return rs
      })
    })
  }

  private getChosenManCacheKey(packageId, rollout, clientUniqueId) {
    return [CHOSEN_MAN, packageId, rollout, clientUniqueId].join(':')
  }

  private random(rollout) {
    const r = Math.ceil(Math.random() * 10000)
    if (r < rollout * 100) {
      return Promise.resolve(true)
    }
    return Promise.resolve(false)
  }

  private hexToDecimal(hexString: string) {
    const decimalValue = parseInt(hexString, 16)
    return Math.min(100, Math.max(0, Math.floor(decimalValue % 101)))
  }

  private isInCanaryRelease(
    clientUniqueId,
    channelReleaseId: string,
    rollout: number,
  ) {
    if (isEmpty(clientUniqueId) || isEmpty(channelReleaseId)) {
      return Promise.resolve(false)
    }
    const idSuffix = channelReleaseId + clientUniqueId.slice(-2)
    const numericValue = this.hexToDecimal(idSuffix)
    return Promise.resolve(numericValue < rollout)
  }

  chosenMan(
    packageId,
    rollout,
    whiteList: string,
    channelReleaseId: number,
    clientUniqueId: string,
  ) {
    if (rollout >= 100) {
      return Promise.resolve(true)
    }
    const whiteLists = whiteList ? whiteList.split(',') : []
    if (whiteLists.includes(clientUniqueId)) {
      return Promise.resolve(true)
    }
    const rolloutClientUniqueIdCache = _.get(
      config,
      'common.rolloutClientUniqueIdCache',
      false,
    )
    if (rolloutClientUniqueIdCache === false) {
      return this.isInCanaryRelease(
        clientUniqueId,
        String(channelReleaseId),
        rollout,
      )
    }
    const redisCacheKey = this.getChosenManCacheKey(
      packageId,
      rollout,
      clientUniqueId,
    )
    return redisClient.get(redisCacheKey).then((data) => {
      if (data === '1') {
        return true
      }
      if (data === '2') {
        return false
      }
      return this.isInCanaryRelease(
        clientUniqueId,
        String(channelReleaseId),
        rollout,
      ).then((r) => {
        return redisClient
          .setEx(redisCacheKey, 60 * 60 * 24 * 7, r ? '1' : '2')
          .then(() => {
            return r
          })
      })
    })
  }

  // eslint-disable-next-line max-lines-per-function
  private async updateCheck(
    deploymentKey: string,
    appVersion: string,
    label: string,
    packageHash: string,
    previousRelease = false,
    builtInPackageHash: string = '',
    commonHash: string = '',
    logger: Logger,
  ) {
    if (!packageHash) {
      // 当接口中没有传递 packageHash 时，使用内置包的 hash 参与计算
      packageHash = builtInPackageHash
    }
    const rs: UpdateCheckInfo = {
      packageId: 0,
      downloadDiffUrl: '',
      downloadDiffSize: 0,
      isDiffAvailable: false,
      currentPackageDiff: {
        downloadDiffUrl: '',
        downloadDiffSize: 0,
        isDiffAvailable: false,
      },
      downloadURL: '',
      downloadUrl: '',
      description: '',
      isAvailable: false,
      isDisabled: true,
      isMandatory: false,
      appVersion,
      targetBinaryRange: '',
      packageHash: '',
      label: '',
      originalLabel: '',
      packageSize: 0,
      updateAppVersion: false,
      shouldRunBinaryVersion: false,
      rollout: 100,
      whiteList: '',
      channelReleaseId: 0,
      releaseId: 0,
      basePackageHash: '',
      baseDownloadUrl: '',
      basePackageSize: 0,
    }

    if (_.isEmpty(deploymentKey) || _.isEmpty(appVersion)) {
      return Promise.reject(
        new AppError('please input deploymentKey and appVersion'),
      )
    }

    const bundleBasePackage = await appManager.queryFirstCodepush(
      deploymentKey,
      appVersion,
    )

    if (
      bundleBasePackage &&
      bundleBasePackage.deliveryType === DELIVERY_TYPE_DYNAMIC
    ) {
      Object.assign(rs, {
        basePackageHash: bundleBasePackage.package_hash,
        baseDownloadUrl: getBlobDownloadUrl(bundleBasePackage.blob_url),
        basePackageSize: bundleBasePackage.size,
      })

      if (!builtInPackageHash) {
        builtInPackageHash = bundleBasePackage.package_hash
      }
    }

    return Deployments.findOne({ where: { deployment_key: deploymentKey } })
      .then((dep) => {
        if (_.isEmpty(dep)) {
          throw new AppError(
            'Not found deployment, check deployment key is right.',
          )
        }
        const version = parseVersion(appVersion)
        return DeploymentsVersions.findAll({
          where: {
            deployment_id: dep.id,
            min_version: { [Op.lte]: version },
            max_version: { [Op.gt]: version },
          },
        }).then((deploymentsVersionsMore) => {
          /**
           * 找到最新的版本
           *
           * 应用程序作为 v1.0.0 部署到商店。需要进行较小的更改，因此代码推送部署的目标是“1.0.0”，因为这是唯一存在的应用程序版本（无法知道应用程序的未来版本是否应该接收此部署）。
           * 现在，您将应用程序的新次要版本作为 v1.1.0 发布到商店。同样，需要进行一些小更改，并且您希望使用 v1.0.0 的用户也能获得它，因此代码推送部署的目标是“1.0.0 - 1.1.0”。
           * 根据 code-push-server 之前的实现，1.0.0 的用户将不会收到此更新。
           *
           * 还有一种情况，第一个部署的目标是“~1.0.0”，第二个部署的目标是“^1.0.0”。使用 v1.0.0 的用户将不会收到第二次更新。
           */
          const item = _.last(_.sortBy(deploymentsVersionsMore, 'created_at'))
          logger.debug({
            item,
          })
          return item
        })
      })
      .then(async (deploymentsVersions) => {
        if (!deploymentsVersions) {
          logger.info(
            `not found deployment version. key: ${deploymentKey} appVersion: ${appVersion}`,
          )
          return undefined
        }
        const deploymentsVersionId = _.get(deploymentsVersions, 'id')
        const whereCondition = {
          deployment_version_id: deploymentsVersionId,
          is_disabled: IS_DISABLED_NO,
          release_method: {
            [Op.in]: [RELEASE_METHOD_UPLOAD, RELEASE_METHOD_PROMOTE],
          },
        }
        const packagesAll = await Packages.findAll({
          where: whereCondition,
          order: [['id', 'desc']],
        })
        const labelId = Number(label.slice(1) || '')
        const isMandatory =
          // 如果是下发上一个包，那么最新的包不应该影响是否强更
          (previousRelease ? packagesAll.slice(0, -1) : packagesAll).some(
            (pkg) => {
              if (pkg.label && Number(pkg.label.slice(1) || '') > labelId) {
                return _.eq(pkg.is_mandatory, 1)
              }
              return false
            },
          )
        let packageId = _.get(deploymentsVersions, 'current_package_id', 0)
        if (previousRelease) {
          // 只有在当前用户没有命中灰度时，才会使用上一个稳定版本的包进行下发
          // 解决多 bundle 情况下，有相互依赖时某一个 bundle 正在进行灰度导致异常
          // 查找最新的两个包，按照ID进行排序，第二个就是最新稳定的包
          const whereConditionForPrevious = {
            deployment_version_id: deploymentsVersionId,
            is_disabled: IS_DISABLED_NO,
            release_method: {
              [Op.in]: [RELEASE_METHOD_UPLOAD, RELEASE_METHOD_PROMOTE],
            },
          }

          const [, packageInfo] = await Packages.findAll({
            where: whereConditionForPrevious,
            limit: 2,
            order: [['id', 'desc']],
          })
          packageId = _.get(packageInfo, 'id', 0)
        }
        if (_.eq(packageId, 0)) {
          return undefined
        }
        return Packages.findByPk(packageId)
          .then((packages) => {
            // commonHashMatched 为 true 的条件（或关系）：
            // 1. commonHash 为空
            // 2. packages.common_hash 为空
            // 3. 两者都不为空且相等
            const commonHashMatched =
              !commonHash ||
              !packages.common_hash ||
              (commonHash &&
                packages.common_hash &&
                _.eq(commonHash, packages.common_hash))

            if (
              packages &&
              _.eq(packages.deployment_id, deploymentsVersions.deployment_id) &&
              !_.eq(packages.package_hash, packageHash) &&
              commonHashMatched
            ) {
              rs.packageId = packageId
              rs.targetBinaryRange = deploymentsVersions.app_version
              rs.downloadURL = getBlobDownloadUrl(packages.blob_url)
              rs.downloadUrl = rs.downloadURL
              rs.description = _.get(packages, 'description', '')
              rs.isAvailable = !_.eq(packages.is_disabled, 1)
              rs.isDisabled = !!_.eq(packages.is_disabled, 1)
              rs.isMandatory = isMandatory || !!_.eq(packages.is_mandatory, 1)
              rs.appVersion = appVersion
              rs.packageHash = _.get(packages, 'package_hash', '')
              rs.label = _.get(packages, 'label', '')
              rs.originalLabel = _.get(packages, 'original_label', '')
              rs.packageSize = _.get(packages, 'size', 0)
              rs.releaseId = _.get(packages, 'release_id', 0)
            }
            return packages
          })
          .then((packages) => {
            if (rs.releaseId) {
              return Releases.findByPk(rs.releaseId).then((release) => {
                rs.rollout = _.get(release, 'rollout', 100)
                rs.whiteList = _.get(release, 'white_list', '')
                rs.channelReleaseId = _.get(release, 'channel_release_id', 0)
                return packages
              })
            }
            return packages
          })
          .then(async (packages) => {
            // 尝试增量更新
            let forceFullPackageOnly = false
            if (appVersion === '3.8.4') {
              const deployment = await Deployments.findOne({
                where: { deployment_key: deploymentKey },
              })
              if (deployment) {
                const app = await Apps.findByPk(deployment.appid)
                forceFullPackageOnly = !!app && app.os === IOS
              }
            }
            if (forceFullPackageOnly) {
              logger.info('命中特殊规则：iOS 3.8.4 仅返回全量包')
              return undefined
            }
            const diffTasks: Array<Promise<void>> = []
            const shouldCheckDiff =
              !_.isEmpty(packages) &&
              !_.eq(_.get(packages, 'package_hash', ''), packageHash)
            if (builtInPackageHash && shouldCheckDiff) {
              diffTasks.push(
                PackagesDiff.findOne({
                  where: {
                    package_id: packages.id,
                    diff_against_package_hash: builtInPackageHash, // 内置包的 hash
                  },
                }).then((diffPackage) => {
                  if (!_.isEmpty(diffPackage)) {
                    rs.downloadDiffUrl = getBlobDownloadUrl(
                      _.get(diffPackage, 'diff_blob_url'),
                    )
                    rs.downloadDiffSize = _.get(diffPackage, 'diff_size', 0)
                    rs.isDiffAvailable = true
                  }
                }),
              )
            }
            if (
              packageHash &&
              shouldCheckDiff &&
              builtInPackageHash !== packageHash
            ) {
              diffTasks.push(
                PackagesDiff.findOne({
                  where: {
                    package_id: packages.id,
                    diff_against_package_hash: packageHash, // 当前包的 hash
                  },
                }).then((diffPackage) => {
                  if (!_.isEmpty(diffPackage)) {
                    rs.currentPackageDiff = {
                      downloadDiffUrl: getBlobDownloadUrl(
                        _.get(diffPackage, 'diff_blob_url'),
                      ),
                      downloadDiffSize: _.get(diffPackage, 'diff_size', 0),
                      isDiffAvailable: true,
                    }
                  }
                }),
              )
            }
            if (!diffTasks.length) {
              return undefined
            }
            return Promise.all(diffTasks).then(() => {
              return undefined
            })
          })
      })
      .then(() => {
        return rs
      })
  }

  private getPackagesInfo(deploymentKey, label) {
    if (_.isEmpty(deploymentKey) || _.isEmpty(label)) {
      return Promise.reject(
        new AppError('please input deploymentKey and label'),
      )
    }
    return Deployments.findOne({ where: { deployment_key: deploymentKey } })
      .then((dep) => {
        if (_.isEmpty(dep)) {
          throw new AppError('does not found deployment')
        }
        return Packages.findOne({ where: { deployment_id: dep.id, label } })
      })
      .then((packages) => {
        if (_.isEmpty(packages)) {
          throw new AppError('does not found packages')
        }
        return packages
      })
  }

  reportStatusDownload(deploymentKey, label, clientUniqueId) {
    return this.getPackagesInfo(deploymentKey, label).then((packages) => {
      return Promise.all([
        PackagesMetrics.findOne({ where: { package_id: packages.id } }).then(
          (metrics) => {
            if (metrics) {
              return metrics.increment('downloaded')
            }
            return undefined
          },
        ),
        LogReportDownload.create({
          package_id: packages.id,
          client_unique_id: clientUniqueId,
        }),
      ])
    })
  }

  reportStatusDeploy(
    deploymentKey: string,
    label,
    clientUniqueId: string,
    others,
  ) {
    return this.getPackagesInfo(deploymentKey, label).then((packages) => {
      const statusText = _.get(others, 'status')
      let status = 0
      if (_.eq(statusText, 'DeploymentSucceeded')) {
        status = DEPLOYMENT_SUCCEEDED
      } else if (_.eq(statusText, 'DeploymentFailed')) {
        status = DEPLOYMENT_FAILED
      }
      const packageId = packages.id
      const previousDeploymentKey = _.get(others, 'previousDeploymentKey')
      const previousLabel = _.get(others, 'previousLabelOrAppVersion')
      const patchFailed = _.get(others, 'patchFailed')
      const patchStatus = _.isBoolean(patchFailed)
        ? patchFailed
          ? PATCH_FAILED
          : PATCH_SUCCEEDED
        : null
      if (status > 0) {
        return Promise.all([
          LogReportDeploy.create({
            package_id: packageId,
            client_unique_id: clientUniqueId,
            previous_label: previousLabel,
            previous_deployment_key: previousDeploymentKey,
            patch_status: patchStatus,
            status,
          }),
          PackagesMetrics.findOne({ where: { package_id: packageId } }).then(
            (metrics) => {
              if (_.isEmpty(metrics)) {
                return undefined
              }
              if (_.eq(status, DEPLOYMENT_SUCCEEDED)) {
                return metrics.increment(['installed', 'active'], { by: 1 })
              }
              return metrics.increment(['installed', 'failed'], { by: 1 })
            },
          ),
        ]).then(() => {
          if (previousDeploymentKey && previousLabel) {
            return Deployments.findOne({
              where: { deployment_key: previousDeploymentKey },
            })
              .then((dep) => {
                if (_.isEmpty(dep)) {
                  return undefined
                }
                return Packages.findOne({
                  where: { deployment_id: dep.id, label: previousLabel },
                }).then((p) => {
                  if (_.isEmpty(p)) {
                    return undefined
                  }
                  return PackagesMetrics.findOne({
                    where: { package_id: p.id },
                  })
                })
              })
              .then((metrics) => {
                if (metrics) {
                  return metrics.decrement('active')
                }
                return undefined
              })
          }
          return undefined
        })
      }
      return undefined
    })
  }

  async isGray(deploymentKey: string, appVersion: string, label: string) {
    const packageInfo = await this.getPackagesInfo(deploymentKey, label)
    if (!packageInfo) {
      return false
    }
    if (!packageInfo.release_id) {
      return false
    }
    const release = await Releases.findByPk(packageInfo.release_id)
    const rollout = _.get(release, 'rollout', 0)
    return rollout < 100 && packageInfo.is_disabled === IS_DISABLED_NO
  }

  async updateCheckAdapter(
    updateCheckInfo: Partial<{
      deploymentKey: string
      appVersion: string
      label: string
      packageHash: string
      clientUniqueId: string
      previousRelease: boolean
      builtInPackageHash: string
      commonHash: string
    }>,
    logger: Logger,
  ) {
    const {
      deploymentKey,
      appVersion,
      label = '',
      packageHash,
      clientUniqueId,
      previousRelease,
      builtInPackageHash,
      commonHash,
    } = updateCheckInfo
    let rs = await clientManager.updateCheckFromCache(
      deploymentKey,
      appVersion,
      label,
      packageHash,
      previousRelease,
      builtInPackageHash,
      commonHash,
      logger,
    )
    const isChosenCurrentPackage = await clientManager.chosenMan(
      rs.packageId,
      rs.rollout,
      rs.whiteList,
      rs.channelReleaseId,
      clientUniqueId,
    )
    if (!isChosenCurrentPackage) {
      logger.info('没有命中灰度规则，开始查找上一个稳定的包', updateCheckInfo)
      rs = await clientManager.updateCheckFromCache(
        deploymentKey,
        appVersion,
        label,
        packageHash,
        true, // 使用前一个稳定版本的包进行下发
        builtInPackageHash,
        commonHash,
        logger,
      )
      if (rs.rollout !== 100) {
        // 上一个包灰度流量不正确，应该告警。
        logger.error('查找最新稳定包失败', rs)
      }
    }
    logger.info('updateCheck success')
    return rs
  }

  async updateCheckForClient(params: {
    deploymentKey: string
    appVersion: string
    label: string
    packageHash: string
    clientUniqueId: string
    builtInPackageHash: string
    commonHash?: string
    logger: Logger
  }) {
    const { logger, ...rest } = params
    const rs = await this.updateCheckAdapter(
      {
        deploymentKey: rest.deploymentKey,
        appVersion: rest.appVersion,
        label: rest.label,
        packageHash: rest.packageHash,
        clientUniqueId: rest.clientUniqueId,
        builtInPackageHash: rest.builtInPackageHash,
        commonHash: rest.commonHash,
      },
      logger,
    )
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { packageId, rollout, whiteList, releaseId, channelReleaseId, ...publicInfo } = rs
    return publicInfo
  }
}

export const clientManager = new ClientManager()
