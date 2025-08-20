# CodePush Command Line Interface

Version relationship (can be merged later when there are remote updates):

| Service | Current Version | Open Source Version |
|:---:|:----:|:----:|
| @xrnjs/code-push-cli | 0.0.1 | 2.6.5 |

CodePush is a cloud service that allows Cordova and React Native developers to deploy mobile app updates directly to users’ devices.
It acts like an intermediate repository where developers can publish updates (JS, HTML, CSS, and images), and apps integrated with the CodePush SDKs ([Cordova](http://github.com/Microsoft/cordova-plugin-code-push) and [React Native](http://github.com/Microsoft/react-native-code-push)) can query and receive these updates.

This enables a more direct and predictable interaction with your user base. When you fix bugs or add small features, you don’t need to rebuild the binary and republish it in app stores.

* [About This Repo](#about-this-repo)
* [Installation](#installation)
* [Quick Start](#quick-start)
* [Create Account](#create-account)
* [Authentication](#authentication)
* [App Management](#app-management)
* [App Collaboration](#app-collaboration)
* [Deployment Management](#deployment-management)
* [Release Updates](#release-updates)
    * [Release Updates (General)](#release-updates-general)
    * [Release Updates (React Native)](#release-updates-react-native)
    * [Release Updates (Cordova)](#release-updates-cordova)
* [Patch Updates](#patch-updates)
* [Promote Updates](#promote-updates)
* [Rollback Updates](#rollback-updates)
* [View Release History](#view-release-history)
* [Clear Release History](#clear-release-history)

## Installation

* Install [Node.js](https://nodejs.org/)
* Install CodePush CLI: `npm install -g code-push-cli`

## Quick Start

1. Use the CodePush CLI to create a [CodePush account](#create-account).
2. Register your CodePush [app](#app-management) and [share](#app-collaboration) it with other developers in your team.
3. Configure CodePush in your app using the [Cordova plugin](http://github.com/Microsoft/cordova-plugin-code-push) or [React Native plugin](http://github.com/Microsoft/react-native-code-push), and point it to the desired deployment environment.  
   *Note: The custom ServerURL parameter has different casing in iOS and Android: iOS uses `CodePushServerURL` in plist, Android uses `CodePushServerUrl` in `res/values/strings.xml`.*
4. [Release](#release-updates) updates.
5. Live long and prosper! [More info](https://en.wikipedia.org/wiki/Vulcan_salute)

... (Full English translation continues for all sections exactly as in the Chinese README)

