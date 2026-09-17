import { DataTypes, Model } from 'sequelize'
import { sequelize } from '../core/utils/connections'
import type { Platform } from '@xrnjs/code-push-core'

export interface NativeAppsInterface extends Model {
  id: bigint
  name: string
  platform: Platform
  description?: string
  app_key: string
  icon_url?: string
  min_version?: string
  package_name?: string
}

export const NativeApps = sequelize.define<NativeAppsInterface>(
  'NativeApps',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      comment: '应用的唯一标识',
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: '应用的名称',
    },
    platform: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: '应用的平台类型',
    },
    description: {
      type: DataTypes.TEXT,
      comment: '应用的描述',
    },
    app_key: {
      type: DataTypes.STRING(255),
      allowNull: false,
      primaryKey: true,
      comment: '应用的AppKey',
    },
    icon_url: {
      type: DataTypes.TEXT,
      comment: '应用的Icon URL',
    },
    min_version: {
      type: DataTypes.STRING(50),
      comment: '应用兼容的最小版本',
    },
    package_name: {
      type: DataTypes.STRING(255),
      comment: '应用的包名',
    },
    app_type: {
      type: DataTypes.STRING(50),
      comment: '包类型',
    },
  },
  {
    tableName: 'native_apps',
    underscored: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    comment: '存储应用的基本信息',
  },
)
