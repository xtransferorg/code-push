CREATE TABLE IF NOT EXISTS `apps` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL DEFAULT '',
  `uid` bigint(20) unsigned NOT NULL DEFAULT '0',
  `os` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `platform` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `is_use_diff_text` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `native_app_key` varchar(64) DEFAULT NULL COMMENT '隶属的原生 App key',
  `repository_url` text COMMENT '仓库地址',
  `port` int DEFAULT NULL COMMENT '端口号',
  `delivery_type` varchar(20) DEFAULT NULL COMMENT '应用下发类型：INNER内置包/DYNAMIC动态包',
  `build_type` varchar(20) DEFAULT NULL COMMENT '构建类型：debug/release',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_name` (`name`(12))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `collaborators` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `appid` int(10) unsigned NOT NULL DEFAULT '0',
  `uid` bigint(20) unsigned NOT NULL DEFAULT '0',
  `roles` varchar(20) NOT NULL DEFAULT '',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_appid` (`appid`),
  KEY `idx_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `deployments` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `appid` int(10) unsigned NOT NULL DEFAULT '0',
  `name` varchar(20) NOT NULL DEFAULT '',
  `description` varchar(500) NOT NULL DEFAULT '',
  `deployment_key` varchar(64) NOT NULL,
  `last_deployment_version_id` int(10) unsigned NOT NULL DEFAULT '0',
  `label_id` int(11) unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_appid` (`appid`),
  KEY `idx_deploymentkey` (`deployment_key`(40))
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `deployments_history` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `deployment_id` int(11) unsigned NOT NULL DEFAULT '0',
  `package_id` int(10) unsigned NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_deployment_id` (`deployment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `deployments_versions` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `deployment_id` int(11) unsigned NOT NULL DEFAULT '0',
  `app_version` varchar(100) NOT NULL DEFAULT '',
  `current_package_id` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `min_version` bigint(20) unsigned NOT NULL DEFAULT '0',
  `max_version` bigint(20) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_did_minversion` (`deployment_id`,`min_version`),
  KEY `idx_did_maxversion` (`deployment_id`,`max_version`),
  KEY `idx_did_appversion` (`deployment_id`,`app_version`(30))
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `packages` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `deployment_version_id` int(10) unsigned NOT NULL DEFAULT '0',
  `deployment_id` int(10) unsigned NOT NULL DEFAULT '0',
  `description` varchar(500) NOT NULL DEFAULT '',
  `package_hash` varchar(64) NOT NULL DEFAULT '',
  `blob_url` varchar(255) NOT NULL DEFAULT '',
  `size` int(11) unsigned NOT NULL DEFAULT '0',
  `manifest_blob_url` varchar(255) NOT NULL DEFAULT '',
  `release_method` varchar(20) NOT NULL DEFAULT '',
  `label` varchar(20) NOT NULL DEFAULT '',
  `original_label` varchar(20) NOT NULL DEFAULT '',
  `original_deployment` varchar(20) NOT NULL DEFAULT '',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `released_by` bigint(20) unsigned NOT NULL DEFAULT '0',
  `is_mandatory` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `is_disabled` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `rollout` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `uuid` char(36) NULL DEFAULT NULL,
  `release_id` bigint(20) UNSIGNED NULL DEFAULT NULL,
  `app_binary_time` VARCHAR(255) NULL COMMENT '发布时间',
  `common_hash` VARCHAR(255) NULL DEFAULT NULL COMMENT '热更新包对应的原生版本commonHash',
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_deploymentid_label` (`deployment_id`,`label`(8)),
  KEY `idx_versions_id` (`deployment_version_id`),
  KEY `idx_common_hash` (`common_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `packages_diff` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `package_id` int(11) unsigned NOT NULL DEFAULT '0',
  `diff_against_package_hash` varchar(64) NOT NULL DEFAULT '',
  `diff_blob_url` varchar(255) NOT NULL DEFAULT '',
  `diff_size` int(11) unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_packageid_hash` (`package_id`,`diff_against_package_hash`(40))
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `packages_metrics` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `package_id` int(10) unsigned NOT NULL DEFAULT '0',
  `active` int(10) unsigned NOT NULL DEFAULT '0',
  `downloaded` int(10) unsigned NOT NULL DEFAULT '0',
  `failed` int(10) unsigned NOT NULL DEFAULT '0',
  `installed` int(10) unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_packageid` (`package_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `user_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uid` bigint(20) unsigned NOT NULL DEFAULT '0',
  `name` varchar(50) NOT NULL DEFAULT '',
  `tokens` varchar(64) NOT NULL DEFAULT '',
  `created_by` varchar(64) NOT NULL DEFAULT '',
  `description` varchar(500) NOT NULL DEFAULT '',
  `is_session` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `expires_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_uid` (`uid`),
  KEY `idx_tokens` (`tokens`) KEY_BLOCK_SIZE=16
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `users` (
  `id` bigint(11) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL DEFAULT '',
  `password` varchar(255) NOT NULL DEFAULT '',
  `email` varchar(100) NOT NULL DEFAULT '',
  `identical` varchar(10) NOT NULL DEFAULT '',
  `ack_code` varchar(10) NOT NULL DEFAULT '',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `udx_identical` (`identical`),
  KEY `udx_username` (`username`),
  KEY `idx_email` (`email`) KEY_BLOCK_SIZE=20
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `users` (`id`, `username`, `password`, `email`, `identical`, `ack_code`, `updated_at`, `created_at`)
VALUES
	(1,'admin','$2a$12$mvUY9kTqW4kSoGuZFDW0sOSgKmNY8SPHVyVrSckBTLtXKf6vKX3W.','lisong2010@gmail.com','4ksvOXqog','oZmGE','2016-11-14 10:46:55','2016-02-29 21:24:49');

CREATE TABLE IF NOT EXISTS `versions` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `type` tinyint(3) unsigned NOT NULL DEFAULT '0' COMMENT '1.DBversion',
  `version` varchar(10) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `udx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

LOCK TABLES `versions` WRITE;
INSERT INTO `versions` (`id`, `type`, `version`)
VALUES
	(1,1,'0.5.0');
UNLOCK TABLES;

CREATE TABLE IF NOT EXISTS `log_report_deploy` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `status` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `package_id` int(10) unsigned NOT NULL DEFAULT '0',
  `client_unique_id` varchar(100) NOT NULL DEFAULT '',
  `previous_label` varchar(20) NOT NULL DEFAULT '',
  `previous_deployment_key` varchar(64) NOT NULL DEFAULT '',
  `patch_status` tinyint(3) DEFAULT NULL COMMENT 'patch失败记录',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `log_report_download` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `package_id` int(10) unsigned NOT NULL DEFAULT '0',
  `client_unique_id` varchar(100) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `releases` (
  `id` bigint(20) unsigned NOT NULL auto_increment COMMENT '映射id',
  `channel_release_id` bigint(20) NOT NULL DEFAULT 0 COMMENT '发布id',
  `white_list` text NULL COMMENT '灰度白名单',
  `rollout` tinyint(3) unsigned NOT NULL DEFAULT 0 COMMENT '灰度比例',
  `created_at` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY `PRIMARY` (`id`),
  UNIQUE KEY `uniq_channel_release_id` (`channel_release_id`)
) COMMENT '将app和渠道发布关联' CHARACTER SET utf8;

CREATE TABLE IF NOT EXISTS `log_report_native_app_download` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '下载记录的唯一标识',
  `version_key` varchar(64) NOT NULL COMMENT '版本的标识，关联到 release_versions 表',
  `user_id` varchar(255) DEFAULT NULL COMMENT '下载用户的标识',
  `downloaded_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下载时间',
  `device_info` text COMMENT '下载设备的信息（如设备类型、操作系统版本等）',
  `device_model` varchar(255) DEFAULT NULL COMMENT '设备型号',
  `device_version` varchar(255) DEFAULT NULL COMMENT '设备版本',
  `screen_resolution` varchar(50) DEFAULT NULL COMMENT '屏幕分辨率（例如 1920x1080）',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `created_at` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '是否删除（0：未删除，1：已删除）',
  `client_version` varchar(50) NOT NULL DEFAULT '0.0.0' COMMENT '客户端的版本',
  PRIMARY KEY (`id`),
  KEY `idx_version_key` (`version_key`),
  KEY `idx_device_model` (`device_model`),
  KEY `idx_device_version` (`device_version`),
  KEY `idx_screen_resolution` (`screen_resolution`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3 COMMENT = '记录用户下载应用的行为信息';

CREATE TABLE IF NOT EXISTS `native_app_versions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '自增id',
  `version_id` varchar(64) NOT NULL COMMENT 'uuid，唯一标识，外部关联',
  `app_meta_id` bigint(20) NULL COMMENT 'meta信息表关联id',
  `app_key` varchar(64) NOT NULL COMMENT '应用的标识，关联到 apps 表',
  `version_number` varchar(50) NOT NULL COMMENT '应用的内部版本号',
  `version_name` varchar(50) NOT NULL COMMENT '应用的版本名称，展示给用户的版本号',
  `changelog` text COMMENT '版本的更新内容说明',
  `download_url` varchar(2048) DEFAULT NULL COMMENT '版本的下载链接（OSS的文件地址，用于生产环境）',
  `download_url_arm32` varchar(2048) DEFAULT NULL COMMENT '32位 apk 版本的下载链接（OSS的文件地址，用于生产环境）',
  `download_url_arm64` varchar(2048) DEFAULT NULL COMMENT '64为 apk 版本的下载链接（OSS的文件地址，用于生产环境）',
  `rollout` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '灰度流量，默认0，上限100',
  `white_list` text COMMENT '灰度白名单',
  `build_type` varchar(64) NOT NULL DEFAULT 'debug' COMMENT '包的类型',
  `is_backward_compatible` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否兼容前一个版本',
  `status` varchar(255) NOT NULL DEFAULT 'ready_for_review' COMMENT '发布状态',
  `environment` varchar(64) NOT NULL DEFAULT 'dev' COMMENT '环境，测试环境和生产',
  `update_type` varchar(255) NOT NULL DEFAULT 'Silent' COMMENT '更新类型，强更或静默',
  `channel` varchar(50) DEFAULT NULL COMMENT '发布渠道，例如华为、Google等',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `created_at` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '是否删除（0：未删除，1：已删除）',
  `only_apply_version` varchar(50) DEFAULT NULL COMMENT '只允许升级的版本',
  `not_only_apply_version` varchar(50) DEFAULT NULL COMMENT '不允许升级的版本',
  `app_format` VARCHAR(64) NOT NULL COMMENT '应用格式',
  `review_passed` tinyint(2) DEFAULT 0 COMMENT '审核是否通过：0：未通过，1：通过',
  `package_size` bigint(20) unsigned DEFAULT 0 COMMENT '包的大小，单位：字节',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_version_id` (`version_id`),
  UNIQUE KEY `uniq_app_version_channel_environment` (`app_key`, `version_name`, `channel`, `environment`),
  KEY `idx_app_key` (`app_key`),
  KEY `idx_version_number` (`version_number`),
  KEY `idx_version_name` (`version_name`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3 COMMENT = '存储应用的版本信息';

CREATE TABLE IF NOT EXISTS `native_apps` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '应用的唯一标识',
  `name` varchar(255) NOT NULL COMMENT '应用的名称',
  `platform` varchar(255) NOT NULL COMMENT '应用的平台类型',
  `description` text COMMENT '应用的描述',
  `app_key` varchar(255) NOT NULL COMMENT '应用的AppKey',
  `icon_url` text COMMENT '应用的Icon URL',
  `min_version` varchar(50) DEFAULT NULL COMMENT '应用兼容的最小版本',
  `package_name` varchar(255) DEFAULT NULL COMMENT '应用的包名',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `created_at` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '是否删除（0：未删除，1：已删除）',
  `app_type` varchar(50) DEFAULT NULL COMMENT '应用的类型',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_app_key` (`app_key`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3 COMMENT = '存储应用的基本信息';


CREATE TABLE IF NOT EXISTS `native_baseline` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '原生某个基线文件的唯一标识',
  `app_meta_id` bigint(20) unsigned NULL COMMENT '关联原生版本信息表',
  `deployment_version_id` bigint(20) unsigned NULL COMMENT '关联bundle发布表, 仅file_type类型为BUNDLE_RESOURCE、BASE_PACKAGE时存在',
  `url` varchar(2048) NOT NULL COMMENT '基线文件的url',
  `file_name` varchar(255) NOT NULL COMMENT '基线文件的文件名',
  `file_hash` varchar(255) NOT NULL COMMENT '基线文件hash',
  `file_type` varchar(20) NOT NULL COMMENT '基线文件type, META|RAW|COMMON|COMMON_MAP|BUNDLE_RESOURCE|BASE_PACKAGE|NATIVE_SIGNATURE',
  `file_size` bigint(20) unsigned NOT NULL DEFAULT 0 COMMENT '基线文件大小',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `created_at` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '是否删除（0：未删除，1：已删除）',
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb3 COMMENT = '存储App版本的基线信息';


CREATE TABLE IF NOT EXISTS `app_version_meta` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '原生某个基线文件的唯一标识',
  `platform` varchar(20) NULL DEFAULT NULL COMMENT '平台',
  `version_number` varchar(128) NOT NULL DEFAULT '' COMMENT '版本number',
  `version_name` varchar(128) NOT NULL DEFAULT '' COMMENT 'App版本',
  `core_version` varchar(128) NOT NULL DEFAULT '' COMMENT 'core包版本',
  `cli_version` varchar(128) NOT NULL DEFAULT '' COMMENT 'cli版本',
  `min_supported_version` varchar(20) NOT NULL DEFAULT '' COMMENT '最小支持版本',
  `app_type` varchar(20) NOT NULL DEFAULT 'Release' COMMENT '应用类型: Release/Debug',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `created_at` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '是否删除（0：未删除，1：已删除）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_app_version_meta` (`platform`, `version_name`, `app_type`)
) ENGINE=InnoDB DEFAULT CHARSET = utf8mb3 COMMENT = '存储App版本metadata';