# CodePush 服务端

版本关系（后续远端有更新可以合并过来）：

| 服务 | 现在的版本 | 开源的版本 |
|:---:|:----:|:----:|
| @xt/code-push-server | 1.0.0 | 2.1.6 |

微软官方的 CodePush 在国内的网络访问较慢, 所以我们使用这个服务端来架设自己的 CodePush 服务

## 关于本项目

因为原 [code-push-server](https://github.com/lisong/code-push-server) 项目的作者没有积极维护了, 我们创建了这个项目用来:

-   保持依赖更新
-   修复任何与最新的客户端的兼容问题
-   我们只在生产环境使用了 react-native-code-push, 对于其他的 CodePush 客户端, 大部分功能应该没有差别, 如果遇到任何问题的话, 都欢迎提交 issue 或者 PR.

## 支持的存储方式

-   local: 在本地硬盘存储包文件
-   qiniu: 在[七牛云](http://www.qiniu.com/)存储包文件
-   s3: 在[aws](https://aws.amazon.com/)存储包文件
-   oss: 在[阿里云](https://www.aliyun.com/product/oss)存储包文件
-   tencentcloud: 在[腾迅云](https://cloud.tencent.com/product/cos)存储包文件

## 正确使用 code-push 热更新

-   苹果 App 允许使用热更新[Apple's developer agreement](https://developer.apple.com/programs/ios/information/iOS_Program_Information_4_3_15.pdf), 为了不影响用户体验，规定必须使用静默更新。 Google Play 不能使用静默更新，必须弹框告知用户 App 有更新。中国的 android 市场必须采用静默更新（如果弹框提示，App 会被“请上传最新版本的二进制应用包”原因驳回）。
-   react-native 不同平台 bundle 包不一样，在使用 code-push-server 的时候必须创建不同的应用来区分(eg. CodePushDemo-ios 和 CodePushDemo-android)
-   react-native-code-push 只更新资源文件,不会更新 java 和 Objective C，所以 npm 升级依赖包版本的时候，如果依赖包使用的本地化实现, 这时候必须更改应用版本号(ios 修改 Info.plist 中的 CFBundleShortVersionString, android 修改 build.gradle 中的 versionName), 然后重新编译 app 发布到应用商店。
-   推荐使用 code-push release-react 命令发布应用，该命令合并了打包和发布命令(eg. code-push release-react CodePushDemo-ios ios -d Production)
-   每次向 App Store 提交新的版本时，也应该基于该提交版本同时向 code-push-server 发布一个初始版本。(因为后面每次向 code-push-server 发布版本时，code-puse-server 都会和初始版本比较，生成补丁版本)

## 常见问题

-   [修改密码](https://github.com/lisong/code-push-server/issues/43)
-   [code-push-server 使用+一些需要注意的地方](https://github.com/lisong/code-push-server/issues/135)
-   支持的 targetBinaryVersion
    -   `*`
    -   `1.2.3`
    -   `1.2`/`1.2.*`
    -   `1.2.3 - 1.2.7`
    -   `>=1.2.3 <1.2.7`
    -   `~1.2.3`
    -   `^1.2.3`

## 部署配置

用到的环境变量

```
OSS_ENDPOINT
OSS_BUCKET_NAME
CPS_DOWNLOAD_HOST
OSS_PREFIX
STORAGE_TYPE
OSS_ACCESS_KEY_ID
OSS_SECRET_ACCESS_KEY

MYSQL_HOST
MYSQL_PORT
MYSQL _USERNAME
MYSQL_PASSWORD
MYSQL_DATABASE
STORAGE_DIR
DATA_DIR
NODE_ENV
CONFIG_FILE
REDIS_HOST
REDIS_PORT
REDIS_PASSWORD

USE_REDIS
BUILD_ENV PROD/PRE/TEST
```

目前存储使用的 mysql，缓存用的 redis，静态资源用的 oss
