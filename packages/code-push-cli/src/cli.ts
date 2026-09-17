#!/usr/bin/env node
import { command, showHelp } from './command-parser'
import { execute, sdk as AccountSdk, baselineSdk } from './command-executor'
import {} from './release-hooks/sdk'
import chalk from 'chalk'

export { AccountSdk, baselineSdk }

function run(): void {
  if (!command) {
    showHelp(/*showRootDescription*/ false)
    return
  }

  execute(command).catch((error: any): void => {
    console.error(chalk.red('[Error]  ' + error.message))

    process.exit(1)
  })
}

run()
