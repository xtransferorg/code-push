/* eslint-disable max-lines */
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Request } from 'express'
import formidable from 'formidable'
import { Logger } from '../logger'
import _, { isEmpty, isNil, isNumber, isString } from 'lodash'
import { Op, Sequelize, Transaction } from 'sequelize'
import slash from 'slash'
import yazl from 'yazl'
import { Apps } from '../../models/apps'
import {
  Deployments,
  generateDeploymentsLabelId,
} from '../../models/deployments'
import { DeploymentsHistory } from '../../models/deployments_history'
import { DeploymentsVersions } from '../../models/deployments_versions'
import { Packages, PackagesInterface } from '../../models/packages'
import { PackagesDiff } from '../../models/packages_diff'
import { PackagesMetrics } from '../../models/packages_metrics'
import { AppError, ErrorCode } from '../app-error'
import {
  DIFF_FILE_NAME,
  DIFF_MANIFEST_FILE_NAME,
  IS_BASE_BUNDLE_YES,
  IS_DISABLED_NO,
  IS_DISABLED_YES,
  IS_MANDATORY_NO,
  IS_MANDATORY_YES,
  RELEASE_METHOD_PROMOTE,
  RELEASE_METHOD_ROLLBACK,
  RELEASE_METHOD_UPLOAD,
} from '../const'
import {
  getBlobDownloadUrl,
  createFileFromRequest,
  unzipFile,
  copySync,
  diffCollectionsSync,
  createEmptyFolder,
  createEmptyFolderSync,
  deleteFolderSync,
  validatorVersion,
  isFileExit,
  removeParentFolder,
  getInnerBlobDownloadUrl,
} from '../utils/common'
import { sequelize } from '../utils/connections'
import { qetag } from '../utils/qetag'
import { randToken, uploadPackageType } from '../utils/security'
import { uploadFileToStorage } from '../utils/storage'
import { dataCenterManager } from './datacenter-manager'
import { PackageInfo, ReleaseInfo } from '@xrnjs/code-push-core/script/types'
import AccountManager from '@xrnjs/code-push-core'
import { Releases } from '../../models/releases'
import { config } from '../config'
import { diff } from '../diff'
import download from 'download'
import fspromise from 'fs/promises'

class PackageManager {
  getMetricsbyPackageId(packageId) {
    return PackagesMetrics.findOne({ where: { package_id: packageId } })
  }

  findPackageInfoByDeploymentIdAndLabel(deploymentId, label) {
    return Packages.findOne({ where: { deployment_id: deploymentId, label } })
  }

  findLatestPackageInfoByDeployVersion(deploymentsVersionsId, logger: Logger) {
    return DeploymentsVersions.findByPk(deploymentsVersionsId).then(
      (deploymentsVersions) => {
        if (
          !deploymentsVersions ||
          deploymentsVersions.current_package_id < 0
        ) {
          const e = new AppError('not found last packages')
          logger.debug(e)
          throw e
        }
        return Packages.findByPk(deploymentsVersions.current_package_id)
      },
    )
  }

  parseReqFile(req: Request, logger: Logger) {
    logger.debug('parseReqFile')
    return new Promise<{ packageInfo: PackageInfo; package: formidable.File }>(
      (resolve, reject) => {
        const form = formidable()
        form.parse(req, (err, fields, files) => {
          if (err) {
            reject(new AppError('upload error'))
            return
          }

          if (
            _.isEmpty(fields.packageInfo) ||
            _.isEmpty(_.get(files, 'package'))
          ) {
            logger.debug('parseReqFile upload info lack')
            reject(new AppError('upload info lack'))
            return
          }

          logger.debug('parseReqFile is ok')
          resolve({
            packageInfo: JSON.parse(fields.packageInfo as string),
            package: files.package as formidable.File,
          })
        })
      },
    )
  }

  createDeploymentsVersionIfNotExist(
    deploymentId,
    appVersion,
    minVersion,
    maxVersion,
    t,
    logger: Logger,
  ) {
    return DeploymentsVersions.findOrCreate({
      where: {
        deployment_id: deploymentId,
        app_version: appVersion,
        min_version: minVersion,
        max_version: maxVersion,
      },
      defaults: { current_package_id: 0 },
      transaction: t,
    }).then(([data, created]) => {
      if (created) {
        logger.debug(
          `createDeploymentsVersionIfNotExist findOrCreate version ${appVersion}`,
        )
      }
      logger.debug(
        `createDeploymentsVersionIfNotExist version data:`,
        data.get(),
      )
      return data
    })
  }

  isMatchPackageHash(packageId, packageHash, logger: Logger) {
    if (_.lt(packageId, 0)) {
      logger.debug(`isMatchPackageHash packageId is 0`)
      return Promise.resolve(false)
    }
    return Packages.findByPk(packageId).then((data) => {
      if (
        data &&
        data.is_disabled === IS_DISABLED_NO &&
        _.eq(data.get('package_hash'), packageHash)
      ) {
        logger.debug(`isMatchPackageHash data:`, data.get())
        logger.debug(`isMatchPackageHash packageHash exist`)
        return true
      }
      logger.debug(`isMatchPackageHash package is null`)
      return false
    })
  }

