import { Argv } from 'koishi'

export const saveSticker = () => {
  return async (argv: Argv) => {
    const { session } = argv

    // 从引用消息中取元素
    if (session?.event?.message?.quote?.elements) {
      const files: any[] = session?.event.message?.quote.elements
        .filter(element => element.type === 'img')
        .map(element => element.attrs.src ?? null)
        .filter(element => element !== null)
      return files.join('\n')
    }
  }
}
