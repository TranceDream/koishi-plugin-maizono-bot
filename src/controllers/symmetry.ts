import { Argv, h } from 'koishi'
import { makeSymmetryFromURL, SymmetryMode } from '../utils/symmetry'

export const symmetry = (mode: SymmetryMode) => {
  return async (argv: Argv) => {
    const { session } = argv

    // 从饮用消息中取元素
    if (session?.event?.message?.quote?.elements) {
      const urls: any[] = session?.event.message?.quote.elements
        .filter(element => element.type === 'img')
        .map(element => element.attrs.src ?? null)
      const imageUrl = urls.shift()
      if (imageUrl) {
        const { buffer, contentType } = await makeSymmetryFromURL(imageUrl, mode)
        if (buffer) {
          await session.send(h.image(buffer, contentType))
        }
      }
    }
  }
}
