import { Argv, h } from 'koishi'
import { MinioUtils } from '../utils/minio'
import { logger, MaizonoBotConfig } from '..'

export const uploadRecord = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.recordMapping[channelId]

    if (!mapping) {
      return
    }

    // 从饮用消息中取元素
    if (session?.event?.message?.quote?.elements) {
      const urls: any[] = session?.event.message?.quote.elements
        .filter(element => element.type === 'audio')
        .map(element => element.attrs.path ?? null)
      const audioPath = urls.shift()
      if (audioPath) {
        const result = await MinioUtils.fetchAudioAndUpload(audioPath, mapping.bucket, mapping.dir).catch(error => {
          logger.error(`收录音频 - ${error}`)
          session.send(error)
          return null
        })
        if (result) {
          await session.send('收录成功')
        }
      }
    }
  }
}

export const gachaRecord = (config: MaizonoBotConfig) => {
  return async (argv: Argv) => {
    const { session } = argv
    const channelId = session.channelId
    const mapping = config.recordMapping[channelId]

    if (!mapping) {
      return
    }

    const result = await MinioUtils.gacha(mapping.bucket, mapping.dir)
    const response: Response = await fetch(result)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    await session.send(h.audio(buffer.toString()))
  }
}
