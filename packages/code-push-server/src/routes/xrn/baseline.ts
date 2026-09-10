import express from 'express'
import formidable from 'formidable'
import path from 'path'
import os from 'os'
import { unzipFile, createEmptyFolder } from '../../core/utils/common'
import logger from '../../core/logger'
import { AppError, ErrorCode } from '../../core/app-error'
import _ from 'lodash'
import baselineManager from '../../core/services/baseline-manager'
import { BaseLineFileType, NativeAppType } from '@xrnjs/code-push-core'
import { checkToken, Req } from '../../core/middleware'
import {
  AppMeta,
  AppsVersionMetaInterface,
} from '../../models/app_version_meta'
import moment from 'moment'

export const baselineRouter = express.Router()

export const getBaselineTempDir = () => {
  const timestamp = moment().format('YYYYMMDD_HH_mm_ss_SSS')
  return path.join(os.tmpdir(), 'baseline', timestamp)
}

baselineRouter.post(
  '/create',
  checkToken,
  async (
    req: Req<
      {},
      {
        platform: string
        version_name: string
        app_type: NativeAppType
        core_version: string
        cli_version?: string
        version_number: number
        min_supported_version: string
        env: string
      }
    >,
    res,
    next,
  ) => {
    try {
      const uid = req.users.id

      logger.info('baseline create request received')

      // 解析上传的文件
      const form = formidable()
      const { fields, files } = await new Promise<{
        fields: formidable.Fields
        files: formidable.Files
      }>((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            reject(err)
          } else {
            resolve({ fields, files })
          }
        })
      })

      // 从表单字段中获取meta信息
      const metaField = fields.meta as string
      if (!metaField) {
        throw new AppError('meta information is required')
      }

      let meta
      try {
        meta = JSON.parse(metaField)
      } catch (error) {
        throw new AppError('invalid meta format')
      }

      const {
        platform,
        version_name,
        app_type,
        core_version,
        cli_version,
        version_number,
        min_supported_version,
        env,
      } = meta

      if (_.isEmpty(_.get(files, 'package'))) {
        throw new AppError(
          'upload file is required',
          ErrorCode.PARAMS_INVALID,
          400,
        )
      }

      const packageFile = files.package as formidable.File
      if (packageFile.mimetype !== 'application/zip') {
        throw new AppError(
          `upload file type is invalid: ${packageFile.mimetype}`,
          ErrorCode.PARAMS_INVALID,
          400,
        )
      }

      // 创建临时目录
      const baselineTempDir = getBaselineTempDir()
      await createEmptyFolder(baselineTempDir)

      // 解压文件到临时目录
      const extractedPath = await unzipFile(
        packageFile.filepath,
        baselineTempDir,
        logger,
      )

      logger.info('baseline file extracted successfully', {
        originalPath: packageFile.filepath,
        extractedPath: extractedPath,
      })

      // 创建基线时，先创建or获取版本元数据
      let appMeta: AppsVersionMetaInterface | null = null
      if (_.isEmpty(core_version)) {
        // 没有传core_version，说明是添加动态基线
        appMeta = await AppMeta.findOne({
          where: {
            platform,
            version_name,
            app_type,
          },
        })
      } else {
        appMeta = await baselineManager.findOrCreateAppMeta(
          {
            platform,
            version_name,
            core_version,
            cli_version,
            version_number,
            min_supported_version,
            app_type,
          },
          logger,
        )
      }

      if (!appMeta) {
        throw new AppError(
          'create app meta failed',
          ErrorCode.UPDATE_ERROR,
          500,
        )
      }

      logger.debug('baseline create app meta', { appMeta })

      // 处理基线文件
      const baseLineRecords = await baselineManager.createNativeBaseline(
        extractedPath,
        appMeta.id,
        platform,
        version_name,
        uid,
        env,
        logger,
      )

      next({ baseLineRecords, appMetaId: appMeta.id })
    } catch (error) {
      logger.error('baseline create error:', error)
      next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.UPDATE_ERROR, 500),
      )
    }
  },
)

baselineRouter.get('/find', async (req, res, next) => {
  try {
    const { platform, version_name, file_type, app_type } = req.query
    if (!platform || !version_name || !app_type) {
      return res.status(400).json({
        error: 'Missing required parameters: platform, version_name, app_type',
      })
    }

    logger.debug('baseline find request received', {
      platform,
      version_name,
      file_type,
      app_type,
    })

    const result = await baselineManager.findBaseline({
      platform: platform as string,
      version_name: version_name as string,
      app_type: app_type as NativeAppType,
      file_type: file_type as BaseLineFileType,
    })

    if (!result) {
      return next([])
    }

    next(result)
  } catch (error) {
    logger.error('baseline find error:', error)
    next(
      error instanceof AppError
        ? error
        : new AppError(error, ErrorCode.QUERY_ERROR, 500),
    )
  }
})

baselineRouter.post(
  '/upadte_min_supported_version',
  checkToken,
  async (
    req: Req<
      {},
      {
        platform: string
        versionName: string
        minSupportedVersion: string
      }
    >,
    res,
    next,
  ) => {
    try {
      logger.info('baseline update min supported version request received')

      const { platform, versionName, minSupportedVersion } = req.body

      if (!platform || !versionName || !minSupportedVersion) {
        throw new AppError(
          'Missing required parameters: platform, versionName, minSupportedVersion',
        )
      }

      const [count] = await AppMeta.update(
        {
          min_supported_version: minSupportedVersion,
        },
        {
          where: {
            platform,
            version_name: versionName,
            app_type: NativeAppType.RELEASE,
          },
        },
      )

      if (!count) {
        throw new AppError('Update min supported version failed')
      }

      next(count === 1)
    } catch (error) {
      logger.error('baseline update min supported version error:', error)
      next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.UPDATE_ERROR, 500),
      )
    }
  },
)
