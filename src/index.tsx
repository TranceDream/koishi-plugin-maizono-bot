import { Context, Logger, Schema } from 'koishi'
import fetch, { Response } from 'node-fetch'
import OpenAI from 'openai'
import * as cheerio from 'cheerio'
import * as Minio from 'minio'

export const name = 'maizono-bot'

interface MaizonoBotQuoteConfig {
  endPoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
  bucketName: string;
  quotesDir: string;
  uploadDir: string;
}

interface MaizonoBotOllamaConfig {
  enableOllamaGeneration: boolean;
  ollamaEndPoint: string;
  ollamaToken: string;
  systemPrompt?: string;
}

interface LLMMessage {
  role: 'user' | 'system';
  content: string;
}

export type MaizonoBotConfig = MaizonoBotQuoteConfig & MaizonoBotOllamaConfig;

export const Config: Schema<MaizonoBotConfig> = Schema.object({
  endPoint: Schema.string().required().description('MinIO Endpoint'),
  port: Schema.number()
    .min(1025)
    .max(65535)
    .required()
    .description('MinIO端口'),
  accessKey: Schema.string().required().description('MinIO Access Key'),
  secretKey: Schema.string()
    .role('secret')
    .required()
    .description('MinIO Secret Key'),
  useSSL: Schema.boolean().default(false).description('是否使用SSL'),
  bucketName: Schema.string().default(name).description('Bucket名称'),
  quotesDir: Schema.string().default('').description('对象存储路径(前缀)'),
  uploadDir: Schema.string().default('').description('对象存储路径(前缀)'),
  enableOllamaGeneration: Schema.boolean().default(false).description('是否启用Ollama生成功能'),
  ollamaEndPoint: Schema.string().default('http://localhost:11434/v1').description('Ollama Endpoint'),
  ollamaToken: Schema.string().default('ollama').description('Ollama Token'),
  systemPrompt: Schema.string().description('系统提示词')
})

const logger: Logger = new Logger(name)