  // 忽略重复包
  async isIgnoreRepeatPackage(packageId: number, channelReleaseId?: string) {
    const packages = await Packages.findByPk(packageId)
    if (packages && packages.is_disabled === IS_DISABLED_NO) {
      const currentChannelRelease = await Releases.findByPk(packages.release_id)
      if (
        channelReleaseId &&
        currentChannelRelease &&
        currentChannelRelease.channel_release_id !== Number(channelReleaseId)
      ) {
        return false
      }
    }
    return true
  }

  createPackage(
    deploymentId,
    appVersion,
    packageHash,
    manifestHash: string,
    blobHash: string,
    params,
    logger: Logger,
    t1?: Transaction,
  ) {
    const releaseMethod = params.releaseMethod || RELEASE_METHOD_UPLOAD
    const releaseUid = params.releaseUid || 0
    const isMandatory = params.isMandatory || 0
    const size = params.size || 0
    const rollout = params.rollout || 100
    const description = params.description || ''
    const originalLabel = params.originalLabel || ''
    const isDisabled = params.isDisabled || 0
    const originalDeployment = params.originalDeployment || ''
    const uuid = params.uuid || null
    const releaseId = params.releaseId || null
    const app_binary_time = params.appBinaryTime || null
    return generateDeploymentsLabelId(deploymentId, t1).then((labelId) => {
      return sequelize.transaction({ transaction: t1 }, (t) => {
        return this.createDeploymentsVersionIfNotExist(
          deploymentId,
          appVersion,
          params.min_version,
          params.max_version,
          t,
          logger,
        ).then(async (deploymentsVersions) => {
          return Packages.create(
            {
              deployment_version_id: deploymentsVersions.id,
              deployment_id: deploymentId,
              description,
              package_hash: packageHash,
              blob_url: blobHash,
              size,
              manifest_blob_url: manifestHash,
              release_method: releaseMethod,
              label: `v${labelId}`,
              released_by: releaseUid,
              is_mandatory: isMandatory,
              is_disabled: isDisabled,
              uuid: uuid,
              rollout,
              release_id: releaseId,
              original_label: originalLabel,
              original_deployment: originalDeployment,
              app_binary_time: app_binary_time,
            },
            { transaction: t },
          ).then((packages) => {
            deploymentsVersions.set('current_package_id', packages.id)
            return Promise.all([
              deploymentsVersions.save({ transaction: t }),
              Deployments.update(
                { last_deployment_version_id: deploymentsVersions.id },
                { where: { id: deploymentId }, transaction: t },
              ),
              PackagesMetrics.create(
                { package_id: packages.id },
                { transaction: t },
              ),
              DeploymentsHistory.create(
                { deployment_id: deploymentId, package_id: packages.id },
                { transaction: t },
              ),
            ]).then(() => packages)
          })
        })
      })
    })
  }

  downloadPackageAndExtract(
    workDirectoryPath,
    packageHash,
    blobHash,
    logger: Logger,
  ) {
    return dataCenterManager
      .validateStore(packageHash, logger)
      .then((isValidate) => {
        if (isValidate) {
          return dataCenterManager.getPackageInfo(packageHash)
        }
        const downloadURL = getBlobDownloadUrl(blobHash)
        return createFileFromRequest(
          downloadURL,
          path.join(workDirectoryPath, blobHash),
          logger,
        ).then(() => {
          return unzipFile(
            path.join(workDirectoryPath, blobHash),
            path.join(workDirectoryPath, 'current'),
            logger,
          ).then((outputPath) => {
            return dataCenterManager.storePackage(outputPath, true, logger)
          })
        })
      })
  }

