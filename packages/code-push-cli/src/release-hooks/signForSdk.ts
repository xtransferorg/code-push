import * as cli from '../definitions/cli'
import fs from 'fs'
import jwt from 'jsonwebtoken'
import os from 'os'
import path from 'path'
import rimraf from 'rimraf'
import { generatePackageHashFromDirectory } from '../lib/hash-utils'

var CURRENT_CLAIM_VERSION: string = '1.0.0'
var METADATA_FILE_NAME: string = '.codepushrelease'

interface CodeSigningClaims {
  claimVersion: string
  contentHash: string
}

const deletePreviousSignatureIfExists = async (
  targetPackage: string,
): Promise<void> => {
  let signatureFilePath: string = path.join(targetPackage, METADATA_FILE_NAME)
  let prevSignatureExists: boolean = true
  try {
    fs.accessSync(signatureFilePath, fs.constants.R_OK)
  } catch (err) {
    if (err.code === 'ENOENT') {
      prevSignatureExists = false
    } else {
      throw new Error(
        `Could not delete previous release signature at ${signatureFilePath}.
                Please, check your access rights.`,
      )
    }
  }

  if (prevSignatureExists) {
    console.log(`Deleting previous release signature at ${signatureFilePath}`)
    rimraf.sync(signatureFilePath)
  }
}

const getPrivateKey = (privateKeyPath: string): Buffer => {
  try {
    return fs.readFileSync(privateKeyPath)
  } catch (err) {
    throw new Error(
      `The path specified for the signing key ("${privateKeyPath}") was not valid`,
    )
  }
}

const signForSdk = async (
  privateKeyPath: string,
  packagePath: string,
): Promise<string> => {
  if (!privateKeyPath) {
    if (fs.lstatSync(packagePath).isDirectory()) {
      // If new update wasn't signed, but signature file for some reason still appears in the package directory - delete it
      await deletePreviousSignatureIfExists(packagePath)
    }
    return packagePath
  }

  let privateKey: Buffer
  let signatureFilePath: string
  let finalPackagePath: string = packagePath

  try {
    privateKey = getPrivateKey(privateKeyPath)
    signatureFilePath = path.join(packagePath, METADATA_FILE_NAME)

    if (!fs.lstatSync(packagePath).isDirectory()) {
      // If releasing a single file, copy the file to a temporary 'CodePush' directory in which to publish the release
      var outputFolderPath: string = path.join(os.tmpdir(), 'CodePush')
      rimraf.sync(outputFolderPath)
      fs.mkdirSync(outputFolderPath)

      var outputFilePath: string = path.join(
        outputFolderPath,
        path.basename(packagePath),
      )
      fs.writeFileSync(outputFilePath, fs.readFileSync(packagePath, 'utf-8'))

      finalPackagePath = outputFolderPath
      signatureFilePath = path.join(finalPackagePath, METADATA_FILE_NAME)
    }

    await deletePreviousSignatureIfExists(finalPackagePath)

    const hash: string = await generatePackageHashFromDirectory(
      finalPackagePath,
      path.join(finalPackagePath, '..'),
    )

    const claims: CodeSigningClaims = {
      claimVersion: CURRENT_CLAIM_VERSION,
      contentHash: hash,
    }

    const signedJwt: string = await new Promise<string>((resolve, reject) => {
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

    await new Promise<void>((resolve, reject) => {
      fs.writeFile(signatureFilePath, signedJwt, (err: Error) => {
        if (err) {
          reject(err)
        } else {
          console.log(
            `Generated a release signature and wrote it to ${signatureFilePath}`,
          )
          resolve()
        }
      })
    })

    return finalPackagePath
  } catch (err: any) {
    throw new Error(`Could not sign package: ${err.message}`)
  }
}

export = signForSdk
