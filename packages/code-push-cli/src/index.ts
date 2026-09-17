import chalk from 'chalk'
import { initSdk } from './command-executor'

export const init = () => {
  try {
    initSdk()
  } catch (error) {
    console.warn(chalk.yellow('[Warning]  ' + error.message))
  }
}

export {
  sdk as AccountSdk,
  baselineSdk,
  nativeAppSdk,
  codePushSdk,
  deserializeConnectionInfo,
} from './command-executor'

export { default as CodePushSdk } from './release-hooks/sdk'
