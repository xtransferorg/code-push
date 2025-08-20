import formidable from 'formidable'
import { AppError } from '../../core/app-error'

export async function parseReqFile(req, logger) {
  return new Promise<{ params: any; file: formidable.File }>((resolve, reject) => {
    const form = formidable()
    form.parse(req, (err, fields, files) => {
      if (err) return reject(new AppError('upload error'))
      const file = files.file as formidable.File
      resolve({
        params: {
          ...fields,
          file_name: file.newFilename,
        },
        file: file,
      })
    })
  })
}
