import { exec } from 'child_process'
import { config } from '../config'
import { readdir } from 'fs/promises'
import path from 'path'
import { isFileExit } from '../utils/common'

export async function diff(
  oldPath: string,
  newPath: string,
  output: string,
): Promise<string> {
  /**
    -m[-matchScore]
      默认选项; 所有文件都会被加载到内存; 一般生成的补丁文件比较小;
      需要的内存大小:(新版本文件大小+ 旧版本文件大小*5(或*9 当旧版本文件大小>=2GB时))+O(1);
      匹配分数matchScore>=0,默认为6,二进制数据时推荐设置为0到4,文件数据时推荐4--9等,跟输入
      数据的可压缩性相关,一般输入数据的可压缩性越大,这个值就可以越大。

    -SD[-stepSize]
      创建单压缩流的补丁文件, 这样patch时就只需要一个解压缩缓冲区, 并且可以支持边下载边patch;
      压缩步长stepSize>=(1024*4), 默认为256k, 推荐64k,2m等。

    -c-compressType[-compressLevel]
      设置补丁数据使用的压缩算法和压缩级别等, 默认不压缩;
      补丁另存时,使用新的压缩参数设置来输出新补丁;
      支持的压缩算法、压缩级别和字典大小等:
        -c-zlib[-{1..9}[-dictBits]]     默认级别 9
            压缩字典比特数dictBits可以为9到15, 默认为15。
            支持多线程并行压缩,很快！
        -c-ldef[-{1..12}]               默认级别 12
            输出压缩数据格式兼容于-c-zlib, 但比zlib压缩得更快或压缩得更小;
            使用了libdeflate压缩算法，且压缩字典比特数dictBits始终为15。
            支持多线程并行压缩,很快！
        -c-bzip2[-{1..9}]               (或 -bz2) 默认级别 9
        -c-pbzip2[-{1..9}]              (或 -pbz2) 默认级别 8
            支持并行压缩,生成的补丁和-c-bzip2的输出格式稍有不同。
        -c-lzma[-{0..9}[-dictSize]]     默认级别 7
            压缩字典大小dictSize可以设置为 4096, 4k, 4m, 128m等, 默认为8m
            支持2个线程并行压缩。
        -c-lzma2[-{0..9}[-dictSize]]    默认级别 7
            压缩字典大小dictSize可以设置为 4096, 4k, 4m, 128m等, 默认为8m
            支持多线程并行压缩,很快。
            警告: lzma和lzma2是不同的压缩编码格式。
        -c-zstd[-{0..22}[-dictBits]]    默认级别 20
            压缩字典比特数dictBits 可以为10到30, 默认为23。
            支持多线程并行压缩,较快。
   */
  const hdiffz = path.join(__dirname, `./${process.platform}/hdiffz`)
  if (!(await isFileExit(hdiffz))) {
    throw new Error('hdiffz not found. ' + hdiffz)
  }
  const diffCommand = `${hdiffz} -m-9 -SD -c-zstd-21-24 -g#.DS_Store "${oldPath}" "${newPath}" "${output}"`
  return new Promise((resolve, reject) => {
    exec(diffCommand, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout)
      }
    })
  })
}

export class Diff {
  private cache: Map<string, string> = new Map()
  static mInstance: Diff

  constructor(
    public oldPath: string,
    public newPath: string,
    public output: string,
  ) {}

  static getInstance(oldPath: string, newPath: string, output: string) {
    if (!Diff.mInstance) {
      Diff.mInstance = new Diff(oldPath, newPath, output)
    }
    return Diff.mInstance
  }

  public listVersions(): Promise<string[]> {
    return readdir(config.common.localCodePushDir)
  }

  public diff(): Promise<string> {
    return diff(this.oldPath, this.newPath, this.output)
  }
}
