import { DataTypes, Model } from 'sequelize'
import { sequelize } from '../core/utils/connections'

export interface ReportLogsInterface extends Model {
  id: bigint
  version_key: string
  client_version: string
  user_id?: string
  downloaded_time: Date
  device_info: string
  device_model?: string
  device_version?: string
  screen_resolution?: string
}

export const LogReportNativeAppLogs = sequelize.define<ReportLogsInterface>(
  'LogReportNativeAppDownload',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      comment: '下载记录的唯一标识',
    },
    version_key: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: '版本的标识，关联到 release_versions 表',
    },
    client_version: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '客户端当前版本',
      defaultValue: '0.0.0',
    },
    user_id: {
      type: DataTypes.STRING(255),
      comment: '下载用户的标识',
    },
    downloaded_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: '下载时间',
    },
    device_info: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: '下载设备的信息（如设备类型、操作系统版本等）',
    },
    device_model: {
      type: DataTypes.STRING(255),
      comment: '设备型号',
    },
    device_version: {
      type: DataTypes.STRING(255),
      comment: '设备版本',
    },
    screen_resolution: {
      type: DataTypes.STRING(50),
      comment: '屏幕分辨率（例如 1920x1080）',
    },
  },
  {
    tableName: 'log_report_native_app_download',
    underscored: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    comment: '记录用户下载应用的行为信息',
  },
)
