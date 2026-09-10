import * as cli from '../definitions/cli'
import fs from 'fs'
import jwt from 'jsonwebtoken'
import os from 'os'
import path from 'path'
import rimraf from 'rimraf'
import { generatePackageHashFromDirectory } from '../lib/hash-utils'

import CoreModules = require('@xrnjs/code-push-core')
const { AccountManager } = CoreModules

var CURRENT_CLAIM_VERSION: string = '1.0.0'
var METADATA_FILE_NAME: string = '.codepushrelease'

interface CodeSigningClaims {
  claimVersion: string
  contentHash: string
}

const deletePreviousSignatureIfExists = (
  targetPackage: string,
): Promise<any> => {
  let signatureFilePath: string = path.join(targetPackage, METADATA_FILE_NAME)
  let prevSignatureExists: boolean = true
  try {
    fs.accessSync(signatureFilePath, fs.constants.R_OK)
  } catch (err) {
    if (err.code === 'ENOENT') {
      prevSignatureExists = false
    } else {
      return Promise.reject(
        new Error(
          `Could not delete previous release signature at ${signatureFilePath}.
                Please, check your access rights.`,
        ),
      )
    }
  }

  if (prevSignatureExists) {
    console.log(`Deleting previous release signature at ${signatureFilePath}`)
    rimraf.sync(signatureFilePath)
  }

  return Promise.resolve(<void>null)
}

var sign: cli.ReleaseHook = (
  currentCommand: cli.IReleaseCommand,
  originalCommand: cli.IReleaseCommand,
  sdk: InstanceType<typeof AccountManager>,
): Promise<cli.IReleaseCommand> => {
  if (!currentCommand.privateKeyPath) {
    if (fs.lstatSync(currentCommand.package).isDirectory()) {
      // If new update wasn't signed, but signature file for some reason still appears in the package directory - delete it
      return deletePreviousSignatureIfExists(currentCommand.package).then(
        () => {
          return Promise.resolve<cli.IReleaseCommand>(currentCommand)
        },
      )
    } else {
      return Promise.resolve<cli.IReleaseCommand>(currentCommand)
    }
  }

  let privateKey: Buffer
  let signatureFilePath: string

  return Promise.resolve(<void>null)
    .then(() => {
      signatureFilePath = path.join(currentCommand.package, METADATA_FILE_NAME)
      try {
        privateKey = fs.readFileSync(currentCommand.privateKeyPath)
      } catch (err) {
        return Promise.reject(
          new Error(
            `The path specified for the signing key ("${currentCommand.privateKeyPath}") was not valid`,
          ),
        )
      }

      if (!fs.lstatSync(currentCommand.package).isDirectory()) {
        // If releasing a single file, copy the file to a temporary 'CodePush' directory in which to publish the release
        var outputFolderPath: string = path.join(os.tmpdir(), 'CodePush')
        rimraf.sync(outputFolderPath)
        fs.mkdirSync(outputFolderPath)

        var outputFilePath: string = path.join(
          outputFolderPath,
          path.basename(currentCommand.package),
        )
        fs.writeFileSync(
          outputFilePath,
          fs.readFileSync(currentCommand.package),
        )

        currentCommand.package = outputFolderPath
      }

      return deletePreviousSignatureIfExists(currentCommand.package)
    })
    .then(() => {
      return generatePackageHashFromDirectory(
        currentCommand.package,
        path.join(currentCommand.package, '..'),
      )
    })
    .then((hash: string) => {
      return new Promise<string>((resolve, reject) => {
        const claims: CodeSigningClaims = {
          claimVersion: CURRENT_CLAIM_VERSION,
          contentHash: hash,
        }

        jwt.sign(
          claims,
          privateKey,
          {
            algorithm: 'RS256',
          },
          (err, token) => {
            if (err) {
              return reject(
                new Error('The specified signing key file was not valid'),
              )
            }
            resolve(token)
          },
        )
      })
    })
    .then((signedJwt: string) => {
      return new Promise<void>((resolve, reject) => {
        fs.writeFile(signatureFilePath, signedJwt, (err: Error) => {
          if (err) {
            reject(err)
          } else {
            console.log(
              `Generated a release signature and wrote it to ${signatureFilePath}`,
            )
            resolve(<void>null)
          }
        })
      })
    })
    .then(() => {
      return currentCommand
    })
    .catch((err: Error) => {
      err.message = `Could not sign package: ${err.message}`
      return Promise.reject<cli.IReleaseCommand>(err)
    })
}

export = sign
