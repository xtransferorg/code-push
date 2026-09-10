import {
  BaseLineFileType,
  NativeAppType,
  SystemType,
  BundlePlatformMapType,
  UpdateType,
  NativeAppVersionStatus,
} from '@xrnjs/code-push-core'
import fs from 'fs'
import path from 'path'
import semver from 'semver'
import { Logger } from '../logger'
import { NativeBaseline, BaseLineInterface } from '../../models/native_baseline'
import { uploadFileToStorage } from '../utils/storage'
import { qetag } from '../utils/qetag'
import { sequelize } from '../utils/connections'
import { AppError, ErrorCode } from '../app-error'
import { Op, Transaction } from 'sequelize'
import {
  getBlobDownloadUrl,
  getBundleOsTypeString,
  validatorVersion,
} from '../utils/common'
import {
  AppMeta,
  AppsVersionMetaInterface,
} from '../../models/app_version_meta'
import { findCollaboratorsByAppNameAndUid } from '../../models/collaborators'
import { deploymentsManager } from './deployments-manager'
import { packageManager } from './package-manager'
import { Deployments } from '../../models/deployments'
import { Apps } from '../../models/apps'
import {
  NativeAppVersions,
  NativeAppVersionsInterface,
} from '../../models/native_app_versions'
import { DeploymentsVersions } from '../../models/deployments_versions'
import {
  APP_REVIEW_STATUS_RELEASED,
  APP_REVIEW_STATUS_AUDIT_PASSED,
  PRODUCTION,
} from '../const'
import { AppTypeEnum } from '../../config/system-config'
import { NativeApps } from '../../models/native_apps'

export const BASELINE_DIR_NAME = 'baselineTemp'

const SystemTypeMap = {
  [BundlePlatformMapType.ANDROID]: SystemType.ANDROID,
  [BundlePlatformMapType.IOS]: SystemType.IOS,
  [BundlePlatformMapType.HARMONY]: SystemType.HARMONY,
}
class BaselineManager {
  /**
   * 创建原生基线文件记录
   * @param extractedPath 解压后的文件路径
   * @param logger 日志记录器
   * @returns Promise<BaseLineInterface[]>
   */
  async createNativeBaseline(
    extractedPath: string,
    appMetaId: number,
    platform: string,
    versionName: string,
    uid: number = 0,
    env: string = '',
    logger: Logger,
  ): Promise<BaseLineInterface[]> {
    const transaction = await sequelize.transaction()
    const updatedRecords: BaseLineInterface[] = []

    const historyBaselines = await NativeBaseline.findAll({
      where: {
        app_meta_id: appMetaId,
      },
    })

    logger.info('Found history baselines', {
      appMetaId,
      count: historyBaselines.length,
      baselines: historyBaselines.map((b) => ({
        id: b.id,
        file_name: b.file_name,
        file_size: b.file_size,
        file_type: b.file_type,
        url: b.url,
      })),
    })

    let deploymentVersionId: number | null = null

    try {
      const files = await this.getAllFiles(extractedPath)
      logger.info('Found files for baseline processing', {
        count: files.length,
      })

      for (const filePath of files) {
        const {
          fileType,
          fileHash,
          coverable,
          fileSize,
          appName: _appName,
        } = this.getFileMeta(filePath, extractedPath)

        // null的情况是：上传了meta中没有记录的文件，这些文件不需要被处理
        if (fileType == null) {
          continue
        }

        if (!fileType) {
          throw new AppError(
            'FileType not found',
            ErrorCode.PARAMS_INVALID,
            400,
          )
        }

        logger.info('Processing file', { filePath, fileType })
        // 生成etag作为key
        const key = await qetag(filePath, logger)
        const fileName = path.relative(
          path.resolve(extractedPath, BASELINE_DIR_NAME),
          filePath,
        )

        logger.info('Looking for existing baseline', {
          fileName,
          fileType,
          key,
        })

        // 当fileType为DIFF时，从文件路径中提取appName（目录名称）
        const appName =
          _appName ||
          this.extractAppNameFromPath(filePath, extractedPath, fileType, logger)

        if (BaseLineFileType.BASE_PACKAGE === fileType && appName) {
          deploymentVersionId = await this.findOrCreateDevelopmentVersion(
            versionName,
            platform,
            uid,
            transaction,
            appName,
            env,
            logger,
          )
        }

        const historyBaseline = historyBaselines.find(
          (item) => item.file_type === fileType && item.file_name === fileName,
        )

        if (historyBaseline) {
          if (!coverable) {
            // 基线不可覆盖的场景目前是：动态bundle的首次对客热更新后，不允许再覆盖
            logger.info('File is not coverable, skipping', { fileName })
            continue
          }

          if (historyBaseline.url !== key) {
            // 有历史数据，但是etag变了，需要重新上传文件
            await uploadFileToStorage(key, filePath, logger)
          }

          await NativeBaseline.update(
            {
              url: key,
              app_meta_id: appMetaId,
              deployment_version_id: deploymentVersionId,
              file_name: fileName,
              file_hash: fileHash,
              file_type: fileType,
              file_size: fileSize,
            },
            {
              where: {
                id: historyBaseline.id,
              },
              transaction,
            },
          )
        } else {
          // 没有历史数据，是新增文件
          await uploadFileToStorage(key, filePath, logger)
          const record = await NativeBaseline.create(
            {
              app_meta_id: appMetaId,
              deployment_version_id: deploymentVersionId,
              url: key,
              file_name: fileName,
              file_hash: fileHash,
              file_type: fileType,
              file_size: fileSize,
            },
            { transaction },
          )
          updatedRecords.push(record)
        }
      }

      await transaction.commit()
      const updateRecords = await NativeBaseline.findAll({
        where: {
          app_meta_id: appMetaId,
        },
      })

      return updateRecords
    } catch (error) {
      await transaction.rollback()
      logger.error('Baseline processing failed, transaction rolled back', error)
      throw new AppError(
        `Failed to process baseline: ${error.message}`,
        ErrorCode.UPDATE_ERROR,
        500,
      )
    }
  }

