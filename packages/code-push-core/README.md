# CodePush 管理 SDK（Node.js）

版本关系（后续远程有更新可进行合并）：

| 服务 | 当前版本 | 开源版本 |
| --- | --- | --- |
| @xrnjs/code-push-core | 0.0.1 | 2.0.7 |

这是一个用于以编程方式管理 CodePush 账户的 JavaScript 库（例如创建应用、推广发布等），可用于编写基于 Node.js 的构建和/或部署脚本，而无需依赖 [命令行工具 CLI](https://github.com/Microsoft/code-push/blob/master/cli/README.md)。

---

## 快速开始

1.  通过 CodePush CLI 命令创建访问密钥，以用于认证连接 CodePush 服务：
    

```shell
shell复制编辑code-push access-key add "密钥描述"

```

如果你已经创建了一个密钥并想使用它，可以运行：

```shell
shell复制编辑code-push access-key ls

```

从你希望使用的那一行中复制 `Key` 列的值即可。

2.  安装管理 SDK：
    

```shell
shell复制编辑npm install code-push --save

```

3.  通过以下语句引入 SDK（支持 ES6 语法）：
    

```javascript
javascript复制编辑var CodePush = require("code-push");

```

4.  使用你的访问密钥创建 `CodePush` 实例：
    

```javascript
javascript复制编辑var codePush = new CodePush("你的访问密钥");

```

5.  开始自动化管理你的账户吧！想了解 `codePush` 对象能做什么，请参考下方的 **API 参考**。
    

---

## API 参考

`code-push` 模块导出的是一个类（通常称为 `CodePush`），代表与 CodePush 管理 REST API 的交互代理。此类拥有一个构造函数用于认证连接 CodePush 服务，以及一系列实例方法，对应于 CLI 命令，允许你以编程方式管理 CodePush 账户的各个方面。

### 构造函数

*   **CodePush(accessKey: string)**  
    使用指定的访问密钥创建 CodePush 管理 SDK 的新实例。
    

---

### 方法

*   **addAccessKey(description: string): Promise<AccessKey>**  
    创建一个具有指定描述的新访问密钥（例如 "CI/CD 自动部署"）。
    
*   **addApp(name: string, os: string, platform: string, manuallyProvisionDeployments: boolean = false): Promise<App>**  
    创建一个新应用。可选参数 `manuallyProvisionDeployments` 为 `true` 时不会自动创建 "Staging" 和 "Production" 部署。
    
*   **addCollaborator(appName: string, email: string): Promise<void>**  
    向指定应用添加协作者。
    
*   **addDeployment(appName: string, deploymentName: string): Promise<Deployment>**  
    为指定应用添加一个新的部署环境。
    
*   **clearDeploymentHistory(appName: string, deploymentName: string): Promise<void>**  
    清空指定部署的历史版本记录。
    
*   **getAccessKey(accessKey: string): Promise<AccessKey>**  
    获取指定访问密钥的元数据。
    
*   **getAccessKeys(): Promise<AccessKey\[\]>**  
    获取账户下所有访问密钥的列表。
    
*   **getApp(appName: string): Promise<App>**  
    获取指定应用的元信息。
    
*   **getApps(): Promise<App\[\]>**  
    获取账户下所有应用的列表。
    
*   **getCollaborators(appName: string): Promise<CollaboratorMap>**  
    获取指定应用的协作者列表。
    
*   **getDeployment(appName: string, deploymentName: string): Promise<Deployment>**  
    获取指定部署环境的元信息。
    
*   **getDeploymentHistory(appName: string, deploymentName: string): Promise<Package\[\]>**  
    获取指定部署的历史发布记录。
    
*   **getDeploymentMetrics(appName: string, deploymentName: string): Promise<DeploymentMetrics>**  
    获取指定部署环境的安装统计信息。
    
*   **getDeployments(appName: string): Promise<Deployment\[\]>**  
    获取指定应用下的所有部署环境。
    
*   **patchRelease(appName: string, deploymentName: string, label: string, updateMetadata: PackageInfo): Promise<void>**  
    更新指定发布版本的元数据。
    
*   **promote(appName: string, sourceDeploymentName: string, destinationDeploymentName: string, updateMetadata: PackageInfo): Promise<Package>**  
    将最新发布从一个部署环境推广到另一个，并更新其元信息。
    
*   **release(appName: string, deploymentName: string, updateContentsPath: string, targetBinaryVersion: string, updateMetadata: PackageInfo): Promise<Package>**  
    向指定部署环境发布新版本。
    
*   **removeAccessKey(accessKey: string): Promise<void>**  
    删除指定的访问密钥。
    
*   **removeApp(appName: string): Promise<void>**  
    删除指定的应用。
    
*   **removeCollaborator(appName: string, email: string): Promise<void>**  
    从指定应用中移除协作者。
    
*   **removeDeployment(appName: string, deploymentName: string): Promise<void>**  
    删除指定部署环境。
    
*   **renameApp(oldAppName: string, newAppName: string): Promise<void>**  
    重命名指定应用。
    
*   **renameDeployment(appName: string, oldDeploymentName: string, newDeploymentName: string): Promise<void>**  
    重命名部署环境。
    
*   **rollback(appName: string, deploymentName: string, targetRelease?: string): Promise<void>**  
    回滚指定部署到上一个发布版本。可选参数 `targetRelease` 指定具体要回滚到的版本。
    
*   **transferApp(appName: string, email: string): Promise<void>**  
    将应用所有权转移给指定账户。
    

---

## 错误处理

当方法执行出错时，返回的 `Promise` 会被一个 `CodePushError` 对象拒绝，该对象包含以下属性：

*   **message**：描述错误的人类可读信息。
    
*   **statusCode**：HTTP 状态码，表示错误类型：
    

| 错误类型 | 描述 |
| --- | --- |
| `CodePush.ERROR_GATEWAY_TIMEOUT` | 网络错误，无法连接到 CodePush 服务器 |
| `CodePush.ERROR_INTERNAL_SERVER` | 服务器内部错误 |
| `CodePush.ERROR_NOT_FOUND` | 请求的资源不存在 |
| `CodePush.ERROR_CONFLICT` | 要创建的资源已存在 |
| `CodePush.ERROR_UNAUTHORIZED` | 配置的访问密钥无效或已过期 |