export function apply(ctx: Context, config: MaizonoBotConfig) {
  /* ================================================================================ */
  // 生成对象uri时的协议，通过配置项useSSL决定
  const minioProtocol: 'https' | 'http' = config.useSSL ? 'https' : 'http'
  // minio客户端
  const minioClient: Minio.Client = new Minio.Client({
    endPoint: config.endPoint, // MinIO 服务地址
    port: config.port, // MinIO 服务端口
    useSSL: config.useSSL, // 是否使用 HTTPS
    accessKey: config.accessKey, // MinIO 的访问密钥
    secretKey: config.secretKey // MinIO 的访问密钥
  })

  /* ================================================================================ */
  /**
   * 从疼讯服务器下载图片，并上传到minio中
   * @param {string} src 图片原始uri
   * @returns {Promise<string>} minio对象uri
   */
  const fetchAndUploadImages = async (src: string): Promise<string> => {
    // 下载图片资源并获取Buffer
    const response: Response = await fetch(src)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`)
    }
    const buffer: Buffer<ArrayBufferLike> = Buffer.from(
      await response.arrayBuffer()
    )

    // 从原始uri中获取fileid生成新文件名
    const fileName: string = `${config.uploadDir}${Date.now()}-${
      new URLSearchParams(src.split('?')[1]).get('fileid') ?? 'undefined'
    }`

    // 上传到minio
    await minioClient.putObject(config.bucketName, fileName, buffer)

    logger.info(`上传语录 - 成功上传: ${fileName}`)
    return `${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${fileName}`
  }

  /* ================================================================================ */
  // 上传语录 - 支持连续发送图片
  ctx
    .command('上传语录')
    .usage('支持连续发送图片，回复"结束"结束上传')
    .action(async (argv) => {
      const { session } = argv
      await session.send('发送图片开始上传，回复"结束"结束上传')

      // 获取原始输入
      const rawInputs: string[] = []
      while (true) {
        const content: string = await session.prompt()
        if (!content || content == '结束') {
          break
        }
        rawInputs.push(content)
      }

      // 获取原始输入元素图片src，过滤非图元素
      const inputs: string[] = rawInputs
        .map((rr) => {
          const $ = cheerio.load(rr)
          return $('img').attr('src')
        })
        .filter((item) => item != null)

      // 轮流上传，获取上传后对象uri
      const results: string[] = (
        await Promise.allSettled(
          inputs.map((e) =>
            fetchAndUploadImages(e).catch((error) => {
              logger.error(`上传语录 - ${error}`)
              session.send(error)
              return null
            })
          )
        )
      )
        .filter(({ status }) => status == 'fulfilled')
        .map((e) => (e as PromiseFulfilledResult<string>).value)

      return `试图上传${inputs.length}张图片\n上传成功${results.length}张图片`
    })

  /* ================================================================================ */
  // 语录 - 随机抽取一张语录图
  ctx
    .command('语录')
    .usage('随机抽取一张语录图')
    .action(async (argv) => {
      console.log(argv)
      const { session } = argv

      // 获取所有文件名
      const quotes: Minio.BucketItem[] = await new Promise(
        (resolve, reject) => {
          const objects: Minio.BucketItem[] = []
          const stream: Minio.BucketStream<Minio.BucketItem> =
            minioClient.listObjectsV2(
              config.bucketName,
              config.quotesDir,
              true
            )
          stream.on('data', (obj) => objects.push(obj))
          stream.on('end', () => resolve(objects))
          stream.on('error', (err) => reject(err))
        }
      )

      // 抽一个
      const randomQuote: string =
        quotes[Math.floor(Math.random() * quotes.length)].name
      logger.info(`语录 - 抽取: ${randomQuote}`)
      await session.send(
        <img
          src={`${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${randomQuote}`}
          alt={'quote'} />
      )
    })

  /* ================================================================================ */
  // 语录十连 - 随机抽取十张语录图
  ctx
    .command('语录十连')
    .usage('随机抽取十张语录图')
    .action(async (argv) => {
      const { session } = argv

      // 获取所有文件名
      const quotes: Minio.BucketItem[] = await new Promise(
        (resolve, reject) => {
          const objects: Minio.BucketItem[] = []
          const stream: Minio.BucketStream<Minio.BucketItem> =
            minioClient.listObjectsV2(
              config.bucketName,
              config.quotesDir,
              true
            )
          stream.on('data', (obj) => objects.push(obj))
          stream.on('end', () => resolve(objects))
          stream.on('error', (err) => reject(err))
        }
      )

      // 集合去重
      const randomQuoteSet: Set<string> = new Set()
      while (randomQuoteSet.size < 10) {
        randomQuoteSet.add(
          quotes[Math.floor(Math.random() * quotes.length)].name
        )
      }

      // 防止消息轰炸，放到同一个Fragment下发送
      await session.send(
        <>
          {Array.from(randomQuoteSet).map((quote) => (
            <img
              src={`${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${quote}`}
              alt={'quote'} />
          ))}
        </>
      )
    })

  /* ================================================================================ */
  // 对象查看 - debug使用，预览minio中图片
  ctx
    .command('对象查看')
    .usage('调试用，预览图片，后接相对路径')
    .action(async (argv, message) => {
      const { session } = argv
      await session.send(
        <img
          src={`${minioProtocol}://${config.endPoint}:${config.port}/${config.bucketName}/${message}`}
          alt={'quote'} />
      )
    })

  /* ================================================================================ */
  // 模型生成锁，防止滥用
  let ollamaGenerationLock: boolean = false

  /* ================================================================================ */
  /**
   * 使用openai请求LLM服务
   * @param {string} prompt 大模型调用提示词
   * @param {string} model 使用模型
   * @returns {Promise<string>} 生成结果
   */
  const startLLMGeneration = async (prompt: string, model: string): Promise<string> => {
    // 判断是否已有生成任务
    if (ollamaGenerationLock) {
      return '我还在思考喵~请排队喵'
    }

    // 上锁
    ollamaGenerationLock = true
    try {

      // 构造openai实例
      const openai = new OpenAI({
        baseURL: config.ollamaEndPoint,
        apiKey: config.ollamaToken // required but unused
      })

      // 构造消息串
      const messages: LLMMessage[] = []
      if (config.systemPrompt) {
        messages.push({
          role: 'system',
          content: config.systemPrompt
        })
      }
      messages.push({
        role: 'user',
        content: prompt
      })

      // 生成回答
      const completion = await openai.chat.completions.create({
        model,
        messages
      })

      // 解锁
      ollamaGenerationLock = false

      if (Array.isArray(completion.choices) && completion.choices.length > 0) {
        const result = (completion.choices[0].message?.content ?? '[Error] 你够了，我无法忍受你的行为')
          .replace(/<think>.*?<\/think>/s, '').trim()
        logger.info(`Ollama调用 - 成功生成: Prompt {${prompt}}, Model {${model}} Result {${result}}`)
        return result
      }
      logger.error(`Ollama调用 - 生成失败: Prompt {${prompt}}, Model {${model}} Error {生成结果不合法或为空}`)
      return '[Error] 你够了，我无法忍受你的行为'
    } catch (e: any) {
      ollamaGenerationLock = false
      logger.error(`Ollama调用 - 生成失败: Prompt {${prompt}}, Model {${model}} Error {${e}}`)
      return '[Error] 你够了，我无法忍受你的行为'
    }
  }

  /* ================================================================================ */
  // 仅在启用生成情况下进行生成
  if (config.enableOllamaGeneration) {
    /* ================================================================================ */
    // 锐评 - 使用DeepSeek R1 14b进行锐评
    ctx
      .command('锐评')
      .usage('使用DeepSeek R1 14b进行锐评')
      .action(async (argv) => {
        const { args } = argv

        if (args && Array.isArray(args)) {
          // 构造Prompt
          const prompt = `请你用尖锐的口吻锐评一下：“${args.join(' ')}”`
          return await startLLMGeneration(prompt, 'deepseek-r1:14b')
        }

        // 参数不合法
        return `[Error] 你够了，我无法忍受你的行为`
      })

    /* ================================================================================ */
    // QwQ锐评 - 使用QwQ 32b进行锐评
    ctx
      .command('qwq锐评')
      .usage('使用QwQ 32b进行锐评')
      .action(async (argv) => {
        const { args } = argv

        if (args && Array.isArray(args)) {
          // 构造Prompt
          const prompt = `请你用尖锐的口吻锐评一下：“${args.join(' ')}”`
          return await startLLMGeneration(prompt, 'qwq:32b')
        }

        // 参数不合法
        return `[Error] 你够了，我无法忍受你的行为`
      })

    /* ================================================================================ */
    // 喵评 - 使用QwQ 32b进行善评
    ctx
      .command('喵评')
      .usage('使用QwQ 32b进行锐评')
      .action(async (argv) => {
        const { args } = argv

        if (args && Array.isArray(args)) {
          // 构造Prompt
          const prompt = `请你用友善的口吻评价一下：“${args.join(' ')}”`
          return await startLLMGeneration(prompt, 'qwq:32b')
        }

        // 参数不合法
        return `[Error] 你够了，我无法忍受你的行为`
      })

  }

  /* ================================================================================ */
  // 存表情 - 回复聊天内容中的动画表情以得到文件Url
  ctx
    .command('存表情')
    .usage('回复一条包含图片资源的消息，可以得到文件Url')
    .action(async (argv) => {
      const { session } = argv

      // 从饮用消息中取元素
      if (session?.event?.message?.quote?.elements) {
        const files: string[] = session?.event.message?.quote.elements
          .filter(element => element.type === 'img')
          .map(element => element.attrs.src ?? null)
          .filter(element => element !== null)
        return files.join('\n')
      }
    })

}