  async findOrCreateAppMeta(
    meta: {
      platform: string
      version_name: string
      core_version: string
      cli_version?: string
      version_number: number
      min_supported_version: string
      app_type: NativeAppType
    },
    logger,
  ) {
    try {
      const {
        platform,
        version_name,
        core_version,
        cli_version = '',
        version_number,
        min_supported_version,
        app_type = NativeAppType.RELEASE,
      } = meta

      // platform、version_name、app_type 构成唯一键
      const record = await AppMeta.findOne({
        where: {
          platform,
          version_name,
          app_type,
        },
      })

      if (record) {
        if (
          record.version_number !== String(version_number) ||
          record.min_supported_version !== min_supported_version ||
          record.core_version !== core_version
        ) {
          await AppMeta.update(
            {
              version_number: String(version_number),
              min_supported_version,
              core_version,
              cli_version,
            },
            {
              where: {
                id: record.id,
              },
            },
          )
        }
        return record
      } else {
        const record = await AppMeta.create({
          platform,
          version_name,
          core_version,
          cli_version,
          version_number: String(version_number),
          min_supported_version,
          app_type,
        })
        return record
      }
    } catch (err) {
      logger.error('create baseline err: ', err)
      throw new AppError('create baseline err', ErrorCode.UPDATE_ERROR, 500)
    }
  }

  /**
   * 递归获取目录下的所有文件
   * @param dirPath 目录路径
   * @returns Promise<string[]>
   */
  private async getAllFiles(dirPath: string): Promise<string[]> {
    const files: string[] = []

    const items = fs.readdirSync(dirPath)
    for (const item of items) {
      const fullPath = path.join(dirPath, item)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory()) {
        const subFiles = await this.getAllFiles(fullPath)
        files.push(...subFiles)
      } else {
        files.push(fullPath)
      }
    }

