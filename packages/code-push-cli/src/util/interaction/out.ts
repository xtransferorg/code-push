// Functions to support outputting stuff to the user
import { formatIsJson, formatIsCsv } from './io-options'

const Table = require('cli-table3')

//
// Output a line of plain text. Only outputs if the format is regular text.
// If passing a converter, then the raw data is output in json format instead.
//
export function text<T>(converter: { (data: T): string }, data: T): void
export function text(t: string): void
export function text(...args: any[]): void {
  console.assert(!formatIsCsv(), "this function doesn't support CSV mode")
  let converter: { (data: any): string }
  let data: any
  if (args.length === 1) {
    converter = null
    data = args[0]
  } else {
    ;[converter, data] = args
  }

  if (formatIsJson()) {
    if (converter) {
      console.log(JSON.stringify(data))
    }
  } else {
    converter = converter || ((s) => s)
    console.log(converter(data))
  }
}

//
// Output tabular data.
// By default, does a simple default table using cli-table3.
// If you want to, you can pass in explicit table initialization
// options. See https://github.com/cli-table/cli-table3 for docs
// on the module.
//
export function table(options: any, data: any[]): void {
  console.assert(!formatIsCsv(), "this function doesn't support CSV mode")

  if (!data) {
    data = options
    options = undefined
  }

  if (!formatIsJson()) {
    const cliTable = new Table(options)
    data.forEach((item) => cliTable.push(item))
    console.log(cliTable.toString())
  } else {
    console.log(JSON.stringify(data))
  }
}

// Formatting helper for cli-table3 - default command output table style
export function getCommandOutputTableOptions(header: string[]): object {
  return {
    head: header,
    style: {
      head: [],
    },
  }
}

export function printJson(object: any): void {
  text(JSON.stringify(object, /*replacer=*/ null, /*spacing=*/ 2))
}
