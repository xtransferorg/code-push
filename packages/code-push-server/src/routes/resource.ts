import express from 'express'
import { body, query, validationResult } from 'express-validator'
import { checkToken, Req, Res } from '../core/middleware'
import { AppError, ErrorCode } from '../core/app-error'
import { ResourceFiles } from '../models/resourceFile'
import { NativeAppVersions } from '../models/native_app_versions'
import { parseReqFile } from '../core/services/resource-manager'
import { uploadFileToStorage } from '../core/utils/storage'
import { qetag } from '../core/utils/qetag'
import logger from '../core/logger'
import { getBlobDownloadUrl } from '../core/utils/common'
import { NativeApps } from '../models/native_apps'

// 通用常量
const RESPONSE_SUCCESS_CODE = 0
const RESPONSE_SUCCESS_MESSAGE = 'success'
const RESPONSE_ERROR_DATA = {}
const UPLOAD_TYPE_NEW = 'new'
const UPLOAD_TYPE_OVERWRITE = 'overwrite'

export const resourceRouter = express.Router()

resourceRouter.post(
  '/upload',
  checkToken,
  async (req: Req, res, next) => {
    try {
      const { params, file } = await parseReqFile(req, logger)
      const {
        app_version,
        name,
        platform,
        app_type,
        channel,
        environment,
        file_name,
      } = params

      logger.info('upload 解析参数', params)
      const app = await NativeApps.findOne({
        where: { name, platform, app_type },
      })
      if (!app) {
        return next(new AppError('未找到对应的 app', ErrorCode.NOT_FOUND, 404))
      }
      // 查 app_version_uuid
      const appVersionRow = await NativeAppVersions.findOne({
        where: {
          app_key: app.app_key,
          version_name: app_version,
          channel,
          environment,
        },
      })
      if (!appVersionRow) {
        return next(
          new AppError('未找到对应的 app 版本', ErrorCode.NOT_FOUND, 404),
        )
      }
      const app_version_uuid = appVersionRow.get('version_id')
      const exist = await ResourceFiles.findOne({
        where: { app_version_uuid },
      })
      let upload_type = UPLOAD_TYPE_NEW
      if (exist) {
        await exist.destroy()
        upload_type = UPLOAD_TYPE_OVERWRITE
      }
      const blob_hash = await qetag(file.filepath, logger)
      await uploadFileToStorage(blob_hash, file.filepath, logger)
      const created = await ResourceFiles.create({
        app_version_uuid,
        file_name,
        file_size: file.size,
        blob_url: blob_hash,
      })
      next({
        file_name,
        blob_url: blob_hash,
        file_size: file.size,
        created_at: created.get('created_at'),
        upload_type,
        app_version: appVersionRow,
      })
    } catch (err) {
      if (!(err instanceof AppError)) {
        return next(
          new AppError(err.message || '服务器内部错误', ErrorCode.Error, 500),
        )
      }
      next(err)
    }
  },
)

resourceRouter.get(
  '/',
  [
    query('app_version').notEmpty().withMessage('app_version 必填'),
    query('name').notEmpty().withMessage('name 必填'),
    query('platform').notEmpty().withMessage('platform 必填'),
    query('app_type').notEmpty().withMessage('app_type 必填'),
    query('channel').notEmpty().withMessage('channel 必填'),
    query('environment').notEmpty().withMessage('environment 必填'),
  ],
  async (req: Req, res, next) => {
    try {
      const { app_version, name, platform, app_type, channel, environment } =
        req.query
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return next(
          new AppError(
            errors
              .array()
              .map((e) => e.msg)
              .join(', '),
            ErrorCode.PARAMS_INVALID,
            400,
          ),
        )
      }
      // 查找 app_key
      const app = await NativeApps.findOne({
        where: { name, platform, app_type },
      })
      if (!app) {
        return next(new AppError('未找到对应的 app', ErrorCode.NOT_FOUND, 404))
      }
      const appVersionRow = await NativeAppVersions.findOne({
        where: {
          app_key: app.app_key,
          version_name: app_version,
          channel,
          environment,
        },
      })
      if (!appVersionRow) {
        return next(
          new AppError('未找到对应的 app 版本', ErrorCode.NOT_FOUND, 404),
        )
      }
      const app_version_uuid = appVersionRow.get('version_id')
      const file = await ResourceFiles.findOne({
        where: { app_version_uuid, deleted_at: null },
      })
      if (!file) {
        return next(new AppError('文件不存在', ErrorCode.NOT_FOUND, 404))
      }
      const blob_url = file.get('blob_url')
      next({
        file_name: file.get('file_name'),
        blob_url,
        download_url: getBlobDownloadUrl(blob_url),
        file_size: file.get('file_size'),
        created_at: file.get('created_at'),
        app_version: appVersionRow,
      })
    } catch (err) {
      if (!(err instanceof AppError)) {
        return next(
          new AppError(err.message || '服务器内部错误', ErrorCode.Error, 500),
        )
      }
      next(err)
    }
  },
)

resourceRouter.use((dataOrError: unknown, req: Req, res: Res, next) => {
  if (dataOrError instanceof AppError) {
    logger.error(dataOrError.message)
    res.status(dataOrError.status).send({
      code: dataOrError.code,
      message: dataOrError.message,
      data: RESPONSE_ERROR_DATA,
    })
  } else {
    res.send({
      code: RESPONSE_SUCCESS_CODE,
      message: RESPONSE_SUCCESS_MESSAGE,
      data: dataOrError,
    })
  }
})
