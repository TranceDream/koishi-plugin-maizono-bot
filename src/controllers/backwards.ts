import { Argv, h } from 'koishi'
import { makeBackwards } from '../utils/backwards'

export const backwards = () => {
  return async (argv: Argv) => {
    const { session } = argv

    // 从饮用消息中取元素
    if (session?.event?.message?.quote?.elements) {
      const urls: any[] = session?.event.message?.quote.elements
        .filter(element => element.type === 'img')
        .map(element => element.attrs.src ?? null)
      const imageUrl = urls.shift()
      if (imageUrl) {
        const { buffer } = await makeBackwards(imageUrl)
        if (buffer) {
          // @ts-ignore
          await session.send(h.image(buffer))
        }
      }
    }
  }
}
