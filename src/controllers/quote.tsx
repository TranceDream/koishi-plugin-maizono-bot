import { Argv } from 'koishi'
import * as cheerio from 'cheerio'
import { MinioUtils } from '../utils/minio'
import { logger, MaizonoBotConfig } from '..'

export const uploadQuote = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.quoteMapping[channelId]

    if (!mapping) {
      return
    }

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
      .map(rr => {
        const $ = cheerio.load(rr)
        return $('img').attr('src')
      })
      .filter(item => item != null)

    const results: string[] = (
      await Promise.allSettled(
        inputs.map(e =>
          MinioUtils.fetchImageAndUpload(e, mapping.bucket, mapping.uploadDir || mapping.dir).catch(error => {
            logger.error(`上传语录 - ${error}`)
            session.send(error)
            return null
          })
        )
      )
    )
      .filter(({ status }) => status == 'fulfilled')
      .map(e => (e as PromiseFulfilledResult<string>).value)

    return inputs.length === 0 ? '图呢？' : `试图上传${inputs.length}张图片\n上传成功${results.length}张图片`
  }
}

export const gachaQuote = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.quoteMapping[channelId]

    if (!mapping) {
      return
    }

    const result = await MinioUtils.gacha(mapping.bucket, mapping.dir)
    await session.send(<img src={result} alt={'quote'} />)
  }
}

export const gachaQuote10Times = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.quoteMapping[channelId]

    if (!mapping) {
      return
    }

    const results = await MinioUtils.gacha10Times(mapping.bucket, mapping.dir)
    await session.send(
      <>
        {results.map(r => (
          <img src={r} alt={'quote'} />
        ))}
      </>
    )
  }
}

export const uploadLoong = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.loongMapping[channelId]

    if (!mapping) {
      return
    }

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
      .map(rr => {
        const $ = cheerio.load(rr)
        return $('img').attr('src')
      })
      .filter(item => item != null)

    const results: string[] = (
      await Promise.allSettled(
        inputs.map(e =>
          MinioUtils.fetchImageAndUpload(e, mapping.bucket, mapping.dir).catch(error => {
            logger.error(`上传图片 - ${error}`)
            session.send(error)
            return null
          })
        )
      )
    )
      .filter(({ status }) => status == 'fulfilled')
      .map(e => (e as PromiseFulfilledResult<string>).value)

    return inputs.length === 0 ? '图呢？' : `试图上传${inputs.length}张图片\n上传成功${results.length}张图片`
  }
}

export const gachaLoong = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.loongMapping[channelId]

    if (!mapping) {
      return
    }

    const result = await MinioUtils.gacha(mapping.bucket, mapping.dir)
    await session.send(<img src={result} alt={'loong'} />)
  }
}

export const gachaLoong10Times = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.loongMapping[channelId]

    if (!mapping) {
      return
    }

    const results = await MinioUtils.gacha10Times(mapping.bucket, mapping.dir)
    await session.send(
      <>
        {results.map(r => (
          <img src={r} alt={'loong'} />
        ))}
      </>
    )
  }
}
