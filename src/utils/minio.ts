import * as Minio from 'minio'
import path from 'path'
import fs from 'fs'
import { logger } from '..'

export interface MinioConfig {
  endPoint: string
  port?: number
  useSSL?: boolean
  accessKey: string
  secretKey: string
}

export class MinioUtils {
  private static instance: Minio.Client | null = null
  private static config: MinioConfig | null = null
  private static initialized = false

  private constructor() {}

  /**
   * 初始化 MinIO 客户端
   * @param config 可选参数，不传则使用环境变量
   */
  static init(config?: MinioConfig): void {
    if (this.initialized) return

    const resolved: MinioConfig = {
      endPoint: config?.endPoint || process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: (config?.port ?? Number(process.env.MINIO_PORT)) || 9000,
      useSSL: config?.useSSL ?? process.env.MINIO_USE_SSL === 'true',
      accessKey: config?.accessKey || process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: config?.secretKey || process.env.MINIO_SECRET_KEY || 'minioadmin'
    }
    this.config = resolved
    this.initialized = true
  }

  /**
   * 获取 MinIO 实例（未初始化会抛错）
   */
  static getInstance(): Minio.Client {
    if (!this.config) {
      throw new Error('MinioUtils 未初始化，请先调用 init()')
    }
    if (!this.instance) {
      this.instance = new Minio.Client(this.config)
    }
    return this.instance
  }

  /**
   * 从疼讯服务器下载图片，并上传到minio中
   * @param {string} src 图片原始uri
   * @param {string} bucketName 桶名称
   * @param {string} uploadDir 图片上传路径
   * @returns {Promise<string>} minio对象文件名
   */
  static async fetchImageAndUpload(src: string, bucketName: string, uploadDir?: string) {
    const instance = this.getInstance()

    // 拉取在线图片
    const response: Response = await fetch(src)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 生成文件名
    const fileName = `${Date.now()}-${new URLSearchParams(src.split('?')[1]).get('fileid') ?? 'undefined'}`
    const objectName = uploadDir ? path.join(uploadDir, fileName) : fileName

    // 上传文件到 MinIO
    await instance.putObject(bucketName, objectName, buffer)
    logger.info(`上传语录 - 成功上传: ${fileName}`)
    return fileName
  }

  /**
   * 从缓存目录拉取音频，并上传到minio中
   * @param {string} src 文件原始名称
   * @param {string} bucketName 桶名称
   * @param {string} uploadDir 音频上传路径
   * @returns {Promise<string>} minio对象文件名
   */
  static async fetchAudioAndUpload(src: string, bucketName: string, uploadDir?: string) {
    const instance = this.getInstance()

    // 拉取本地文件
    const buffer = fs.readFileSync(src)

    // 生成文件名
    const fileName = `${Date.now()}-${src.split('/').pop().split('.')[0] ?? 'undefined'}`
    const objectName = uploadDir ? path.join(uploadDir, fileName) : fileName

    // 上传文件到 MinIO
    await instance.putObject(bucketName, objectName, buffer)
    logger.info(`收录音频 - 成功收录: ${fileName}`)
    return fileName
  }

  static async gacha(bucketName: string, dir?: string): Promise<string> {
    const instance = this.getInstance()
    // 获取所有文件名
    const files: Minio.BucketItem[] = await new Promise((resolve, reject) => {
      const objects: Minio.BucketItem[] = []
      const stream: Minio.BucketStream<Minio.BucketItem> = instance.listObjectsV2(bucketName, dir, true)
      stream.on('data', obj => objects.push(obj))
      stream.on('end', () => resolve(objects))
      stream.on('error', err => reject(err))
    })

    const randomFile: string = files[Math.floor(Math.random() * files.length)].name
    logger.info(`抽卡 - 抽取到: ${randomFile}`)
    return `${this.config.useSSL ? 'https' : 'http'}://${this.config.endPoint}:${
      this.config.port
    }/${bucketName}/${randomFile}`
  }

  static async gacha10Times(bucketName: string, dir?: string): Promise<string[]> {
    const instance = this.getInstance()
    // 获取所有文件名
    const files: Minio.BucketItem[] = await new Promise((resolve, reject) => {
      const objects: Minio.BucketItem[] = []
      const stream: Minio.BucketStream<Minio.BucketItem> = instance.listObjectsV2(bucketName, dir, true)
      stream.on('data', obj => objects.push(obj))
      stream.on('end', () => resolve(objects))
      stream.on('error', err => reject(err))
    })
    logger.warn(bucketName, dir)

    let randomFileSet: Set<string>
    if (files.length < 10) {
      randomFileSet = new Set(files.map(e => e.name))
    } else {
      randomFileSet = new Set()
      while (randomFileSet.size < 10) {
        randomFileSet.add(files[Math.floor(Math.random() * files.length)].name)
      }
    }
    logger.info(`抽卡10连 - 抽取到: ${Array.from(randomFileSet)}`)
    return Array.from(randomFileSet).map(
      randomFile =>
        `${this.config.useSSL ? 'https' : 'http'}://${this.config.endPoint}:${
          this.config.port
        }/${bucketName}/${randomFile}`
    )
  }
}
