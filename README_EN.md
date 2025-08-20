# code-push

Link
- [Chinese](./README.md)
- English

Project Introduction

'code-push' is a complete solution that supports hot updates on mobile devices such as React Native and Cordova. It includes the server side, command-line tools, SDK and core management library, and integrates an efficient binary differential algorithm (hdiffpatch). It supports multiple cloud storage and local deployment. It is suitable for enterprises to build their own hot update platforms.

Description of each module

- **code-push-cli**
Provide command-line tools that support account registration, login, application/deployment management, hot update package release, collaboration management, etc. It is suitable for developers' daily operations and automation scripts.

- **code-push-server**
Hot update server, compatible with Microsoft's official protocols, supports multiple storage options (local, Qiniu, OSS, S3, Tencent Cloud, etc.), and can be deployed with one click via Docker. Be responsible for the storage, distribution, permission and collaboration management of packages.

- **code-push-sdk**
The client integrates the SDK, supports mainstream frameworks such as React Native and Cordova, and is responsible for communicating with the server, pulling and applying hot update packages.

- **code-push-core**
Node.js management SDK is suitable for automating the management of CodePush accounts, applications, deployments, releases, etc. in the CI/CD process.

- **hdiffpatch-ios / hdiffpatch-android**
Efficient binary difference/synthesis algorithms enhance the volume compression ratio of hot update packets and are suitable for large-scale production environments.

Get started quickly

1. Install dependencies

```bash
pnpm install
```

2. Build the project

```bash
pnpm run build
```

3. Start the server

#### local development

```bash
pnpm run start:server
```

#### Docker one-click deployment

Under the 'packages/code-push-server' directory:

```bash
docker-compose up -d
```

By default, the code-push-server, MySQL, and Redis services will be started
The configuration of storage, database, cache, etc. can be customized through environment variables

#### major environment variables

- ` STORAGE_TYPE ` : local/qiniu/s3 / oss/tencentcloud
- 'MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_PASSWORD', etc
- 'REDIS_HOST', 'REDIS_PORT'
- 'OSS_ACCESS_KEY_ID', 'OSS_SECRET_ACCESS_KEY', etc. (if using OSS)

For details, please refer to [code-push-server/README.md](./packages/code-push-server/README.md).

4. Use the CLI tool

Global installation of CLI

```bash
npm install -g @xrnjs/code-push-cli
```

Common commands:

- Registration/login: 'code-push register'/' code-push login '
- Create the application: 'code-push app add <appName> <os> <platform>'
- release hot update: 'code-push release-react <appName> <platform> -d <Deployment>'
- Manage collaboration: 'code-push collaborator add <appName> <email>'

For more commands, please refer to [code-push-cli/README.md](./packages/code-push-cli/README.md).

5. Client Integration

- React Native integration: 'npm install -- save@xrnjs /react-native-code-push'
- Cordova integration: For details, please refer to the respective platform documentation

To configure the server address, refer to the SDK documentation and examples.

6. Advanced Usage

-CI /CD automation: Scripting management using the '@xrnjs/code-push-core' SDK
- Large packet optimization: Integrated hdiffpatch algorithm to enhance differential efficiency

Frequently Asked Questions

- Supports multiple cloud storage and local storage options
- Supports multiple environments (Staging/Production) and collaborative development
- Compatible with official Microsoft protocols for easy migration
For detailed issues and solutions, please refer to the README of each sub-module

Reference Document

- [code-push-cli/README.md](./packages/code-push-cli/README_EN.md)
- [code-push-server/README.md](./packages/code-push-server/README_EN.md)
- [code-push-sdk/README.md](./packages/code-push-sdk/README_EN.md)
- [code-push-core/README.md](./packages/code-push-core/README_EN.md)
- [hdiffpatch Project Documentation](./packages/hdiffpatch-ios/hdiffpatch/README.md)