    return files
  }

  /**
   * 根据meta.json配置确定文件信息
   * @param filePath 文件路径
   * @param basePath 基础路径
   * @returns BaseLineFileType | null
   */
  private getFileMeta(
    filePath: string,
    basePath: string,
  ): {
    fileType: BaseLineFileType
    fileHash: string
    coverable: boolean
    fileSize: number
    appName: string | null
  } {
    // 计算相对于baselineTemp目录的路径
    const baselineDir = path.join(basePath, BASELINE_DIR_NAME)
    const relativePath = path.relative(baselineDir, filePath)

    // 从meta.json读取文件类型配置
    const metaJsonPath = path.join(baselineDir, 'meta.json')
    if (fs.existsSync(metaJsonPath)) {
      try {
        const metaContent = fs.readFileSync(metaJsonPath, 'utf-8')
        const metaData = JSON.parse(metaContent)

        // 查找匹配的文件配置
        const fileConfig = metaData.files?.find(
          (file: any) => file.path === relativePath,
        )

        if (fileConfig && fileConfig.type && fileConfig.hash) {
          const resolvedFileType =
            BaseLineFileType[
              fileConfig.type as keyof typeof BaseLineFileType
            ] || null

          if (!resolvedFileType) {
            // meta.json 中记录了该文件，但当前服务端枚举不包含此 type，需重新构建部署
            throw new AppError(
              `未知的文件类型 "${fileConfig.type}"，请确认服务端 BaseLineFileType 枚举已包含该类型并重新部署`,
              ErrorCode.PARAMS_INVALID,
              400,
            )
          }

          return {
            fileType: resolvedFileType,
            fileHash: fileConfig.hash,
            coverable: fileConfig.coverable || false,
            fileSize: fileConfig.size || 0,
            appName: fileConfig.appName || null,
          }
        }

        return {
          fileType: null,
          fileHash: '',
          coverable: false,
          fileSize: 0,
          appName: null,
        }
      } catch (error) {
        throw new AppError('meta.json 解析失败', ErrorCode.PUBLISH_FAILED, 400)
      }
    } else {
      throw new AppError(
        '描述文件：meta.json 文件没找到',
        ErrorCode.PARAMS_INVALID,
        404,
      )
    }
  }

  /**
   * 从文件路径中提取appName（当fileType为DIFF时）
   * @param filePath 文件完整路径
   * @param basePath 基础路径
   * @param fileType 文件类型
   * @param logger 日志记录器
   * @returns appName或null
   */
  private extractAppNameFromPath(
    filePath: string,
    basePath: string,
    fileType: BaseLineFileType,
    logger: Logger,
  ): string | null {
    if (fileType !== BaseLineFileType.BASE_PACKAGE) {
      return null
    }

    try {
      const relativePath = path.relative(
        path.resolve(basePath, BASELINE_DIR_NAME),
        filePath,
      )
      const pathParts = relativePath.split(path.sep)

      if (pathParts.length > 1) {
        const appName = pathParts[0] // 取第一级目录名作为appName
        logger.info('Extracted appName for bundle output file', {
          filePath,
          relativePath,
          appName,
        })
        return appName
      }
    } catch (err) {
      logger.error('extractAppNameFromPath err: ', err)
      return null
    }
  }

  /**
   * 根据应用元数据ID和文件类型查找基线文件记录
   * @param appMetaId 应用元数据ID
   * @param type 基线文件类型
   * @returns Promise<BaseLineInterface[]>
   */
  async findBaselineByAppMetaId(
    appMetaId: number | number[],
    type: BaseLineFileType,
  ) {
    return NativeBaseline.findAll({
      where: {
        app_meta_id: Array.isArray(appMetaId)
          ? { [Op.in]: appMetaId }
          : appMetaId,
        file_type: type,
      },
    })
  }

  getBaselineDownloadUrl(blobUrl: string) {
    return getBlobDownloadUrl(blobUrl)
  }

  async findBaseline(parmas: {
    platform: string
    version_name: string
    app_type: NativeAppType
    file_type?: BaseLineFileType
  }) {
    const { platform, version_name, file_type, app_type } = parmas

    const meta = await AppMeta.findOne({
      where: {
        platform,
        version_name,
        app_type,
      },
      order: [['id', 'DESC']],
    })

    if (!meta) {
      return null
    }

    if (file_type) {
      const baseline = await NativeBaseline.findOne({
        where: {
          app_meta_id: meta.id,
          file_type,
        },
      })
      if (!baseline) {
        return null
      }

      const url = this.getBaselineDownloadUrl(baseline.url)
      return [
        {
          file_type,
          url,
          file_name: baseline.file_name,
          file_hash: baseline.file_hash,
        },
      ]
    } else {
      const baselines = await NativeBaseline.findAll({
        where: {
          app_meta_id: meta.id,
        },
      })
      if (!baselines.length) {
        return null
      }

      const urls = baselines.map((item) => {
        return {
          file_type: item.file_type as BaseLineFileType,
          url: this.getBaselineDownloadUrl(item.url),
          file_name: item.file_name,
          file_hash: item.file_hash,
        }
      })

      return urls
    }
  }

  public async findOrCreateDevelopmentVersion(
    versionName: string,
    platform: string,
    uid: number,
    transaction: Transaction,
    appName: string | null,
    env: string,
    logger: Logger,
  ): Promise<number | null> {
    const name = `${appName}-${platform}${env && !env.includes('prod') ? `-${env}` : ''}`
    const row = await findCollaboratorsByAppNameAndUid(uid, name)

    if (!row) {
      throw new Error(`appName: ${name} 不存在`)
    }

    const deployment = await deploymentsManager.findDeploymentByName(
      PRODUCTION,
      row.appid,
      logger,
    )

    logger.info('findOrCreateDevelopmentVersion: ', {
      deployment,
      versionName,
      uid,
      transaction,
      appName,
      platform,
      env,
    })

    if (!deployment) {
      throw new Error(`deployments: ${row.appid} 不存在`)
    }

    const [, min_version, max_version] = validatorVersion(versionName)
    const developmentVersion =
      await packageManager.createDeploymentsVersionIfNotExist(
        deployment.id,
        versionName,
        min_version,
        max_version,
        transaction,
        logger,
      )

    logger.info('developmentVersion', { developmentVersion })

    return developmentVersion.id
  }

  /**
   * 检查热更新时 commonHash 是否与当前该版本的基线 common_hash 匹配
   * @param deploymentKey
   * @param appVersion
   * @param commonHash
   * @param logger
   * @returns
   */
  public async checkCommonHash(
    deploymentKey: string,
    appVersion: string,
    commonHash: string,
    logger,
  ) {
    logger.debug('checkCommonHash', {
      deploymentKey,
      appVersion,
    })
    const development = await Deployments.findOne({
      where: {
        deployment_key: deploymentKey,
      },
    })

    if (!development) {
      logger.debug('checkCommonHash deployment not found', {
        deploymentKey,
      })
      return false
    }

    const app = await Apps.findOne({
      where: {
        id: development?.appid,
      },
    })

    if (!app) {
      logger.debug('checkCommonHash app not found', {
        appid: development?.appid,
      })
      return false
    }

    const platform = SystemTypeMap[app.os as BundlePlatformMapType]

    const appMeta = await AppMeta.findOne({
      where: {
        platform,
        version_name: appVersion,
        app_type: NativeAppType.RELEASE, // debug包暂不支持热更新能力，直接查release包
      },
    })

    if (!appMeta) {
      logger.debug('checkCommonHash app meta not found', {
        appVersion,
      })
      return false
    }

    const commonBaseline = await NativeBaseline.findOne({
      where: {
        app_meta_id: appMeta?.id,
        file_type: BaseLineFileType.COMMON,
      },
    })

    logger.debug('checkCommonHash common baseline: ', commonBaseline)

    return commonBaseline?.file_hash === commonHash
  }

  public async getDynamicBaseline(
    deploymentKey: string,
    appVersion: string,
    baselineType: BaseLineFileType,
  ) {
    const deployment = await Deployments.findOne({
      where: {
        deployment_key: deploymentKey,
        name: PRODUCTION,
      },
    })

    if (!deployment) {
      return null
    }

    const app = await Apps.findOne({
      where: {
        id: deployment.appid,
      },
    })

    if (!app) {
      return null
    }

    const appMeta = await AppMeta.findOne({
      where: {
        platform: getBundleOsTypeString(app.os as BundlePlatformMapType),
        version_name: appVersion,
        app_type: app.build_type,
      },
    })

    if (!appMeta) {
      return null
    }

    const baselines = await NativeBaseline.findAll({
      where: {
        app_meta_id: appMeta.id,
        file_type: baselineType,
      },
    })

    if (!baselines.length) {
      return null
    }

    // 提取所有的 deployment_version_id
    const deploymentVersionIds = baselines
      .map((baseline) => baseline.deployment_version_id)
      .filter(Boolean)

    if (!deploymentVersionIds.length) {
      return null
    }

    // 查询这些 deployment_version_id 对应的 DeploymentsVersions 记录
    const deploymentVersions = await DeploymentsVersions.findAll({
      where: {
        id: {
          [Op.in]: deploymentVersionIds,
        },
      },
    })

    if (!deploymentVersions.length) {
      return null
    }

    // 提取所有的 deployment_id
    const deploymentIds = deploymentVersions.map((dv) => dv.deployment_id)

    // 查询 Deployments 记录
    const deployments = await Deployments.findAll({
      where: {
        id: {
          [Op.in]: deploymentIds,
        },
      },
    })

    // 查找匹配的 deployment
    const matchingDeployment = deployments.find(
      (deployment) => deployment.deployment_key === deploymentKey,
    )

    if (!matchingDeployment) {
      return null
    }

    // 找到对应的 deployment_version
    const matchingDeploymentVersion = deploymentVersions.find(
      (dv) => dv.deployment_id === matchingDeployment.id,
    )

    if (!matchingDeploymentVersion) {
      return null
    }

    // 找到对应的基线数据
    const matchingBaseline = baselines.find(
      (baseline) =>
        baseline.deployment_version_id === matchingDeploymentVersion.id,
    )

    return matchingBaseline || null
  }

  // private async getAppVersionRange(
  //   appVersions: NativeAppVersionsInterface[],
  //   isGary: boolean = false,
  // ) {
  //   if (!appVersions.length) {
  //     return []
  //   }

  //   const [latestVersion] = appVersions

  //   const latestMetaId = latestVersion.app_meta_id

  //   const latestMeta = await AppMeta.findOne({
  //     where: {
  //       id: latestMetaId,
  //     },
  //   })

  //   const minSupportedVersion = latestMeta?.min_supported_version

  //   const where = {
  //     version_name: {
  //       [Op.gte]: minSupportedVersion,
  //       [Op.lte]: latestVersion.version_name,
  //     },
  //   }

  //   if (isGary) {
  //     Object.assign(where, {
  //       status: NativeAppVersionStatus.Rollout,
  //     })
  //   }
  //   const allVersions = await NativeAppVersions.findAll({
  //     where,
  //   })

  //   const set = new Set(allVersions.map((version) => version.version_name))
  //   return Array.from(set)
  // }

  // public async getAppHotUpdateVersions(
  //   platform: string,
  //   appName: AppTypeEnum = AppTypeEnum.Xtransfer,
  // ) {
  //   const nativeApps = await NativeApps.findOne({
  //     where: {
  //       platform,
  //       name: appName,
  //       app_type: NativeAppType.RELEASE,
  //     },
  //     order: [['id', 'ASC']],
  //   })

  //   if (!nativeApps) {
  //     return null
  //   }

  //   const nativeAppVersions = await NativeAppVersions.findAll({
  //     where: {
  //       app_key: nativeApps.app_key,
  //       review_passed: {
  //         [Op.in]: [APP_REVIEW_STATUS_AUDIT_PASSED, APP_REVIEW_STATUS_RELEASED],
  //       },
  //       status: {
  //         [Op.in]: [
  //           NativeAppVersionStatus.Discarded,
  //           NativeAppVersionStatus.Published,
  //           NativeAppVersionStatus.Rollout,
  //         ],
  //       },
  //     },
  //     order: [['created_at', 'DESC']],
  //   })

  //   const regularVersions = nativeAppVersions.filter((version) => {
  //     // review_passed = 2 为正式对客
  //     const reviewPassed = version.review_passed === APP_REVIEW_STATUS_RELEASED

  //     // review_passed = 1 且 status = discarded 为审核通过
  //     const auditPassedWithDiscarded =
  //       version.review_passed === APP_REVIEW_STATUS_AUDIT_PASSED &&
  //       version.status === NativeAppVersionStatus.Discarded

  //     return reviewPassed || auditPassedWithDiscarded
  //   })

  //   const pendingVersions = nativeAppVersions.filter(
  //     (version) =>
  //       version.review_passed === APP_REVIEW_STATUS_AUDIT_PASSED &&
  //       version.status === NativeAppVersionStatus.Rollout,
  //   )

  //   const result = []
  //   if (regularVersions.length) {
  //     const versionRange = await this.getAppVersionRange(regularVersions)
  //     result[0] = (versionRange || []).map((version) => ({ version }))
  //   }

  //   if (pendingVersions.length) {
  //     const versionRange = await this.getAppVersionRange(pendingVersions, true)
  //     result[1] = (versionRange || []).map((version) => ({ version }))
  //   }

  //   return result
  // }
}
export default new BaselineManager()
