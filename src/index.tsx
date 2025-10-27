import { Context, Logger, Schema } from 'koishi'
import {
  gachaLoong,
  gachaLoong10Times,
  gachaQuote,
  gachaQuote10Times,
  uploadLoong,
  uploadQuote
} from './controllers/quote'
import { MinioUtils } from './utils/minio'
import { symmetry } from './controllers/symmetry'
import { saveSticker } from './controllers/save'

export const name = 'maizono-bot'

export const logger: Logger = new Logger(name)

export interface QuoteMapping {
  bucket: string
  dir?: string
  uploadDir?: string
}

export interface LoongMapping {
  bucket: string
  dir?: string
}

interface MaizonoBotQuoteConfig {
  endPoint: string
  port: number
  accessKey: string
  secretKey: string
  useSSL: boolean

  quoteMapping: Record<string, QuoteMapping>
  loongMapping: Record<string, LoongMapping>
}

export type MaizonoBotConfig = MaizonoBotQuoteConfig

export const Config: Schema<MaizonoBotConfig> = Schema.object({
  endPoint: Schema.string().required().description('MinIO Endpoint'),
  port: Schema.number().min(1025).max(65535).required().description('MinIO端口'),
  accessKey: Schema.string().required().description('MinIO Access Key'),
  secretKey: Schema.string().role('secret').required().description('MinIO Secret Key'),
  useSSL: Schema.boolean().default(false).description('是否使用SSL'),

  quoteMapping: Schema.dict(
    Schema.object({
      bucket: Schema.string().default(name).description('Bucket名称'),
      dir: Schema.string().default('').description('对象存储路径(前缀)'),
      uploadDir: Schema.string().default('').description('对象上传路径(前缀)')
    })
  )
    .role('table')
    .description('语录功能群号与存储映射表，键为群号'),
  loongMapping: Schema.dict(
    Schema.object({
      bucket: Schema.string().default(name).description('Bucket名称'),
      dir: Schema.string().default('').description('对象存储路径(前缀)')
    })
  )
    .role('table')
    .description('龙图群号与存储映射表，键为群号')
})

export function apply(ctx: Context, config: MaizonoBotConfig) {
  // minio客户端
  MinioUtils.init({
    endPoint: config.endPoint, // MinIO 服务地址
    port: config.port, // MinIO 服务端口
    useSSL: config.useSSL, // 是否使用 HTTPS
    accessKey: config.accessKey, // MinIO 的访问密钥
    secretKey: config.secretKey // MinIO 的访问密钥
  })

  /* ================================================================================ */
  // 上传语录 - 支持连续发送图片
  ctx.command('上传语录').usage('支持连续发送图片，回复"结束"结束上传').action(uploadQuote(config))

  /* ================================================================================ */
  // 语录 - 随机抽取一张语录图
  ctx.command('语录').usage('随机抽取一张语录图').action(gachaQuote(config))

  /* ================================================================================ */
  // 语录十连 - 随机抽取十张语录图
  ctx.command('语录十连').usage('随机抽取十张语录图').action(gachaQuote10Times(config))

  /* ================================================================================ */
  // 上传图片 - 支持连续发送图片，上传龙图
  ctx.command('上传图片').usage('支持连续发送图片，回复"结束"结束上传').action(uploadLoong(config))

  /* ================================================================================ */
  // 龙 - 随机抽取一张龙图
  ctx.command('龙').usage('随机抽取一张龙图').action(gachaLoong(config))

  /* ================================================================================ */
  // 龙龙龙 - 随机抽取十张龙图
  ctx.command('龙龙龙').usage('随机抽取十张龙图').action(gachaLoong10Times(config))

  /* ================================================================================ */
  // 存表情 - 回复聊天内容中的动画表情以得到文件Url
  ctx.command('存表情').usage('回复一条包含图片资源的消息，可以得到文件Url').action(saveSticker())

  /* ================================================================================ */
  // 表情对称 - 回复聊天内容中的动画表情以得到对称版本
  ctx.command('左对称').usage('得到对称表情').action(symmetry('horizontal-left'))
  ctx.command('右对称').usage('得到对称表情').action(symmetry('horizontal-right'))
  ctx.command('上对称').usage('得到对称表情').action(symmetry('vertical-top'))
  ctx.command('下对称').usage('得到对称表情').action(symmetry('vertical-bottom'))
}
