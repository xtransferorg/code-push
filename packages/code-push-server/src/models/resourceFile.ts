import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../core/utils/connections';

export interface ResourceFileInterface extends Model {
  id: number;
  app_version_uuid: string;
  file_name: string;
  file_size: number;
  blob_url: string;
}

export const ResourceFiles = sequelize.define<ResourceFileInterface>('ResourceFiles', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  app_version_uuid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: 'APP版本uuid',
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '唯一文件名',
  },
  file_size: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    comment: '文件大小，字节',
  },
  blob_url: {
    type: DataTypes.STRING(1024),
    allowNull: false,
    comment: 'CDN文件key',
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
  },
}, {
  tableName: 'resource_files',
  underscored: true,
  paranoid: true,
}); 