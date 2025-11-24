import { Argv, h } from 'koishi'
import { changeSpeed } from '../utils/speed'

export const speed = () => {
  return async (argv: Argv) => {
    const { session } = argv

    const speed = isNaN(Number(argv.args[0])) ? 2.0 : Number(argv.args[0])

    // 从饮用消息中取元素
    if (session?.event?.message?.quote?.elements) {
      const urls: any[] = session?.event.message?.quote.elements
        .filter(element => element.type === 'img')
        .map(element => element.attrs.src ?? null)
      const imageUrl = urls.shift()
      if (imageUrl) {
        const { buffer } = await changeSpeed(imageUrl, speed)
        if (buffer) {
          // @ts-ignore
          await session.send(h.image(buffer))
        }
      }
    }
  }
}
