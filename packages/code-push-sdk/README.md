# React Native 的 CodePush 模块

## 工作原理

React Native 应用由 JavaScript 文件以及相关的 [图片](https://facebook.github.io/react-native/docs/images.html#content) 组成，这些文件会通过 [打包器](https://github.com/facebook/react-native/tree/master/packager) 打包，并作为平台特定的二进制文件（`.ipa` 或 `.apk`）的一部分发布。一旦应用发布，更新 JavaScript 代码（如修复 Bug、新功能）或图片资源，就需要重新编译并重新发布整个二进制文件，还要经过应用商店的审核。

CodePush 插件让你可以在用户设备上即时展示产品改进，通过让 JavaScript 和图片资源与 CodePush 服务器上的更新保持同步，从而实现“离线应用体验”+“网页般的快速更新”。此外，为了保证用户始终有可用版本，CodePush 会保留上一次的更新，以便在你发布了导致崩溃的更新时自动回滚。

*注意：涉及原生代码的更改（例如修改 `AppDelegate.m`/`MainActivity.java`、添加新插件）不能通过 CodePush 分发，必须通过应用商店更新。*

---

## 支持的 React Native 平台

- iOS (7+)
- Android (4.1+)
- Windows (UWP)

不同版本的 React Native 对应 CodePush 插件版本，请参考文档中的表格确认兼容性。

---

## 支持的组件

当你使用 React Native 的资源系统（`require("./foo.png")`）时，下列核心组件和属性的图片资源可以通过 CodePush 更新：

| 组件 | 属性 |
|------|------|
| `Image` | `source` |
| `MapView.Marker` *(需要 [react-native-maps](https://github.com/lelandrichardson/react-native-maps) `>=0.3.2`)* | `image` |
| `ProgressViewIOS` | `progressImage`, `trackImage` |
| `TabBarIOS.Item` | `icon`, `selectedIcon` |
| `ToolbarAndroid` *(React Native 0.21.0+)* | `actions[].icon`, `logo`, `overflowIcon` |

不支持动态更新的组件示例（依赖静态 `{ uri: "foo" }`）：

| 组件 | 属性 |
|------|------|
| `SliderIOS` | `maximumTrackImage`, `minimumTrackImage`, `thumbImage`, `trackImage` |
| `Video` | `source` |

---

## 快速开始

在完成 [CodePush 账号注册与初始化](https://docs.microsoft.com/en-us/appcenter/distribution/codepush/index) 后，在项目根目录运行：

```bash
npm install --save react-native-code-push
```

根据目标平台（iOS、Android、Windows）执行相应的安装步骤。  
如果同时支持多个平台，建议为每个平台创建独立的 CodePush 应用。

详细安装步骤：
- [iOS 安装](docs/setup-ios.md)
- [Android 安装](docs/setup-android.md)
- [Windows 安装](docs/setup-windows.md)

---

## 插件用法

集成 CodePush 后，需要控制两个策略：
1. 何时检查更新（如应用启动时、点击按钮时、定时器等）。
2. 当有更新时，如何呈现给用户。

可以通过将应用根组件 “CodePush 化” 来实现。

**方式 1：使用高阶组件：**
```javascript
import codePush from "react-native-code-push";

class MyApp extends Component {}

MyApp = codePush(MyApp);
```

**方式 2：使用 ES7 装饰器语法：**
```javascript
import codePush from "react-native-code-push";

@codePush
class MyApp extends Component {}
```

默认情况下，CodePush 会在每次应用启动时检查更新，并在下次重启时安装（除非是强制更新，会立即安装）。  
你也可以设置在应用从后台恢复时检查更新，或者手动调用 `codePush.sync()`。

---

## 应用商店指南合规性

- Google Play 无限制。
- iOS App Store 允许 OTA 更新 JS 和资源，但不能改变应用的主要用途、绕过安全机制等。
- 建议 iOS 不要开启 `updateDialog` 以避免被认为强制用户操作。

---

## 发布更新

使用 CodePush CLI 的 `release-react` 命令快速发布更新：
```bash
code-push release-react MyApp-iOS ios
code-push release-react MyApp-Android android
```

支持参数如：
- `-m` 强制更新
- `--description` 更新描述
- `--rollout` 分批发布
- `--targetBinaryVersion` 目标版本匹配

CodePush 支持差分更新，用户只会下载变更文件。

---

## 多部署测试

利用 `Staging`（预发布）和 `Production`（生产）环境先测试再发布，避免直接影响所有用户。  
可以：
1. 先发到 Staging
2. 自己测试
3. Promote 到 Production

---

## 动态部署分配

可以在运行时为特定用户指定不同的部署 key，从而实现：
- A/B 测试
- 提前体验版

通过 `codePush.sync({ deploymentKey: ... })` 实现。

---

## API 参考

- [JavaScript API](docs/api-js.md)
- [Objective-C API (iOS)](docs/api-ios.md)
- [Java API (Android)](docs/api-android.md)

---

## 示例应用 / 启动模板

社区的一些开源项目示例：
- [F8 App](https://github.com/fbsamples/f8app)
- [Feline for Product Hunt](https://github.com/arjunkomath/Feline-for-Product-Hunt)
- [GeoEncoding](https://github.com/LynxITDigital/GeoEncoding)
- [Math Facts](https://github.com/Khan/math-facts)

启动模板：
- [Native Starter Pro](http://strapmobile.com/native-starter-pro/)
- [Pepperoni](http://getpepperoni.com/)

---

## 调试 / 故障排查

- 使用 `code-push debug ios` 或 `code-push debug android` 查看日志。
- 确认部署 key 正确、版本匹配。
- 确认不是 Debug 模式（Debug 模式会直接加载打包器的 JS）。
- 针对 iOS Release 模式，需要在 `AppDelegate.m` 中引入 `RCTLog.h` 并调用 `RCTSetLogThreshold(RCTLogLevelInfo)`。

---

## 持续集成 / 发布

可以将 CodePush 集成到 CI/CD 流程中，例如：
- Visual Studio Team Services
- Travis CI

---

## TypeScript 使用

本模块自带 `*.d.ts` 类型定义文件，支持 VS Code 智能提示与编译时检查。  
如果在 `tsconfig.json` 中使用 `es6` 作为 `target` 或 `module`，需将 `moduleResolution` 设置为 `node`。

---

本项目遵循 [Microsoft 开源行为准则](https://opensource.microsoft.com/codeofconduct/)。如有问题可联系 [opencode@microsoft.com](mailto:opencode@microsoft.com)。
