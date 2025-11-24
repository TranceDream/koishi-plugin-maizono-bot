import { Argv, Context, h } from 'koishi'

export const echo = (ctx: Context) => {
  return async (argv: Argv) => {
    const { session } = argv

    // 从饮用消息中取元素
    if (session?.event?.message?.quote?.elements) {
      console.log(session.event.message.quote.elements.toString())
      await session.send(session.event.message.quote.elements)
      let elements: h[] = []
      if (session.quote) {
        elements = session.quote.elements
      }

      const audio = h.select(elements, 'audio')
      if (audio.length === 0) return '这看上去不是音频。'

      const res = await ctx.http(audio[0].attrs.path, { responseType: 'arraybuffer' })
      console.log(res)
    }
  }
}
