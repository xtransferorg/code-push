#!/usr/bin/env node
import { command, showHelp } from './command-parser'
import { execute } from './command-executor'
import chalk from 'chalk'

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
