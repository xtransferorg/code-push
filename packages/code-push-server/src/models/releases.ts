import { DataTypes, Model } from 'sequelize'
import { sequelize } from '../core/utils/connections'

export interface ReleaseInterface extends Model {
  id: number
  rollout: number
  white_list: string
  channel_release_id: number
  created_at: Date
  updated_at: Date
}

export const Releases = sequelize.define<ReleaseInterface>(
  'Releases',
  {
    id: {
      type: DataTypes.INTEGER({ length: 10 }),
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    channel_release_id: {
      type: DataTypes.BIGINT(),
      allowNull: false,
      unique: true,
    },
    rollout: DataTypes.INTEGER({ length: 3 }),
    white_list: DataTypes.STRING,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    tableName: 'releases',
    underscored: true,
  },
)