  zipDiffPackage(fileName, files, baseDirectoryPath, hotCodePushFile) {
    return new Promise<{ isTemporary: boolean; path: string }>(
      (resolve, reject) => {
        const zipFile = new yazl.ZipFile()
        const writeStream = fs.createWriteStream(fileName)
        writeStream.on('error', (error) => {
          reject(error)
        })
        ;(zipFile as unknown as EventEmitter).on('error', (error) => {
          reject(error)
        })
        zipFile.outputStream
          .pipe(writeStream)
          .on('error', (error) => {
            reject(error)
          })
          .on('close', () => {
            resolve({ isTemporary: true, path: fileName })
          })
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i]
          zipFile.addFile(path.join(baseDirectoryPath, file), slash(file))
        }
        zipFile.addFile(hotCodePushFile, DIFF_MANIFEST_FILE_NAME)
        zipFile.end()
      },
    )
  }

  generateOneDiffPackage(
    workDirectoryPath,
    packageId,
    originDataCenter,
    oldPackageDataCenter,
    diffPackageHash,
    diffManifestBlobHash,
    logger: Logger,
  ) {
    return PackagesDiff.findOne({
      where: {
        package_id: packageId,
        diff_against_package_hash: diffPackageHash,
      },
    }).then((diffPackage) => {
      if (!_.isEmpty(diffPackage)) {
        return undefined
      }
      logger.debug('generateOneDiffPackage', {
        packageId,
        originDataCenter,
        oldPackageDataCenter,
      })
      const downloadURL = getBlobDownloadUrl(diffManifestBlobHash)
      return createFileFromRequest(
        downloadURL,
        path.join(workDirectoryPath, diffManifestBlobHash),
        logger,
      ).then(() => {
        const dataCenterContentPath = path.join(workDirectoryPath, 'dataCenter')
        copySync(originDataCenter.contentPath, dataCenterContentPath)
        // const oldPackageDataCenterContentPath = oldPackageDataCenter.contentPath;
        const originManifestJson = JSON.parse(
          fs.readFileSync(originDataCenter.manifestFilePath, 'utf8'),
        )
        const diffManifestJson = JSON.parse(
          fs.readFileSync(
            path.join(workDirectoryPath, diffManifestBlobHash),
            'utf8',
          ),
        )
        const json = diffCollectionsSync(originManifestJson, diffManifestJson)
        const files = _.concat(json.diff, json.collection1Only)
        const hotcodepush = {
          deletedFiles: json.collection2Only,
          patchedFiles: [],
        }
        const hotCodePushFile = path.join(
          workDirectoryPath,
          `${diffManifestBlobHash}_hotcodepush`,
        )
        fs.writeFileSync(hotCodePushFile, JSON.stringify(hotcodepush))
        const fileName = path.join(
          workDirectoryPath,
          `${diffManifestBlobHash}.zip`,
        )
        return this.zipDiffPackage(
          fileName,
          files,
          dataCenterContentPath,
          hotCodePushFile,
        ).then((data) => {
          return qetag(data.path, logger).then((diffHash) => {
            return uploadFileToStorage(diffHash, fileName, logger).then(() => {
              const stats = fs.statSync(fileName)
              return PackagesDiff.create({
                package_id: packageId,
                diff_against_package_hash: diffPackageHash,
                diff_blob_url: diffHash,
                diff_size: stats.size,
              })
            })
          })
        })
      })
    })
  }

  createDiffPackagesByLastNums(
    appId,
    originalPackage: PackagesInterface,
    num: number,
    logger: Logger,
  ) {
    const packageId = originalPackage.id
    return Promise.all([
      Packages.findAll({
        where: {
          deployment_version_id: originalPackage.deployment_version_id,
          id: { [Op.lt]: packageId },
        },
        order: [['id', 'desc']],
        limit: num,
      }),
      Packages.findAll({
        where: {
          deployment_version_id: originalPackage.deployment_version_id,
          id: { [Op.lt]: packageId },
        },
        order: [['id', 'asc']],
        limit: 2,
      }),
    ])
      .then(([lastNumsPackages, basePackages]) => {
        return _.uniqBy(
          _.unionBy(lastNumsPackages, basePackages, 'id'),
          'package_hash',
        )
      })
      .then((lastNumsPackages) => {
        return this.createDiffPackages(
          originalPackage,
          lastNumsPackages,
          logger,
        )
      })
  }

  createDiffPackages(originalPackage, destPackages, logger: Logger) {
    if (!_.isArray(destPackages)) {
      return Promise.reject(new AppError('第二个参数必须是数组'))
    }
    if (destPackages.length <= 0) {
      return null
    }
    const packageHash = _.get(originalPackage, 'package_hash')
    // const manifest_blob_url = _.get(originalPackage, 'manifest_blob_url');
    const blobUrl = _.get(originalPackage, 'blob_url')
    const workDirectoryPath = path.join(
      os.tmpdir(),
      `codepush_${randToken(32)}`,
    )
    logger.debug('createDiffPackages using dir', { workDirectoryPath })
    return createEmptyFolder(workDirectoryPath)
      .then(() =>
        this.downloadPackageAndExtract(
          workDirectoryPath,
          packageHash,
          blobUrl,
          logger,
        ),
      )
      .then((originDataCenter) =>
        Promise.all(
          destPackages.map((v) => {
            const diffWorkDirectoryPath = path.join(
              workDirectoryPath,
              _.get(v, 'package_hash'),
            )
            createEmptyFolderSync(diffWorkDirectoryPath)
            return this.downloadPackageAndExtract(
              diffWorkDirectoryPath,
              _.get(v, 'package_hash'),
              _.get(v, 'blob_url'),
              logger,
            ).then((oldPackageDataCenter) =>
              this.generateOneDiffPackage(
                diffWorkDirectoryPath,
                originalPackage.id,
                originDataCenter,
                oldPackageDataCenter,
                v.package_hash,
                v.manifest_blob_url,
                logger,
              ),
            )
          }),
        ),
      )
      .finally(() => deleteFolderSync(workDirectoryPath))
  }

  async disableOldPackageWithAppVersion(
    deploymentId: number,
    appVersion: string,
    logger: Logger,
  ) {
    const deploymentVersion = await DeploymentsVersions.findOne({
      where: {
        deployment_id: deploymentId,
        app_version: appVersion,
      },
    })
    if (!deploymentVersion) {
      logger.debug(`deploymentVersion not found`)
      return null
    }
    const packages = await Packages.findAll({
      where: {
        deployment_version_id: deploymentVersion.id,
      },
    })
    if (packages.length === 0) {
      logger.debug(`packages not found`)
      return null
    }
    const t = await sequelize.transaction()
    try {
      for (const p of packages) {
        await p.update({ is_disabled: IS_DISABLED_YES }, { transaction: t })
      }
      t.commit()
    } catch (e) {
      t.rollback()
      throw new AppError(e)
    }
  }

  // eslint-disable-next-line max-lines-per-function
  async releasePackage(
    appId,
    deploymentId,
    packageInfo: PackageInfo,
    filePath: string,
    releaseUid: number,
    logger: Logger,
  ) {
    const { appVersion, appBinaryTime } = packageInfo
    const versionInfo = validatorVersion(appVersion)
    if (!versionInfo[0]) {
      logger.debug(
        `releasePackage targetBinaryVersion ${appVersion} not support.`,
      )
      return Promise.reject(
        new AppError(`targetBinaryVersion ${appVersion} not support.`),
      )
    }
    const { description } = packageInfo // 描述
    const { isDisabled } = packageInfo // 是否立刻下载
    const { rollout } = packageInfo // 灰度百分比
    const { isMandatory } = packageInfo // 是否强制更新，无法跳过
    const { uuid } = packageInfo // 外部关联ID
    const { whiteList } = packageInfo // 灰度白名单
    const { channelReleaseId } = packageInfo // 渠道发布关联ID

    if (isString(uuid) && uuid.length === 36) {
      const havePackage = await Packages.findOne({ where: { uuid } })
      if (!isEmpty(havePackage)) {
        throw new AppError('The uuid already exists and cannot be published')
      }
    }

    if (appBinaryTime) {
      // 禁用旧版本包
      await this.disableOldPackageWithAppVersion(
        deploymentId,
        appVersion,
        logger,
      )
    }

    const tmpDir = os.tmpdir()
    const directoryPathParent = path.join(tmpDir, `codepuh_${randToken(32)}`)
    const directoryPath = path.join(directoryPathParent, 'current')
    logger.debug(`releasePackage generate an random dir path: ${directoryPath}`)
    return Promise.all([
      qetag(filePath, logger),
      createEmptyFolder(directoryPath).then(() => {
        return unzipFile(filePath, directoryPath, logger)
      }),
    ])
      .then(([blobHash]) => {
        return uploadPackageType(directoryPath).then((type) => {
          return Apps.findByPk(appId).then((appInfo) => {
            if (type > 0 && appInfo.os > 0 && appInfo.os !== type) {
              const e = new AppError('it must be publish it by ios type')
              logger.debug(e)
              throw e
            } else {
              // 不验证
              logger.debug(`Unknown package type:`, {
                type,
                os: appInfo.os,
              })
            }
            return blobHash
          })
        })
      })
      .then((blobHash) => {
        return dataCenterManager
          .storePackage(directoryPath, false, logger)
          .then((dataCenter) => {
            const { packageHash } = dataCenter
            const manifestFile = dataCenter.manifestFilePath
            let packageId = 0
            return DeploymentsVersions.findOne({
              where: { deployment_id: deploymentId, app_version: appVersion },
            })
              .then((deploymentsVersions) => {
                if (!deploymentsVersions) {
                  return false
                }
                packageId = deploymentsVersions.get('current_package_id')
                return this.isMatchPackageHash(
                  deploymentsVersions.get('current_package_id'),
                  packageHash,
                  logger,
                )
              })
              .then(async (isExist) => {
                if (isExist) {
                  const shouldIgnoreRepeatPackage =
                    await this.isIgnoreRepeatPackage(
                      packageId,
                      channelReleaseId,
                    )
                  if (shouldIgnoreRepeatPackage) {
                    logger.info(
                      `禁用上一次发布的版本. packageId: ${packageId} channelReleaseId: ${channelReleaseId}`,
                    )
                    await Packages.update(
                      { is_disabled: IS_DISABLED_YES },
                      {
                        where: {
                          id: packageId,
                        },
                      },
                    )
                  } else {
                    const e = new AppError(
                      '当前发布与上次发布相同',
                      ErrorCode.RELEASE_IDENTICAL,
                      AccountManager.ERROR_CONFLICT,
                    )
                    logger.debug(e.message)
                    throw e
                  }
                }
                return qetag(manifestFile, logger)
              })
              .then((manifestHash) => {
                return Promise.all([
                  uploadFileToStorage(manifestHash, manifestFile, logger),
                  uploadFileToStorage(blobHash, filePath, logger),
                ]).then(() => [packageHash, manifestHash, blobHash])
              })
          })
      })
      .then(async ([packageHash, manifestHash, blobHash]) => {
        const stats = fs.statSync(filePath)
        const params = {
          releaseMethod: RELEASE_METHOD_UPLOAD,
          releaseUid,
          isMandatory: isMandatory ? IS_MANDATORY_YES : IS_MANDATORY_NO,
          isDisabled: isDisabled ? IS_DISABLED_YES : IS_DISABLED_NO,
          uuid: uuid, // default ''
          rollout: 100, // rollout 迁移到 releases 表维护，这里默认都是 100
          size: stats.size,
          description,
          releaseId: null,
          min_version: versionInfo[1],
          max_version: versionInfo[2],
          appBinaryTime: appBinaryTime,
        }
        if (channelReleaseId) {
          const [release] = await Releases.findOrCreate({
            where: {
              channel_release_id: channelReleaseId,
            },
            defaults: {
              rollout,
              white_list: whiteList,
              channel_release_id: channelReleaseId,
            },
          })
          params.releaseId = release.id
        }
        logger.info('releasePackage', { params, channelReleaseId })
        return this.createPackage(
          deploymentId,
          appVersion,
          packageHash,
          manifestHash,
          blobHash,
          params,
          logger,
        )
      })
      .finally(() => deleteFolderSync(directoryPathParent))
  }

  modifyReleasePackage(
    packageId: number,
    params: PackageInfo,
    t?: Transaction,
  ) {
    const appVersion = _.get(params, 'appVersion')
    const description = _.get(params, 'description')
    const isMandatory = _.get(params, 'isMandatory')
    const isDisabled = _.get(params, 'isDisabled')
    return Packages.findByPk(packageId)
      .then((packageInfo) => {
        if (!packageInfo) {
          throw new AppError(`packageInfo not found`)
        }
        if (!_.isNil(appVersion)) {
          const versionInfo = validatorVersion(appVersion)
          if (!versionInfo[0]) {
            throw new AppError(
              `--targetBinaryVersion ${appVersion} not support.`,
            )
          }
          return Promise.all([
            DeploymentsVersions.findOne({
              where: {
                deployment_id: packageInfo.deployment_id,
                app_version: appVersion,
              },
            }),
            DeploymentsVersions.findByPk(packageInfo.deployment_version_id),
          ])
            .then(([v1, v2]) => {
              if (v1 && !_.eq(v1.id, v2.id)) {
                throw new AppError(`${appVersion} already exist.`)
              }
              if (!v2) {
                throw new AppError(`packages not found.`)
              }
              return DeploymentsVersions.update(
                {
                  app_version: appVersion,
                  min_version: versionInfo[1],
                  max_version: versionInfo[2],
                },
                { where: { id: v2.id }, transaction: t },
              )
            })
            .then(() => {
              return packageInfo
            })
        }
        return packageInfo
      })
      .then((packageInfo) => {
        const newParams = {
          description: description || packageInfo.description,
        } as PackagesInterface
        if (_.isBoolean(isMandatory)) {
          newParams.is_mandatory = isMandatory
            ? IS_MANDATORY_YES
            : IS_MANDATORY_NO
        }
        if (_.isBoolean(isDisabled)) {
          newParams.is_disabled = isDisabled ? IS_DISABLED_YES : IS_DISABLED_NO
        }
        return Packages.update(newParams, { where: { id: packageId } })
      })
  }

  // eslint-disable-next-line max-lines-per-function
  promotePackage(
    sourceDeploymentInfo,
    destDeploymentInfo,
    params,
    logger: Logger,
  ) {
    const appVersion = _.get(params, 'appVersion', null)
    const label = _.get(params, 'label', null)
    return new Promise((resolve, reject) => {
      if (label) {
        Packages.findOne({
          where: { deployment_id: sourceDeploymentInfo.id, label },
        })
          .then((sourcePack) => {
            if (!sourcePack) {
              throw new AppError('label does not exist.')
            }
            return DeploymentsVersions.findByPk(
              sourcePack.deployment_version_id,
            ).then((deploymentsVersions) => {
              if (!deploymentsVersions) {
                throw new AppError('deploymentsVersions does not exist.')
              }
              resolve([sourcePack, deploymentsVersions])
            })
          })
          .catch((e) => {
            reject(e)
          })
        return
      }
      const lastDeploymentVersionId = _.get(
        sourceDeploymentInfo,
        'last_deployment_version_id',
        0,
      )
      if (_.lte(lastDeploymentVersionId, 0)) {
        throw new AppError(`does not exist last_deployment_version_id.`)
      }

      DeploymentsVersions.findByPk(lastDeploymentVersionId)
        .then((deploymentsVersions) => {
          const sourcePackId = _.get(
            deploymentsVersions,
            'current_package_id',
            0,
          )
          if (_.lte(sourcePackId, 0)) {
            throw new AppError(`packageInfo not found.`)
          }
          return Packages.findByPk(sourcePackId).then((sourcePack) => {
            if (!sourcePack) {
              throw new AppError(`packageInfo not found.`)
            }
            resolve([sourcePack, deploymentsVersions])
          })
        })
        .catch((e) => {
          reject(e)
        })
    })
      .then(([sourcePack, deploymentsVersions]) => {
        const appFinalVersion = appVersion || deploymentsVersions.app_version
        logger.debug('sourcePack', sourcePack)
        logger.debug('deploymentsVersions', deploymentsVersions)
        logger.debug('appFinalVersion', appFinalVersion)
        return DeploymentsVersions.findOne({
          where: {
            deployment_id: destDeploymentInfo.id,
            app_version: appFinalVersion,
          },
        })
          .then((destDeploymentsVersions) => {
            if (!destDeploymentsVersions) {
              return false
            }
            return this.isMatchPackageHash(
              destDeploymentsVersions.get('current_package_id'),
              sourcePack.package_hash,
              logger,
            )
          })
          .then((isExist) => {
            if (isExist) {
              throw new AppError(
                "The uploaded package is identical to the contents of the specified deployment's current release.",
              )
            }
            return [sourcePack, appFinalVersion]
          })
      })
      .then(([sourcePack, appFinalVersion]) => {
        const versionInfo = validatorVersion(appFinalVersion)
        if (!versionInfo[0]) {
          logger.debug(`targetBinaryVersion ${appVersion} not support.`)
          throw new AppError(`targetBinaryVersion ${appVersion} not support.`)
        }

        const createParams = {
          releaseMethod: RELEASE_METHOD_PROMOTE,
          releaseUid: params.promoteUid || 0,
          rollout: params.rollout || 100,
          size: sourcePack.size,
          description: params.description || sourcePack.description,
          originalLabel: sourcePack.label,
          originalDeployment: sourceDeploymentInfo.name,
          min_version: versionInfo[1],
          max_version: versionInfo[2],
          isMandatory: 0,
          isDisabled: 0,
        }
        if (_.isBoolean(params.isMandatory)) {
          createParams.isMandatory = params.isMandatory
            ? IS_MANDATORY_YES
            : IS_MANDATORY_NO
        } else {
          createParams.isMandatory = sourcePack.is_mandatory
        }
        if (_.isBoolean(params.isDisabled)) {
          createParams.isDisabled = params.isDisabled
            ? IS_DISABLED_YES
            : IS_DISABLED_NO
        } else {
          createParams.isDisabled = sourcePack.is_disabled
        }
        return this.createPackage(
          destDeploymentInfo.id,
          appFinalVersion,
          sourcePack.package_hash,
          sourcePack.manifest_blob_url,
          sourcePack.blob_url,
          createParams,
          logger,
        )
      })
  }

  rollbackPackage(
    deploymentVersionId: number,
    targetLabel: string | undefined,
    rollbackUid: number,
    logger: Logger,
    rollbackUuid?: string,
    t?: Transaction,
  ) {
    return DeploymentsVersions.findByPk(deploymentVersionId).then(
      (deploymentsVersions) => {
        if (!deploymentsVersions) {
          throw new AppError('您之前还没有发布过版本')
        }
        return Packages.findByPk(deploymentsVersions.current_package_id)
          .then(
            (
              currentPackageInfo,
            ): Promise<[PackagesInterface, PackagesInterface[]]> => {
              if (targetLabel) {
                return Packages.findAll({
                  where: {
                    deployment_version_id: deploymentVersionId,
                    label: targetLabel,
                    is_disabled: IS_DISABLED_NO,
                  },
                  limit: 1,
                }).then((rollbackPackageInfos) => {
                  return [currentPackageInfo, rollbackPackageInfos]
                })
              }
              return this.getCanRollbackPackage(currentPackageInfo).then(
                (rollbackPackageInfos) => {
                  return [currentPackageInfo, [rollbackPackageInfos]]
                },
              )
            },
          )
          .then(([currentPackageInfo, rollbackPackageInfos]) => {
            if (currentPackageInfo && rollbackPackageInfos.length > 0) {
              for (let i = rollbackPackageInfos.length - 1; i >= 0; i -= 1) {
                if (
                  rollbackPackageInfos[i].package_hash !==
                  currentPackageInfo.package_hash
                ) {
                  // 找到了可以回滚的版本，禁用中间版本
                  return this.disabledPackage(
                    currentPackageInfo,
                    rollbackPackageInfos[i],
                    t,
                  ).then(() => rollbackPackageInfos[i])
                }
              }
            }
            throw new AppError('没有可供回滚的版本 ' + currentPackageInfo.id)
          })
          .then((rollbackPackage) => {
            const params = {
              releaseMethod: 'Rollback',
              releaseUid: rollbackUid,
              isMandatory: IS_MANDATORY_YES, // 回滚后必须强制更新
              isDisabled: rollbackPackage.is_disabled,
              rollout: 100, // 回滚后灰度全部变为默认 100
              size: rollbackPackage.size,
              description: rollbackPackage.description,
              originalLabel: rollbackPackage.label,
              originalDeployment: '',
              min_version: deploymentsVersions.min_version,
              max_version: deploymentsVersions.max_version,
              uuid: rollbackUuid,
            }
            return this.createPackage(
              deploymentsVersions.deployment_id,
              deploymentsVersions.app_version,
              rollbackPackage.package_hash,
              rollbackPackage.manifest_blob_url,
              rollbackPackage.blob_url,
              params,
              logger,
              t,
            )
          })
      },
    )
  }

  getCanRollbackPackage(currentPackageInfo: PackagesInterface) {
    // current v3, v2, v1
    // rollback v3 -> v2 = v4
    // rollback v2 -> v1 = v5
    // upload v6
    // rollback v6 -> v5 = v7(v1)
    // rollback v7 error, 没有比v1更小的版本
    const where: { label?: any } = {}
    if (currentPackageInfo.release_method === RELEASE_METHOD_ROLLBACK) {
      // 通过对比 label 确定回滚的版本
      where.label = Sequelize.literal(
        `CAST(SUBSTRING(label, 2) AS UNSIGNED) < ${currentPackageInfo.original_label.replace('v', '')}`,
      )
    }
    return Packages.findOne({
      where: {
        deployment_version_id: currentPackageInfo.deployment_version_id,
        release_method: {
          [Op.in]: [RELEASE_METHOD_UPLOAD, RELEASE_METHOD_PROMOTE],
        },
        id: {
          // 获取比当前版本小的版本，因为 id 是递增
          // id: 4714 -> id: 4708 -> id: 4699
          // current id: 4708 -> rollback id: 4699 (4699 < 4708)
          [Op.lt]: currentPackageInfo.id,
        },
        // 被禁用的版本不允许回滚
        is_disabled: IS_DISABLED_NO,
        ...where,
      },
      order: [['id', 'desc']],
    })
  }

  async findPackageWithChannelReleaseId(
    channelReleaseId: string,
    previous = false,
  ) {
    const packages = await Packages.findAll({
      where: {
        channel_release_id: channelReleaseId,
      },
    })
    if (previous) {
      return Promise.all(
        packages.map((currentPackageInfo) =>
          this.getCanRollbackPackage(currentPackageInfo),
        ),
      )
    }
    return packages
  }

  async findPackageWithUuid(uuids: string[], previous = false) {
    if (isEmpty(uuids)) {
      throw new AppError('The uuid cannot be empty')
    }
    let data: PackagesInterface[] = []
    if (previous) {
      // 自动回滚到目标版本的上一个版本
      const packages = await Packages.findAll({
        where: {
          uuid: {
            [Op.in]: uuids,
          },
        },
      })
      data = await Promise.all(
        packages.map((currentPackageInfo) =>
          this.getCanRollbackPackage(currentPackageInfo),
        ),
      )
    } else {
      data = await Packages.findAll({
        where: {
          uuid: {
            [Op.in]: uuids,
          },
        },
      })
    }
    return data.sort((a, b) => uuids.indexOf(a.uuid) - uuids.indexOf(b.uuid))
  }

  async findPackageLifeCycleWithUuid(uuids: string[], previous = false) {
    const data = (await this.findPackageWithUuid(uuids, previous)).filter(
      (item) => !isNil(item),
    )
    return this.findPackageLifeCycle(data)
  }

  async findPackageLifeCycleWithChannelReleaseId(
    channelReleaseId: string,
    previous = false,
  ) {
    const data = (
      await this.findPackageWithChannelReleaseId(channelReleaseId, previous)
    ).filter((item) => !isNil(item))
    return this.findPackageLifeCycle(data)
  }

  // 批量查找后再重新组合
  private async findPackageLifeCycle(data: PackagesInterface[]) {
    const deploymentVersions = await DeploymentsVersions.findAll({
      where: {
        id: { [Op.in]: data.map((item) => item.deployment_version_id) },
      },
    })
    const deployments = await Deployments.findAll({
      where: {
        id: { [Op.in]: deploymentVersions.map((item) => item.deployment_id) },
      },
    })
    const apps = await Apps.findAll({
      where: { id: { [Op.in]: deployments.map((item) => item.appid) } },
    })
    const metrics = await PackagesMetrics.findAll({
      where: {
        package_id: { [Op.in]: data.map((item) => item.id) },
      },
    })
    return data.map((packageItem) => {
      const deploymentVersion = deploymentVersions.find(
        (item) => packageItem.deployment_version_id === item.id,
      )
      if (isEmpty(deploymentVersion)) {
        throw new AppError(
          'find package error. deploymentVersion not found ' +
            JSON.stringify(packageItem),
        )
      }
      const deployment = deployments.find(
        (item) => item.id === deploymentVersion.deployment_id,
      )
      if (isEmpty(deployment)) {
        throw new AppError(
          'find package error. deployment not found ' +
            JSON.stringify(deploymentVersion),
        )
      }
      const app = apps.find((item) => item.id === deployment.appid)
      if (isEmpty(app)) {
        throw new AppError(
          'find package error. app not found ' + JSON.stringify(deployment),
        )
      }
      const packageMetrics = metrics.find(
        (item) => item.package_id === packageItem.id,
      )
      return {
        appName: app.name,
        appVersion: deploymentVersion.app_version,
        env: deployment.name,
        deploymentVersion: deploymentVersion,
        deployment: deployment,
        packageItem: packageItem,
        packageMetrics: packageMetrics,
      }
    })
  }

  async disabledPackage(
    currentPackage: PackagesInterface,
    targetPackage: PackagesInterface,
    t?: Transaction,
  ) {
    await Packages.update(
      { is_disabled: IS_DISABLED_YES },
      {
        where: {
          deployment_version_id: currentPackage.deployment_version_id,
          id: {
            [Op.lte]: currentPackage.id,
            [Op.gt]: targetPackage.id,
          },
          release_method: {
            [Op.in]: [RELEASE_METHOD_UPLOAD, RELEASE_METHOD_PROMOTE],
          },
        },
        transaction: t,
      },
    )
  }

  async modifyRelease(channelReleaseId: string, releaseInfo: ReleaseInfo) {
    const info: {
      white_list?: string
      rollout?: number
    } = {
      white_list: releaseInfo.whiteList,
    }
    if (isNumber(releaseInfo.rollout)) {
      info.rollout = releaseInfo.rollout
    }
    const release = await Releases.findOne({
      where: {
        channel_release_id: channelReleaseId,
      },
    })
    if (isEmpty(release)) {
      throw new AppError('The release does not exist')
    }
    await Releases.update(info, {
      where: {
        channel_release_id: channelReleaseId,
      },
    })
  }

  async createDiffPackage(
    appid: number,
    deploymentId: number,
    packageInfo: PackageInfo,
    packages: PackagesInterface,
    filepath: string,
    logger: Logger,
  ) {
    const t = await sequelize.transaction()
    const tmpDir = path.resolve(os.tmpdir(), `codepush_cache_${randToken(32)}`)
    const tmpDiffDir = path.resolve(
      os.tmpdir(),
      `codepush_diff_${randToken(32)}`,
    )
    try {
      const deployment = await Deployments.findByPk(deploymentId, {
        transaction: t,
      })
      const deploymentVersion = await DeploymentsVersions.findOne({
        where: {
          deployment_id: deploymentId,
          app_version: packageInfo.appVersion,
        },
        transaction: t,
      })
      const { appVersion } = packageInfo

      // 找到内置包的信息
      const packageV0 = await Packages.findOne({
        where: {
          deployment_version_id: deploymentVersion.id,
          release_method: {
            [Op.in]: [RELEASE_METHOD_UPLOAD, RELEASE_METHOD_PROMOTE],
          },
          is_disabled: IS_DISABLED_NO,
        },
        order: [['id', 'asc']],
        transaction: t,
      })
      if (!packageV0) {
        throw new AppError('未找到第一次发布的包，没办法生成 diff 包')
      }

      const targetPath = path.resolve(
        process.cwd(),
        config.common.localCodePushDir,
        deployment.deployment_key,
        appVersion,
        packageV0.package_hash,
      )

      if (!(await isFileExit(targetPath))) {
        // 内置包没有缓存到本地，需要通过 PackageV0 下载然后缓存
        const downloadURL = getInnerBlobDownloadUrl(packageV0.blob_url)
        logger.info(`downloadURL: ${downloadURL}. targetPath: ${targetPath}`)
        await download(downloadURL, targetPath, {
          extract: true,
        })
        // 去除 cli 发布的文件夹名称影响
        // $LOCAL_DOWNLOAD_URL/Kp7eMvcm54SFcABytmgUS7DC7Xek4ksvOXqog/3.4.4/base/index.xt-app-main.bundle ⬇️（移除base文件夹）
        // $LOCAL_DOWNLOAD_URL/Kp7eMvcm54SFcABytmgUS7DC7Xek4ksvOXqog/3.4.4/index.xt-app-main.bundle
        await removeParentFolder(targetPath, logger)
        // 删除 .codepushrelease 文件
        const codepushrelease = path.join(targetPath, '.codepushrelease')
        if (await isFileExit(codepushrelease)) {
          logger.info('remove .codepushrelease. ' + codepushrelease)
          await fspromise.rm(codepushrelease)
        }
      }

      const tmpDiff = path.resolve(tmpDiffDir, DIFF_FILE_NAME)
      // 解压热更新包
      await unzipFile(filepath, tmpDir, logger)

      await createEmptyFolder(tmpDiffDir)

      logger.info(
        `CreateDiffPackage targetPath:${targetPath}. tmpDir:${tmpDir}`,
      )
      // 创建 diff 文件
      const diffResult = await diff(targetPath, tmpDir, tmpDiff)
      logger.info(`Diff result ${JSON.stringify(diffResult)}`)

      // 根据内容生成 hash
      const blobHash = await qetag(tmpDiff, logger)
      const stats = fs.statSync(tmpDiff)

      // 上传文件到云端
      await uploadFileToStorage(blobHash, tmpDiff, logger)
      await PackagesDiff.create(
        {
          package_id: packages.id,
          diff_against_package_hash: packageV0.package_hash,
          diff_blob_url: blobHash,
          diff_size: stats.size,
        },
        { transaction: t },
      )
      t.commit()
      logger.info('CreateDiffPackage success')
      return diffResult
    } catch (e) {
      await t.rollback()
      logger.error(e)
      throw new AppError(e)
    } finally {
      // clean
      deleteFolderSync(tmpDir)
      deleteFolderSync(tmpDiffDir)
    }
  }

  async generateDiffWithRollback(
    appid: number,
    packages: PackagesInterface,
    logger: Logger,
  ) {
    // 回滚后，需要在 diff 表中生成 diff 包，用于热更新
    // 1. 找到回滚的版本
    // 2. 寻找回滚的版本是否有 diff 包
    // 3. 生成 diff 包，内容与回滚的 diff 包一致，但是 package_id 不一样
    const t = await sequelize.transaction()
    try {
      const originalPackage = await Packages.findOne({
        where: {
          deployment_id: packages.deployment_id,
          deployment_version_id: packages.deployment_version_id,
          label: packages.original_label,
        },
        transaction: t,
      })
      if (!originalPackage) {
        throw new AppError(
          'originalPackage not found. ' + JSON.stringify(packages),
        )
      }
      const deploymentVersion = await DeploymentsVersions.findByPk(
        originalPackage.deployment_version_id,
        { transaction: t },
      )
      // 找到内置包的信息
      const packageV0 = await Packages.findOne({
        where: {
          deployment_version_id: deploymentVersion.id,
          release_method: {
            [Op.in]: [RELEASE_METHOD_UPLOAD, RELEASE_METHOD_PROMOTE],
          },
          is_disabled: IS_DISABLED_NO,
        },
        order: [['id', 'asc']],
        transaction: t,
      })
      const diff = await PackagesDiff.findOne({
        where: {
          package_id: originalPackage.id,
          diff_against_package_hash: packageV0.package_hash,
        },
        transaction: t,
      })
      if (!diff) {
        throw new AppError('diff package not found.')
      }
      const packageDiff = await PackagesDiff.create(
        {
          package_id: packages.id,
          diff_against_package_hash: packageV0.package_hash,
          diff_blob_url: diff.diff_blob_url,
          diff_size: diff.diff_size,
        },
        {
          transaction: t,
        },
      )
      logger.info('GenerateDiffWithRollback success.' + packageDiff.id)
      t.commit()
    } catch (e) {
      await t.rollback()
      logger.error(e)
      throw new AppError(e)
    }
  }
}

export const packageManager = new PackageManager()
