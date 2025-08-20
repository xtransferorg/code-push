# CodePush 服务端

版本关系（后续远端有更新可以合并过来）：

| 服务 | 现在的版本 | 开源的版本 |
|:---:|:----:|:----:|
| @xrnjs/code-push-server | 0.0.1 | 2.1.6 |

微软官方的 CodePush 在国内的网络访问较慢, 所以我们使用这个服务端来架设自己的 CodePush 服务

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

## 常见问题

-   支持的 targetBinaryVersion
    -   `*`
    -   `1.2.3`
    -   `1.2`/`1.2.*`
    -   `1.2.3 - 1.2.7`
    -   `>=1.2.3 <1.2.7`
    -   `~1.2.3`
    -   `^1.2.3`

## 部署

在根目录运行
```bash
docker-compose up -d
```

然后访问 `http://localhost:3000` 即可

停止服务

```bash
docker-compose down
```
