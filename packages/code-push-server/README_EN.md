# CodePush Server

Version relationship (can be merged later when remote updates are available):

| Service | Current Version | Open Source Version |
|:---:|:----:|:----:|
| @xrnjs/code-push-server | 0.0.1 | 2.1.6 |

Microsoft's official CodePush service is slow to access in mainland China, so we use this server to set up our own CodePush service.

## Supported Storage Methods

- local: Store package files on the local hard drive
- qiniu: Store package files on [Qiniu Cloud](http://www.qiniu.com/)
- s3: Store package files on [AWS](https://aws.amazon.com/)
- oss: Store package files on [Alibaba Cloud](https://www.aliyun.com/product/oss)
- tencentcloud: Store package files on [Tencent Cloud](https://cloud.tencent.com/product/cos)

## Correct Usage of CodePush Hot Updates

- Apple apps are allowed to use hot updates according to [Apple's developer agreement](https://developer.apple.com/programs/ios/information/iOS_Program_Information_4_3_15.pdf). To avoid affecting user experience, silent updates must be used. Google Play does not allow silent updates — you must display a dialog to inform the user that an update is available. In Chinese Android app markets, silent updates must be used (if you display a dialog, the app will be rejected with the reason “Please upload the latest binary package”).
- React Native bundle packages differ between platforms, so when using code-push-server you must create different apps to distinguish them (e.g., CodePushDemo-ios and CodePushDemo-android).
- react-native-code-push only updates resource files, not Java or Objective-C code. Therefore, when upgrading dependency versions via npm, if the dependency uses native implementations, you must change the application version number (for iOS, modify `CFBundleShortVersionString` in Info.plist; for Android, modify `versionName` in build.gradle), then rebuild the app and publish it to the app store.
- It is recommended to use the `code-push release-react` command to release apps. This command merges packaging and releasing into one step (e.g., `code-push release-react CodePushDemo-ios ios -d Production`).

## FAQ

- Supported `targetBinaryVersion` formats:
    - `*`
    - `1.2.3`
    - `1.2` / `1.2.*`
    - `1.2.3 - 1.2.7`
    - `>=1.2.3 <1.2.7`
    - `~1.2.3`
    - `^1.2.3`

## Deployment

In root directory, run:
```bash
docker-compose up -d
```

Then visit `http://localhost:3000`.

To stop the service:

```bash
docker-compose down
```
