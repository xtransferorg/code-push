import xml2js from 'xml2js'
import fs from 'fs'
import path from 'path'

export function getCordovaProjectAppVersion(
  projectRoot?: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let configString: string
    try {
      projectRoot = projectRoot || process.cwd()
      configString = fs.readFileSync(path.join(projectRoot, 'config.xml'), {
        encoding: 'utf8',
      })
    } catch (error) {
      return reject(
        new Error(
          `Unable to find or read "config.xml" in the CWD. The "release-cordova" command must be executed in a Cordova project folder.`,
        ),
      )
    }

    xml2js.parseString(configString, (err: Error, parsedConfig: any) => {
      if (err) {
        reject(
          new Error(
            `Unable to parse "config.xml" in the CWD. Ensure that the contents of "config.xml" is valid XML.`,
          ),
        )
      }

      const config: any = parsedConfig.widget
      resolve(config['$'].version)
    })
  })
}
